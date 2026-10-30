import { documentAt, documentsOf, drive, supply } from '@/lib/documents/store.js';
import type { MemoDocument } from '@/lib/documents/types.js';
import SAMPLES from '../data/memos.json';

// More memos than the seed holds, on the drive at their paths, until the drive serves the user's own.
supply(Object.entries(SAMPLES) as [string, MemoDocument][]);

/** Where the memos live: the Memos folder at the drive's root. */
export const ROOT = '/Memos';

/** Whose memos a tab shows: the user's own notes, or what Wedyan remembers. */
export type MemoGroup = 'personal' | 'memory';

/** A memo as Memo lists it: the `.memo` and where it is. */
export type Memo = { path: string; document: MemoDocument };

/** How much a memo weighs, normal when it says nothing. */
export type MemoPriority = NonNullable<MemoDocument['priority']> | 'normal';

/** Each priority, with its name, in the order lists lead with them. */
export const PRIORITIES: Record<MemoPriority, string> = { high: 'High', normal: 'Normal', low: 'Low' };

/**
 * Every memo kept in Memos.
 *
 * @returns Each `.memo` under the Memos folder still on the drive.
 */
export const memos = (): Memo[] => documentsOf('memo').filter(({ path }) => path.startsWith(`${ROOT}/`));

/**
 * The memos of one tab — the user's, or Wedyan's — high priority first, low last, the latest
 * changed first within each.
 *
 * @param group - Personal or Memory.
 * @returns Its memos, in that order.
 */
export function memosOf(group: MemoGroup): Memo[] {
  const rank = Object.keys(PRIORITIES) as MemoPriority[];
  return memos()
    .filter(({ document }) => (document.author.kind === 'agent' ? 'memory' : 'personal') === group)
    .sort(
      (a, b) =>
        rank.indexOf(priorityOf(a.document)) - rank.indexOf(priorityOf(b.document)) || b.document.updated.localeCompare(a.document.updated)
    );
}

/**
 * The memo at a path.
 *
 * @param path - Its path.
 * @returns Its document, unless there's no memo there.
 */
export function memoAt(path: string): MemoDocument | undefined {
  const document = documentAt(path);
  return document?.type === 'memo' ? document : undefined;
}

/**
 * How much a memo weighs.
 *
 * @param document - The memo.
 * @returns Its priority, normal when it has none.
 */
export const priorityOf = (document: MemoDocument): MemoPriority => document.priority ?? 'normal';

/**
 * Changes a memo in place and marks when it changed.
 *
 * @param document - The memo.
 * @param change - What to change in it.
 */
export function edit(document: MemoDocument, change: () => void): void {
  change();
  document.updated = new Date().toISOString();
}

/**
 * Makes a new, empty memo of the user's own in Memos.
 *
 * @returns Where it was put.
 */
export function newMemo(): string {
  // A deleted memo's path stays taken: the drive keeps hiding whatever is put back there.
  const taken = (path: string) => !!documentAt(path) || drive.deleted.includes(path);
  let path = `${ROOT}/Untitled.memo`;
  for (let n = 2; taken(path); n++) path = `${ROOT}/Untitled ${n}.memo`;
  const now = new Date().toISOString();
  const memo: MemoDocument = {
    type: 'memo',
    version: 1,
    id: crypto.randomUUID(),
    name: 'Untitled',
    created: now,
    updated: now,
    author: { kind: 'user' },
    kind: 'note',
    body: '',
  };
  supply([[path, memo]]);
  return path;
}

/**
 * Takes a memo off the drive, for this session.
 *
 * @param path - Where it is.
 */
export function remove(path: string): void {
  drive.deleted.push(path);
}

/**
 * A date as lists show it, e.g. `Oct 27`.
 *
 * @param iso - The date, as an ISO string.
 * @returns Its month and day.
 */
export const shortDate = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * A date and time as the open memo shows it, e.g. `Oct 30, 2026, 9:00 AM`.
 *
 * @param iso - The date, as an ISO string.
 * @returns Its date and time.
 */
export const longDate = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Who wrote a memo and when it last changed, in a line.
 *
 * @param document - The memo.
 * @returns E.g. `By Wedyan · Updated Oct 30, 2026, 9:00 AM`.
 */
export const factsOf = (document: MemoDocument): string =>
  `By ${document.author.kind === 'agent' ? 'Wedyan' : 'you'} · Updated ${longDate(document.updated)}`;
