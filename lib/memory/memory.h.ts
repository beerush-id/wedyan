import { createPackage } from '@irpclib/irpc';
import { z } from 'zod';
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

/** What to remember. One flat object, the shape models fill in reliably. */
export type SaveInput = {
  /** The memory, in one or two sentences. */
  text: string;
  /** What it is; a note when unset. */
  kind?: MemoKind;
  /** The memo's name, which is also its file name; its text's first sentence when unset. */
  name?: string;
  tags?: string[];
};

/** Where a saved memo lives. */
export type MemoInfo = { path: string; name: string; kind: MemoKind };

/** What to look for. One flat object, the shape models fill in reliably. */
export type RecallInput = {
  /** What to look for, in plain words. */
  query: string;
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

export type SaveFn = (input: SaveInput) => Promise<MemoInfo>;
export type RecallFn = (input: RecallInput) => Promise<Recalled[]>;

/** The kinds of memory a memo can be. */
const MEMO_KINDS = ['note', 'preference', 'person', 'project', 'fact'] as const satisfies readonly MemoKind[];

// Strict, so a field the model put in the wrong place is refused instead of silently dropped.
const saveInput = z.strictObject({
  text: z.string().describe('The memory, in one or two sentences.'),
  kind: z.enum(MEMO_KINDS).optional().describe('What it is: preference for how they like things; a note when unset.'),
  name: z.string().optional().describe('The memo’s name, also its file name.'),
  tags: z.array(z.string()).optional(),
});

const recallInput = z.strictObject({
  query: z.string().describe('What to look for, in plain words.'),
  scope: z.enum(['memory', 'files', 'all']).optional().describe('Where to look; everywhere when unset.'),
  limit: z.number().int().min(1).max(20).optional().describe('How many to return; 5 when unset.'),
});

/** Remembers one thing as a memo in `~/Memos`, and indexes it so it can be recalled. */
export const save = memory.declare<SaveFn>('save', () => ({ path: '', name: '', kind: 'note' }), {
  description:
    'Remembers one lasting thing about the user as a memo they can see: a preference, a person, a project, a fact or a note.',
  schema: { input: [saveInput] },
  mcp: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
});

/** Finds what was remembered, or what the user's files say, closest to a query first. */
export const recall = memory.declare<RecallFn>('recall', () => [], {
  description: 'Searches what you know: saved memories and the content of the user’s files, closest first.',
  schema: { input: [recallInput] },
  mcp: { readOnlyHint: true, openWorldHint: false },
});
