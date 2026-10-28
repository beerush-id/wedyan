import { createPackage } from '@irpclib/irpc';
import type { MemoDocument } from '@/lib/documents/types.js';
import { wsTransport } from '@/src/api.js';

/**
 * What Wedyan remembers. A memory is a `.memo` file the user can see and edit; saving writes one and
 * indexes it, recalling searches the index. Agents reach both as tools (`memory.save`,
 * `memory.recall`).
 */
export const memory = createPackage({
  name: 'memory',
  version: '1.0.0',
});

memory.use(wsTransport);

export type MemoKind = MemoDocument['kind'];

export type SaveOptions = {
  /** What it is; a note when unset. */
  kind?: MemoKind;
  /** The memo's name, which is also its file name; its text's first sentence when unset. */
  name?: string;
  tags?: string[];
};

/** Where a saved memo lives. */
export type MemoInfo = { path: string; name: string; kind: MemoKind };

export type RecallOptions = {
  /** Saved memories, the user's files, or both (the default). */
  scope?: 'memory' | 'files' | 'all';
  /** How many to return, closest first; 5 when unset. */
  limit?: number;
};

/** One thing recalled: where it lives, what it says, and how close it is to the query. */
export type Recalled = {
  path: string;
  name: string;
  scope: string;
  kind?: string;
  text: string;
  score: number;
};

export type SaveFn = (text: string, options?: SaveOptions) => Promise<MemoInfo>;
export type RecallFn = (query: string, options?: RecallOptions) => Promise<Recalled[]>;

/** Remembers one thing as a memo in `~/Memos`, and indexes it so it can be recalled. */
export const save = memory.declare<SaveFn>('save', () => ({ path: '', name: '', kind: 'note' }), {
  description:
    'Remembers one lasting thing about the user as a memo they can see: a preference, a person, a project, a fact or a note. ' +
    "text is the memory in one or two sentences. options: { kind?: 'note' | 'preference' | 'person' | 'project' | 'fact', name?, tags? }.",
  mcp: { args: ['text', 'options'], readOnlyHint: false, destructiveHint: false, openWorldHint: false },
});

/** Finds what was remembered, or what the user's files say, closest to a query first. */
export const recall = memory.declare<RecallFn>('recall', () => [], {
  description:
    'Searches what you know: saved memories and the content of the user’s files, closest first. ' +
    "query is what to look for, in plain words. options: { scope?: 'memory' | 'files' | 'all', limit? }.",
  mcp: { args: ['query', 'options'], readOnlyHint: true, openWorldHint: false },
});
