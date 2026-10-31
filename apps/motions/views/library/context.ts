import { createContext, effect, mutable } from '@airlib/react';
import type { WedyanGalleryLayout } from '@/components/WedyanGallery.js';
import { rowsOf } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import { ROOT } from '../motion.js';
import { changesListing, type LibraryView, listingOf, tileOf } from './listing.js';

/** A library window's state: where it is, how it shows it, and what's picked. */
export type LibraryState = {
  activeView: LibraryView;
  /** The folder All motions is in. */
  folder: string;
  viewMode: WedyanGalleryLayout;
  query: string;
  sidebarHidden: boolean;
  previewShown: boolean;
  /** One project's path while picking one, and the checked paths while picking several. */
  picked: string | string[] | null;
  several: boolean;
  /** Read by the listing, which runs again as it changes. */
  version: number;
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
    viewMode: 'grid',
    query: '',
    sidebarHidden: false,
    previewShown: false,
    picked: null,
    several: false,
    version: 0,
  });

  const items = dfs.list.with(() => {
    void state.version;
    return listingOf(state.activeView, state.folder);
  });

  dfs.watch(ROOT, (change) => {
    if (changesListing(change)) state.version += 1;
  });

  // Each place starts with nothing picked and nothing searched.
  effect(() => {
    void [state.activeView, state.folder];
    Object.assign(state, { picked: null, several: false, query: '' });
  });

  return { state, items, rows: () => rowsOf(items), tiles: () => rowsOf(items).flatMap(tileOf) };
}
