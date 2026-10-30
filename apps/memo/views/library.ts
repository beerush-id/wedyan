import { documentsOf, drive, nameOf, supply } from '@/lib/documents/store.js';
import type { MemoDocument } from '@/lib/documents/types.js';
import SAMPLES from '../data/memos.json';

// More memos than the seed holds, on the drive at their paths, until the drive serves the user's own.
supply(Object.entries(SAMPLES) as [string, MemoDocument][]);

/** Where Memo browses from: the Memos folder at the drive's root. */
export const ROOT = '/Memos';

/** Each kind a memo can be, with its name. */
export const KINDS: Record<MemoDocument['kind'], string> = {
  note: 'Note',
  preference: 'Preference',
  person: 'Person',
  project: 'Project',
  fact: 'Fact',
};

/** A memo as Memo lists it: the `.memo` and where it is. */
export type Memo = { path: string; document: MemoDocument };

/**
 * What a listing is asked for: one folder's contents, every memo carrying a tag, the pinned memos,
 * or the memos with a reminder.
 */
export type ListingRequest = { folder: string } | { tag: string } | { pinned: true } | { reminders: true };

/** One thing a listing holds: a folder, with how much it holds; or a memo. */
export type Entry = { kind: 'folder'; path: string; name: string; count: number } | { kind: 'memo'; path: string; name: string; memo: Memo };

/**
 * Every memo kept in Memos, in every folder.
 *
 * @returns Each `.memo` under the Memos folder still on the drive.
 */
export const memos = (): Memo[] => documentsOf('memo').filter(({ path }) => path.startsWith(`${ROOT}/`));

/**
 * Lists Memo as asked: a folder's contents, every memo carrying a tag, the pinned ones, or those with
 * a reminder, soonest first. A mock of the drive's listing request, answered from the memos at hand.
 *
 * @param request - A folder, a tag, the pinned, or the reminders.
 * @returns What the folder holds, or the memos asked for.
 */
export function listing(request: ListingRequest): Entry[] {
  if ('folder' in request) return folderOf(request.folder);
  if ('tag' in request) return byName(memos().filter(({ document }) => document.tags?.includes(request.tag)).map(entryOf));
  if ('pinned' in request) return byName(memos().filter(({ document }) => document.pinned).map(entryOf));
  return memos()
    .filter(({ document }) => document.remind)
    .sort((a, b) => (a.document.remind as string).localeCompare(b.document.remind as string))
    .map(entryOf);
}

/**
 * Every tag the memos carry, each once, in name order: Memo's albums.
 *
 * @returns The tags.
 */
export const tags = (): string[] => [...new Set(memos().flatMap(({ document }) => document.tags ?? []))].sort();

/**
 * A tag as the side and the title name it, e.g. `Hackathon` for `hackathon`.
 *
 * @param tag - The tag.
 * @returns Its name.
 */
export const tagLabel = (tag: string): string => `${tag[0].toUpperCase()}${tag.slice(1)}`;

/**
 * Whether every one of these memos is pinned.
 *
 * @param paths - The memos.
 * @returns Whether all of them are.
 */
export function allPinned(paths: string[]): boolean {
  return paths.every((path) => memoAt(path)?.pinned);
}

/**
 * Pins these memos, or unpins them when every one is pinned already.
 *
 * @param paths - The memos.
 */
export function togglePinned(paths: string[]): void {
  const pinned = !allPinned(paths);
  for (const path of paths) {
    const document = memoAt(path);
    if (document) edit(document, () => setPinned(document, pinned));
  }
}

/**
 * Pins a memo or unpins it; an unpinned memo leaves the field out, as the format keeps it optional.
 *
 * @param document - The memo.
 * @param pinned - Whether it's pinned.
 */
export function setPinned(document: MemoDocument, pinned: boolean): void {
  if (pinned) document.pinned = true;
  else delete document.pinned;
}

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
 * A free path for a new memo in a folder: `Untitled.memo`, or the first `Untitled N.memo` not taken.
 *
 * @param folder - The folder it goes in.
 * @returns The path.
 */
export function freeMemoPath(folder: string): string {
  // A deleted memo's path stays taken: the drive keeps hiding whatever is put back there.
  const taken = new Set([...memos().map((memo) => memo.path), ...drive.deleted]);
  let path = `${folder}/Untitled.memo`;
  for (let n = 2; taken.has(path); n++) path = `${folder}/Untitled ${n}.memo`;
  return path;
}

/**
 * A date as lists show it, e.g. `Oct 27`.
 *
 * @param iso - The date, as an ISO string.
 * @returns Its month and day.
 */
export const shortDate = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * A date and time as the preview and the memo show it, e.g. `Oct 30, 2026, 9:00 AM`.
 *
 * @param iso - The date, as an ISO string.
 * @returns Its date and time.
 */
export const longDate = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Who wrote a memo, in words.
 *
 * @param document - The memo.
 * @returns `You`, or `Wedyan` for an agent's.
 */
export const authorOf = (document: MemoDocument): string => (document.author.kind === 'agent' ? 'Wedyan' : 'You');

/**
 * What a folder holds: its folders, then its memos, each in name order. A folder shows how many
 * memos it holds, all the way down.
 *
 * @param folder - The folder's path, e.g. `/Memos`.
 * @returns What it holds.
 */
function folderOf(folder: string): Entry[] {
  const folders = new Map<string, number>();
  const entries: Entry[] = [];
  for (const memo of memos()) {
    if (!memo.path.startsWith(`${folder}/`)) continue;
    const rest = memo.path.slice(folder.length + 1);
    const slash = rest.indexOf('/');
    if (slash < 0) entries.push(entryOf(memo));
    else {
      const child = `${folder}/${rest.slice(0, slash)}`;
      folders.set(child, (folders.get(child) ?? 0) + 1);
    }
  }
  const subfolders: Entry[] = [...folders].map(([path, count]) => ({ kind: 'folder', path, name: nameOf(path), count }));
  return [...byName(subfolders), ...byName(entries)];
}

/**
 * The memo at a path in Memos.
 *
 * @param path - The memo's path.
 * @returns Its document, unless there's none there.
 */
function memoAt(path: string): MemoDocument | undefined {
  return memos().find((memo) => memo.path === path)?.document;
}

/**
 * A memo as a listing holds it, by its path.
 *
 * @param memo - The memo.
 * @returns Its entry.
 */
function entryOf(memo: Memo): Entry {
  return { kind: 'memo', path: memo.path, name: memo.document.name, memo };
}

/**
 * Entries in name order.
 *
 * @param entries - The entries.
 * @returns The same entries, ordered by name.
 */
function byName(entries: Entry[]): Entry[] {
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
