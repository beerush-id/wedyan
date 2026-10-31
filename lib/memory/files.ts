import { getContext, IRPC_STORE, IRPCFile } from '@irpclib/irpc';
import { read } from '@irpclib/r2-file';
import type { FileDriver } from '@irpclib/r2-file/adapter';
import { fsContext } from '@irpclib/r2-file/context';
import { hasWords, isMedia, wordsOf } from '@/lib/documents/words.js';
import { logger } from '../logger.js';
import { configured, ownerOf, TEXT_LIMIT, vectorId } from './memory.js';

/** The index's log: what it indexed, at debug level, so a dev server shows it. */
const log = logger.create({ tags: ['index'] });

/**
 * A filesystem driver keeping memory's index in step with the user's files, so `memory.recall`
 * finds any file by what it's about: text by what it says, a document by its words, media by its
 * name. Attached after storage, it indexes a file in chunks when it is written, copied, moved or
 * restored, and drops them when it is moved away or removed. A change never waits for it: indexing
 * runs behind the call that made the change, and a failure is logged, never undoing the change.
 *
 * @returns The driver, to append with r2-file's `drivers`.
 */
export function contentIndex(): FileDriver {
  const indexed = (path?: string): path is string => !!path && hasWords(path);

  return {
    async write(ctx, _path, data) {
      if (!indexed(ctx.path)) return;
      await behind(ctx.path, async () => index(ctx.path, await wordsAt(ctx.path, data)));
    },
    async copy(ctx) {
      const destination = ctx.destination;
      if (!indexed(destination)) return;
      await behind(destination, async () => index(destination, await wordsAt(destination)));
    },
    async move(ctx) {
      const destination = ctx.destination;
      if (indexed(ctx.path)) await behind(ctx.path, () => unindex(ctx.path));
      if (indexed(destination)) await behind(destination, async () => index(destination, await wordsAt(destination)));
    },
    async remove(ctx) {
      if (indexed(ctx.path)) await behind(ctx.path, () => unindex(ctx.path));
    },
    async restore(ctx) {
      if (indexed(ctx.path)) await behind(ctx.path, async () => index(ctx.path, await wordsAt(ctx.path)));
    },
  };
}

/** Longest chunk of a file's text embedded as one entry. */
const CHUNK_SIZE = 1500;

/** Most chunks kept per file: a file's entries are found by chunk number, without a lookup. */
const MAX_CHUNKS = 32;

/**
 * Indexes a file's words: one entry per chunk, replacing what an earlier version left. Words that
 * haven't changed cost nothing: dragging a clip saves its stage, not what the stage is about.
 *
 * @param storagePath - The file's resolved path.
 * @param text - Its words.
 */
async function index(storagePath: string, text: string | undefined): Promise<void> {
  const { vectors, embed } = configured();
  const owner = ownerOf();
  const path = userPath(storagePath);
  const name = path.slice(path.lastIndexOf('/') + 1);
  const chunks = chunksOf(text ?? '').slice(0, MAX_CHUNKS);
  const words = await vectorId(owner, text ?? '');

  if (chunks.length) {
    const ids = await idsOf(owner, path, 0, chunks.length);
    const [indexed] = (await vectors.getByIds?.([ids[0]])) ?? [];
    if (indexed?.metadata?.words === words) return;
    const values = await embed(chunks.map((chunk) => `${name}\n${chunk}`));
    await vectors.upsert(
      chunks.map((chunk, i) => ({
        id: ids[i],
        values: values[i],
        metadata: { owner, path, name, scope: 'files', words, text: chunk.slice(0, TEXT_LIMIT) },
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

/**
 * What memory finds a file by, read back when the change didn't carry its content.
 *
 * @param storagePath - The file's resolved path.
 * @param data - What was written, if it was.
 * @returns Its words.
 */
async function wordsAt(storagePath: string, data?: unknown): Promise<string | undefined> {
  if (isMedia(storagePath)) return wordsOf(storagePath);
  const carried = data !== undefined && !(data instanceof IRPCFile);
  return wordsOf(storagePath, carried ? data : await read(storagePath, { encoding: 'text' }));
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

/**
 * A resolved path as the user writes it: inside their home, from `~`.
 *
 * @param storagePath - The path as r2-file resolved it, from the mount's root.
 * @returns The path from `~` when it is in the user's home, else as given.
 */
export function userPath(storagePath: string): string {
  const home = fsContext.get()?.homeDir;
  return home && storagePath.startsWith(`${home}/`) ? `~${storagePath.slice(home.length)}` : storagePath;
}

/**
 * Runs an index change behind the call that made the file's change, so that call answers at once;
 * outside a request, like in a script or a test, it's simply awaited.
 *
 * @param path - The file.
 * @param change - The index change.
 * @returns When the caller may go on.
 */
async function behind(path: string, change: () => Promise<void>): Promise<void> {
  const work = safely(path, change);
  const request = getContext<{ waitUntil?(work: Promise<void>): void }>('ctx');
  if (request?.waitUntil) request.waitUntil(work);
  else await work;
}

/** Runs an index change, logging a failure instead of letting it undo the file's change. */
async function safely(path: string, change: () => Promise<void>): Promise<void> {
  try {
    await change();
  } catch (error) {
    IRPC_STORE.error(error as Error, [{ index: path }]);
  }
}
