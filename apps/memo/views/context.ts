import { mutable, onCleanup } from '@airlib/react';
import { type FileRow, rowsOf } from '@/lib/documents/rows.js';
import type { MemoDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { MEMOS_PATH } from '@/lib/share/system.js';
import { groupOf, LISTING, MEMO_EXTENSION, type MemoGroup, type MemoPriority, newMemo, PRIORITIES, rowPriority } from './library.js';

/** One Memo window, for every part of it. */
export type Memos = ReturnType<typeof createMemos>;

/** What the open window lists, for what reads it from outside: the prompt's mentions. */
export const shown: { memos?: Memos } = {};

/**
 * A Memo window's one source of truth: its state, and the real listing of the Memos folder, which
 * follows what's added or removed anywhere in the session.
 *
 * @returns The window's memos.
 */
export function createMemos() {
  const state = mutable({
    group: 'personal' as MemoGroup,
    // Each tab keeps its own pick; until the user picks, its first memo is open.
    picked: { personal: null, memory: null } as Record<MemoGroup, string | null>,
    query: '',
    sidebar: true,
    /** Whether a new one is on its way, so it's only made once. */
    creating: false,
    /** Read by the listing, which is asked for again as the folder changes. */
    asked: 0,
  });

  const listing = dfs.list.with(() => {
    void state.asked;
    return LISTING;
  });

  /** A tab's memos: high priority first, low last, the latest changed first within each. */
  const rows = (group: MemoGroup = state.group): FileRow[] => {
    const rank = Object.keys(PRIORITIES) as MemoPriority[];
    return rowsOf(listing)
      .filter((row) => groupOf(row) === group)
      .sort((a, b) => rank.indexOf(rowPriority(a)) - rank.indexOf(rowPriority(b)) || (b.updated ?? '').localeCompare(a.updated ?? ''));
  };

  /** The memo open beside the list: the tab's pick, or its first. */
  const opened = (): string | null => state.picked[state.group] ?? rows()[0]?.path ?? null;

  /** Takes a row out of the listing, and whatever was open there goes with it. */
  const drop = (path: string) => {
    const listed = rowsOf(listing);
    const index = listed.findIndex((row) => row.path === path);
    if (index >= 0) listed.splice(index, 1);
    for (const group of Object.keys(state.picked) as MemoGroup[]) {
      if (state.picked[group] === path) state.picked[group] = null;
    }
  };

  // An agent's work and other desktops: what's gone goes, and what's new or changed is asked for.
  dfs.watch(MEMOS_PATH, ({ path, removed }) => {
    if (removed) drop(path);
    else if (path.endsWith(MEMO_EXTENSION)) state.asked += 1;
  });

  const memos = {
    state,
    listing,
    rows,
    opened,

    /** Opens a memo in its own tab, once it's listed. */
    open(path: string): boolean {
      const row = rowsOf(listing).find((listed) => listed.path === path);
      if (!row) return false;
      state.group = groupOf(row);
      state.picked[state.group] = path;
      state.query = '';
      return true;
    },

    /** Makes a new memo, the user's own, and opens it; the listing hears of it as it does of any new file. */
    async create() {
      if (state.creating) return;
      state.creating = true;
      state.group = 'personal';
      state.query = '';
      try {
        state.picked.personal = await newMemo();
      } finally {
        state.creating = false;
      }
    },

    /** Deletes the open memo; the tab's first opens in its place. */
    async remove() {
      const path = opened();
      if (!path) return;
      // Closed first: an editor still open would write the file back.
      drop(path);
      await dfs.remove(path);
    },

    /** Puts what's changed in the open memo on its row: a held file's save tells no one. */
    changed(path: string, document: MemoDocument) {
      const row = rowsOf(listing).find((listed) => listed.path === path);
      if (!row) return;
      row.name = document.name;
      row.description = document.body;
      row.status = document.priority;
      row.updated = document.updated;
    },
  };

  shown.memos = memos;
  onCleanup(() => {
    if (shown.memos === memos) shown.memos = undefined;
  });

  return memos;
}
