import { IRPC_STORE } from '@irpclib/irpc';
import { read } from '@irpclib/r2-file';
import type { FileDriver } from '@irpclib/r2-file/adapter';
import { fsContext } from '@irpclib/r2-file/context';
import { logger } from '../logger.js';
import { configured, ownerOf, TEXT_LIMIT, vectorId } from './memory.js';

/** The index's log: what it indexed, at debug level, so a dev server shows it. */
const log = logger.create({ tags: ['index'] });

/** The files whose text is indexed, by extension; memos index themselves when saved. */
export const INDEXED_EXTENSIONS = ['.md', '.txt'];

/**
 * A filesystem driver keeping memory's index in step with the user's files, so `memory.recall`
 * finds a file by what it says. Attached after storage, it indexes a file's text in chunks when it
 * is written, copied, moved or restored, and drops them when it is moved away or removed. Only
 * files with an indexed extension are indexed. Indexing is best-effort: a failure is logged, never
 * undoing the change.
 *
 * @param extensions - The extensions to index, e.g. `.md`.
 * @returns The driver, to append with r2-file's `drivers`.
 */
export function contentIndex(extensions: string[] = INDEXED_EXTENSIONS): FileDriver {
  const indexed = (path?: string): path is string =>
    !!path && extensions.some((extension) => path.toLowerCase().endsWith(extension));

  return {
    async write(ctx, _path, data) {
      if (!indexed(ctx.path)) return;
      await safely(ctx.path, async () => index(ctx.path, typeof data === 'string' ? data : await textOf(ctx.path)));
    },
    async copy(ctx) {
      const destination = ctx.destination;
      if (!indexed(destination)) return;
      await safely(destination, async () => index(destination, await textOf(destination)));
    },
    async move(ctx) {
      const destination = ctx.destination;
      if (indexed(ctx.path)) await safely(ctx.path, () => unindex(ctx.path));
      if (indexed(destination)) await safely(destination, async () => index(destination, await textOf(destination)));
    },
    async remove(ctx) {
      if (indexed(ctx.path)) await safely(ctx.path, () => unindex(ctx.path));
    },
    async restore(ctx) {
      if (indexed(ctx.path)) await safely(ctx.path, async () => index(ctx.path, await textOf(ctx.path)));
    },
  };
}

/** Longest chunk of a file's text embedded as one entry. */
const CHUNK_SIZE = 1500;

/** Most chunks kept per file: a file's entries are found by chunk number, without a lookup. */
const MAX_CHUNKS = 32;

/**
 * Indexes a file's text: one entry per chunk, replacing what an earlier version left.
 *
 * @param storagePath - The file's resolved path.
 * @param text - Its text.
 */
async function index(storagePath: string, text: string | undefined): Promise<void> {
  const { vectors, embed } = configured();
  const owner = ownerOf();
  const path = userPath(storagePath);
  const name = path.slice(path.lastIndexOf('/') + 1);
  const chunks = chunksOf(text ?? '').slice(0, MAX_CHUNKS);

  if (chunks.length) {
    const values = await embed(chunks.map((chunk) => `${name}\n${chunk}`));
    const ids = await idsOf(owner, path, 0, chunks.length);
    await vectors.upsert(
      chunks.map((chunk, i) => ({
        id: ids[i],
        values: values[i],
        metadata: { owner, path, name, scope: 'files', text: chunk.slice(0, TEXT_LIMIT) },
      })),
    );
  }
  // A shorter version leaves chunks behind; they go, so recall never quotes text the file lost.
  await vectors.deleteByIds(await idsOf(owner, path, chunks.length, MAX_CHUNKS));
  log.debug(`indexed ${path}`, { chunks: chunks.length });
}

/** Drops every chunk of a file. */
async function unindex(storagePath: string): Promise<void> {
  const { vectors } = configured();
  const path = userPath(storagePath);
  await vectors.deleteByIds(await idsOf(ownerOf(), path, 0, MAX_CHUNKS));
  log.debug(`unindexed ${path}`);
}

/** A stored file's text, read back after the change that stored it. */
async function textOf(storagePath: string): Promise<string | undefined> {
  return read(storagePath, { encoding: 'text' });
}

/** The ids of a file's chunks, from `start` up to `end`. */
function idsOf(owner: string, path: string, start: number, end: number): Promise<string[]> {
  return Promise.all(
    Array.from({ length: Math.max(end - start, 0) }, (_, i) => vectorId(owner, `${path}#${start + i}`)),
  );
}

/**
 * A file's text in chunks of up to `CHUNK_SIZE`: whole paragraphs where they fit, a paragraph cut
 * where one alone is longer.
 */
function chunksOf(text: string): string[] {
  const chunks: string[] = [];
  let current = '';
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > CHUNK_SIZE) {
      chunks.push(current);
      current = '';
    }
    for (let start = 0; start < paragraph.length; start += CHUNK_SIZE) {
      const piece = paragraph.slice(start, start + CHUNK_SIZE);
      if (piece.length === CHUNK_SIZE) chunks.push(piece);
      else current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** A resolved path as the user writes it: inside their home, from `~`. */
function userPath(storagePath: string): string {
  const home = fsContext.get()?.homeDir;
  return home && storagePath.startsWith(`${home}/`) ? `~${storagePath.slice(home.length)}` : storagePath;
}

/** Runs an index change, logging a failure instead of letting it undo the file's change. */
async function safely(path: string, change: () => Promise<void>): Promise<void> {
  try {
    await change();
  } catch (error) {
    IRPC_STORE.error(error as Error, [{ index: path }]);
  }
}
