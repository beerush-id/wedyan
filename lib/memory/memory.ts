import { exists, write } from '@irpclib/r2-file';
import { fsContext } from '@irpclib/r2-file/context';
import type { MemoDocument } from '@/lib/documents/types.js';
import { memory, type Recalled, recall, save } from './memory.h.js';

/** The part of a Vectorize index memory uses. */
export interface VectorStore {
  upsert(
    vectors: { id: string; values: number[]; metadata?: Record<string, string | number | boolean> }[],
  ): Promise<unknown>;
  query(
    values: number[],
    options: { topK?: number; filter?: Record<string, string>; returnMetadata?: 'all' | 'indexed' | 'none' },
  ): Promise<{ matches: { id: string; score: number; metadata?: Record<string, unknown> }[] }>;
}

/** Turns texts into vectors, one per text, in order. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

/** The index memory writes to and searches, and how it embeds text. */
export interface MemoryConfig {
  vectors: VectorStore;
  embed: Embedder;
}

/** Workers AI's multilingual embedding model: 1024 dimensions, the dimension the index was made with. */
export const EMBEDDING_MODEL = '@cf/baai/bge-m3';

let config: MemoryConfig | undefined;

/**
 * Sets the index memory uses. Called once by the server entry with its Vectorize and Workers AI
 * bindings.
 *
 * @param next - The vector index and the embedder.
 */
export function setupMemory(next: MemoryConfig): void {
  config = next;
}

/**
 * Embeds text with Workers AI.
 *
 * @param ai - The Workers AI binding.
 * @param model - The embedding model; bge-m3 unless the index was made for another.
 * @returns An embedder over that model.
 */
export function embedWith(
  ai: { run(model: string, input: { text: string[] }): Promise<unknown> },
  model = EMBEDDING_MODEL,
): Embedder {
  return async (texts) => ((await ai.run(model, { text: texts })) as { data: number[][] }).data;
}

memory.construct(save, async (text, options = {}) => {
  const { vectors, embed } = configured();
  const owner = ownerOf();
  const kind = options.kind ?? 'note';
  const { path, name } = await freeName(options.name?.trim() || nameOf(text));
  const now = new Date().toISOString();
  const memo: MemoDocument = {
    type: 'memo',
    version: 1,
    id: crypto.randomUUID(),
    name,
    created: now,
    updated: now,
    author: { kind: 'agent' },
    ...(options.tags?.length ? { tags: options.tags } : {}),
    kind,
    body: text,
  };

  await write(path, memo);
  const [values] = await embed([`${name}\n${text}`]);
  await vectors.upsert([
    {
      id: await vectorId(owner, path),
      values,
      metadata: { owner, path, name, scope: 'memory', kind, text: text.slice(0, TEXT_LIMIT) },
    },
  ]);
  return { path, name, kind };
});

memory.construct(recall, async (query, options = {}) => {
  const { vectors, embed } = configured();
  const scope = options.scope ?? 'all';
  const [values] = await embed([query]);
  // The index is shared, so every search stays inside the asking user's own entries.
  const filter: Record<string, string> = { owner: ownerOf(), ...(scope === 'all' ? {} : { scope }) };
  const { matches } = await vectors.query(values, { topK: options.limit ?? 5, filter, returnMetadata: 'all' });

  return matches.map(
    ({ score, metadata = {} }): Recalled => ({
      path: String(metadata.path),
      name: String(metadata.name),
      scope: String(metadata.scope),
      ...(metadata.kind ? { kind: String(metadata.kind) } : {}),
      text: String(metadata.text ?? ''),
      score,
    }),
  );
});

/** Most of a memory's text kept with its vector, so recall returns it without opening the file. */
const TEXT_LIMIT = 2000;

/** Longest name a memo gets from its text. */
const NAME_LIMIT = 60;

function configured(): MemoryConfig {
  if (!config) throw new Error('Memory is not set up');
  return config;
}

/** Whose memories these are: the user the filesystem acts for. */
function ownerOf(): string {
  const owner = fsContext.get()?.ownerId;
  if (!owner) throw new Error('Memory needs a user');
  return owner;
}

/** A memo's name from its text: the first sentence, without its closing mark, safe as a file name. */
function nameOf(text: string): string {
  const [sentence] = text.trim().split(/(?<=[.!?])\s/);
  return sentence
    .replace(/[.!?]+$/, '')
    .replace(/[/\\]/g, '-')
    .slice(0, NAME_LIMIT)
    .trim();
}

/** The memo's path and name, with a short suffix when a memo of that name exists, so none is overwritten. */
async function freeName(name: string): Promise<{ path: string; name: string }> {
  const pathOf = (memoName: string) => `~/Memos/${memoName}.memo`;
  if (!(await exists(pathOf(name)))) return { path: pathOf(name), name };
  const unique = `${name} ${crypto.randomUUID().slice(0, 4)}`;
  return { path: pathOf(unique), name: unique };
}

/** A vector's id: its owner and path hashed, since paths are per user and ids are at most 64 bytes. */
async function vectorId(owner: string, path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${owner}:${path}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
