import { mutable, onCleanup } from '@airlib/react';
import { confirmDialog } from '@/components/ConfirmHost.js';
import type { WedyanGalleryLayout } from '@/components/WedyanGallery.js';
import { parentOf } from '@/lib/documents/paths.js';
import { type FileRow, rowsOf } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import { linkTo, requestLink } from '@/lib/systems/public.js';
import { HOME, isShown, orderOf, type Place, placesOf } from './listing.js';

/** One Files window, for every part of it. */
export type Files = ReturnType<typeof createFiles>;

/** What the open window lists, for what reads it from outside: the prompt's mentions. */
export const shown: { files?: Files } = {};

/**
 * A Files window's one source of truth: where it is, and the real listing of the home and of the
 * folder open, which follow what changes anywhere in the session.
 *
 * @returns The window's files.
 */
export function createFiles() {
  const state = mutable({
    /** The folders opened to get here, from the home: a path only says their ids. */
    trail: [] as Place[],
    // One file's path while picking one, and the checked paths while picking several; both layouts share it.
    picked: null as string | string[] | null,
    several: false,
    layout: 'grid' as WedyanGalleryLayout,
    query: '',
    /** Read by each listing, which is asked for again as what's in it changes. */
    asked: 0,
  });

  const folder = () => state.trail.at(-1)?.path ?? HOME;

  const home = dfs.list.with(() => {
    void state.asked;
    return [HOME, {}] as [string, object];
  });
  const items = dfs.list.with(() => {
    void state.asked;
    return [folder(), {}] as [string, object];
  });

  /** What the folder open holds, folders first, without what's the system's own. */
  const rows = (): FileRow[] => orderOf(rowsOf(items).filter(isShown));

  /** The paths picked: the one file, or every checked one. */
  const pickedPaths = (): string[] => (Array.isArray(state.picked) ? state.picked : state.picked ? [state.picked] : []);

  /** Lets go of what's picked: the mode first, while the value is still a list. */
  const letGo = () => {
    state.several = false;
    state.picked = null;
  };

  /** Goes to a folder by the folders leading to it. */
  const go = (trail: Place[]) => {
    letGo();
    state.query = '';
    state.trail = trail;
  };

  // An agent's work and other desktops: a change to what's listed lists it again.
  dfs.watch(HOME, ({ path }) => {
    if (parentOf(path) === folder() || parentOf(path) === HOME) state.asked += 1;
  });

  const files = {
    state,
    home,
    items,
    rows,
    pickedPaths,

    /** The picked rows. */
    picks: (): FileRow[] => rowsOf(items).filter((row) => pickedPaths().includes(row.path)),

    /** The folders down the side. */
    places: (): Place[] => placesOf(rowsOf(home)),

    /** What the place open is called. */
    get title() {
      return state.trail.at(-1)?.name ?? 'Home';
    },

    /** The folder open, by its path. */
    get folder() {
      return folder();
    },

    /** Goes to a folder down the side, or the home. */
    goTo(place?: Place) {
      go(place ? [place] : []);
    },

    /** Goes up a folder. */
    up() {
      go(state.trail.slice(0, -1));
    },

    /** Opens what's listed: a folder here, anything else where it's shown. */
    open(path: string) {
      const row = rowsOf(items).find((listed) => listed.path === path);
      if (row?.isDirectory) go([...state.trail, { path: row.path, name: row.name }]);
      else if (row) void requestLink(linkTo('preview', row.path));
    },

    /** Deletes what's picked, once the user confirms. If the drive refuses, it's listed again. */
    async remove() {
      const picked = files.picks();
      if (!picked.length) return;
      const inside = picked.some((row) => row.isDirectory) ? ' Everything in a folder goes with it.' : '';
      const confirmed = await confirmDialog({
        title: picked.length === 1 ? `Delete ${picked[0].name}?` : `Delete ${picked.length} items?`,
        message: `${picked.length === 1 ? 'It’s' : 'They’re'} taken off your drive.${inside}`,
        action: 'Delete',
        color: 'error',
      });
      if (!confirmed) return;
      letGo();
      try {
        await Promise.all(picked.map((row) => dfs.remove(row.path, row.isDirectory ? { recursive: true } : undefined)));
      } finally {
        state.asked += 1;
      }
    },
  };

  shown.files = files;
  onCleanup(() => {
    if (shown.files === files) shown.files = undefined;
  });

  return files;
}
