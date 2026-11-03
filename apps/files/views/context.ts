import { createContext, mutable, onCleanup } from '@airlib/react';
import { confirmDialog } from '@/components/ConfirmHost.js';
import type { WedyanGalleryLayout } from '@/components/WedyanGallery.js';
import { parentOf } from '@/lib/documents/paths.js';
import { type FileRow, rowsOf } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import { requestLink } from '@/lib/systems/public.js';
import { FOLDER_TYPE, FOUND_LIMIT, HOME, type Place, SEARCH_WAIT } from './listing.js';

/** One Files window, for every part of it. */
export type Files = ReturnType<typeof createFiles>;

/** The Files window, which its parts read. */
export const filesCtx = createContext<Files>();

/** What the open window lists, for what reads it from outside: the prompt's mentions. */
export const shown: { files?: Files } = {};

/**
 * A Files window's one source of truth: where it is, the real listing of the drive's top folders and
 * of the folder open, which follow what changes anywhere in the session, and what a search finds.
 *
 * @returns The window's files.
 */
export function createFiles() {
  const state = mutable({
    /** The folder open. */
    here: HOME as Place,
    /** The folders opened to get here: a path only says their ids. */
    trail: [] as Place[],
    // One file's path while picking one, and the checked paths while picking several; both layouts share it.
    picked: null as string | string[] | null,
    several: false,
    layout: 'grid' as WedyanGalleryLayout,
    query: '',
    /** Read by each listing, which is asked for again as what's in it changes. */
    asked: 0,
  });

  const places = dfs.list.with(() => {
    void state.asked;
    return [HOME.path, { filter: { type: FOLDER_TYPE } }] as [string, object];
  });
  const items = dfs.list.with(() => {
    void state.asked;
    return [state.here.path, {}] as [string, object];
  });
  const found = dfs.search.when(() => {
    void state.asked;
    return [state.query, { limit: FOUND_LIMIT }] as [string, object];
  }, SEARCH_WAIT);

  /** Goes somewhere, letting go of what's picked: the mode first, while the value is still a list. */
  const go = (here: Place, trail: Place[]) => {
    state.several = false;
    state.picked = null;
    state.query = '';
    state.trail = trail;
    state.here = here;
  };

  // An agent's work and other desktops: a change to what's listed lists it again.
  dfs.watch(HOME.path, ({ path }) => {
    if (parentOf(path) === state.here.path || parentOf(path) === HOME.path) state.asked += 1;
  });

  const files = {
    state,
    places,
    items,
    found,

    /** Goes to a folder down the side, or the home. */
    goTo(place: Place) {
      if (place.path === state.here.path) state.query = '';
      else go(place, place === HOME ? [] : [HOME]);
    },

    /** Goes up a folder. */
    up() {
      go(state.trail.at(-1) ?? HOME, state.trail.slice(0, -1));
    },

    /** Opens a row: a folder here, from wherever it was found; a file in the app that opens its kind. */
    open(row: FileRow) {
      if (!row.isDirectory) return void requestLink(row.path);
      go({ path: row.path, name: row.name }, state.query ? [HOME] : [...state.trail, state.here]);
    },

    /** Deletes what's picked, once the user confirms; the listing hears of it as it does of any change. */
    async remove() {
      const paths = [state.picked].flat();
      const picked = rowsOf(state.query ? found : items).filter((row) => paths.includes(row.path));
      const inside = picked.some((row) => row.isDirectory) ? ' Everything in a folder goes with it.' : '';
      const confirmed = await confirmDialog({
        title: picked.length === 1 ? `Delete ${picked[0].name}?` : `Delete ${picked.length} items?`,
        message: `${picked.length === 1 ? 'It’s' : 'They’re'} taken off your drive.${inside}`,
        action: 'Delete',
        color: 'error',
      });
      if (!confirmed) return;
      state.several = false;
      state.picked = null;
      await Promise.all(picked.map((row) => dfs.remove(row.path, row.isDirectory ? { recursive: true } : undefined)));
    },
  };

  shown.files = files;
  onCleanup(() => {
    if (shown.files === files) shown.files = undefined;
  });

  return files;
}
