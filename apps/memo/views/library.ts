import { mutable } from '@airlib/react';
import type { ListOptions } from '@irpclib/r2-file';
import { FILE_TYPES } from '@/lib/documents/file-types.js';
import { newHeader, newId } from '@/lib/documents/paths.js';
import type { FileRow } from '@/lib/documents/rows.js';
import type { MemoDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { MEMOS_PATH } from '@/lib/share/system.js';

/** The memo a link asked for, until the window opens it. */
export const opening = mutable({ path: null as string | null });

/** What a memo's file ends with. */
export const MEMO_EXTENSION = '.memo';

/** What Memo lists: every memo in the Memos folder. */
export const LISTING: [string, ListOptions] = [MEMOS_PATH, { filter: { type: FILE_TYPES.memo } }];

/** What a memo with no name yet is called. */
const UNTITLED = 'Untitled';

/** Whose memos a tab shows: the user's own notes, or what Wedyan remembers. */
export type MemoGroup = 'personal' | 'memory';

/** How much a memo weighs, normal when it says nothing. */
export type MemoPriority = NonNullable<MemoDocument['priority']> | 'normal';

/** Each priority, with its name, in the order lists lead with them. */
export const PRIORITIES: Record<MemoPriority, string> = { high: 'High', normal: 'Normal', low: 'Low' };

/**
 * Whose a listed memo is. A row says only when the user wrote it: until Memo kept them, every memo
 * on a drive was one Wedyan saved.
 *
 * @param row - The memo's row.
 * @returns Its tab.
 */
export const groupOf = (row: FileRow): MemoGroup => (row.author === 'You' ? 'personal' : 'memory');

/**
 * How much a listed memo weighs.
 *
 * @param row - The memo's row.
 * @returns Its priority, normal when it has none.
 */
export const rowPriority = (row: FileRow): MemoPriority => (row.status as MemoPriority | undefined) ?? 'normal';

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
 * @returns Where it was put, once it's written.
 */
export async function newMemo(): Promise<string> {
  const path = `${MEMOS_PATH}/${newId()}${MEMO_EXTENSION}`;
  const memo: MemoDocument = { ...newHeader(path, MEMO_EXTENSION), name: UNTITLED, type: 'memo', kind: 'note', body: '' };
  await dfs.write(path, memo as never);
  return path;
}

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
