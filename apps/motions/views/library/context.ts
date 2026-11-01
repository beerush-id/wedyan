import { createContext, effect, mutable, untrack } from '@airlib/react';
import type { WedyanGalleryLayout } from '@/components/WedyanGallery.js';
import { parentOf } from '@/lib/documents/paths.js';
import { type FileRow, rowsOf } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import { LOUNGE, LOUNGE_EVENT } from '../../../../lib/kernel/workspace.h.js';
import { openMotion } from '../composer/index.js';
import { animation, newMotion, ROOT } from '../motion.js';
import { changesListing, type LibraryView, listingOf, orderOf } from './listing.js';

/** A library window's state: where it is, how it shows it, and what's picked. */
export type LibraryState = {
  activeView: LibraryView;
  /** The folder All motions is in. */
  folder: string;
  /** The folders opened to get there, with what they're called: a path only says their ids. */
  trail: { path: string; name: string }[];
  /** Whether what's picked is being named, right after it's made or asked to be. */
  renaming: boolean;
  viewMode: WedyanGalleryLayout;
  query: string;
  sidebarHidden: boolean;
  previewShown: boolean;
  /** One project's path while picking one, and the checked paths while picking several. */
  picked: string | string[] | null;
  several: boolean;
  /** Whether a new motion is on its way, so it's only made once. */
  creating: boolean;
  /** Read by the listing, which is asked for again as it changes: after a failure, or for what nobody here holds. */
  asked: number;
};

/** One library window, for every part of it. */
export type MotionLibrary = ReturnType<typeof createLibrary>;

/** The library of the window a part is in. */
export const libraryCtx = createContext<MotionLibrary>();

/**
 * A library window's one source of truth: its state, and the one listing it asks for, which follows
 * where the window is and what's added, saved or removed anywhere in the session.
 *
 * @returns The library.
 */
export function createLibrary() {
  const state = mutable<LibraryState>({
    activeView: 'recent',
    folder: ROOT,
    trail: [],
    renaming: false,
    viewMode: 'grid',
    query: '',
    sidebarHidden: false,
    previewShown: false,
    picked: null,
    several: false,
    creating: false,
    asked: 0,
  });

  const items = dfs.list.with(() => {
    void state.asked;
    return listingOf(state.activeView, state.folder);
  });

  /** Puts a new row in the listing, when it's in the folder being browsed. */
  const add = (row: FileRow) => {
    if (state.activeView === 'all' && parentOf(row.path) === state.folder) rowsOf(items).push(row);
  };

  /** Takes rows out of the listing: those at these paths, and the projects in them. */
  const drop = (paths: string[]) => {
    const rows = rowsOf(items);
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const { path } = rows[index];
      if (paths.includes(path) || paths.includes(parentOf(path))) rows.splice(index, 1);
    }
  };

  LOUNGE.subscribe((e) => {
    if (e.type === LOUNGE_EVENT.RENAMED) {
      const row = rowsOf(items).find(({ path }) => path === e.data.path);
      if (row) row.name = e.data.title;
    } else if (e.type === LOUNGE_EVENT.CREATED) {
      add(e.data);
    } else if (e.type === LOUNGE_EVENT.REMOVED) {
      drop(e.data);
    }
  });

  // An agent's work, which no desktop holds: what's gone goes, and what isn't here is asked for.
  dfs.watch(ROOT, ({ path, removed }) => {
    if (removed) drop([path]);
    else if (changesListing(state.activeView, state.folder, path) && !rowsOf(items).some((row) => row.path === path)) {
      state.asked += 1;
    }
  });

  // Each place starts with nothing picked and nothing searched.
  effect(() => {
    void [state.activeView, state.folder];
    Object.assign(state, { picked: null, several: false, query: '' });
  });

  return {
    state,
    items,
    /** What's listed, in the order this place shows it: settled by the listing, so typing a name moves nothing. */
    rows: () => {
      const { activeView } = state;
      const listed = rowsOf(items);
      return listed.length ? untrack(() => orderOf(activeView, listed)) : listed;
    },

    /** The picked row itself, which whoever shows it reads and writes. */
    get selected() {
      return rowsOf(items).find((row) => row.path === state.picked);
    },

    add,
    drop,

    /** Starts a new motion and opens it; the listing hears of it as it does of any new file. */
    async create() {
      if (state.creating) return;
      state.creating = true;
      try {
        const { path } = await newMotion('New motion', animation.aspect, '');
        openMotion(path);
      } finally {
        state.creating = false;
      }
    },

    /** Goes into a folder. */
    enter({ path, name }: { path: string; name: string }) {
      state.trail = [...state.trail, { path, name }];
      state.folder = path;
    },

    /** Goes up a folder. */
    up() {
      const trail = state.trail.slice(0, -1);
      state.trail = trail;
      state.folder = trail.at(-1)?.path ?? ROOT;
    },
  };
}
