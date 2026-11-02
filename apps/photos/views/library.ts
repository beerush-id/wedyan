import { createContext, effect, mutable } from '@airlib/react';
import { confirmDialog } from '@/components/ConfirmHost.js';
import { deleteConfirm } from '@/components/confirm.js';
import type { WedyanGalleryLayout } from '@/components/WedyanGallery.js';
import { parentOf } from '@/lib/documents/paths.js';
import { type FileRow, rowsOf } from '@/lib/documents/rows.js';
import { LOUNGE } from '@/lib/kernel/workspace.h.js';
import { dfs } from '@/lib/share/dfs.js';
import { changesListing, type FolderView, type LibraryView, listingOf, orderOf, ROOTS, shownRows, STILL_FILE, VIEW_LABELS } from './listing.js';
import { destination, generation, STILL_CHANGED, startStill } from './making.js';
import { openStill } from './Still.js';

/** What a browser window can be opened with: a picture to show, by path. */
export type PhotosData = { picture?: string } | undefined;

/** A browser window's state: where it is, how it shows it, and what's picked. */
export type LibraryState = {
  activeView: LibraryView;
  /** The folders opened to get where each folder place is, with what they're called. */
  trails: Record<FolderView, { path: string; name: string }[]>;
  viewMode: WedyanGalleryLayout;
  query: string;
  sidebarHidden: boolean;
  previewShown: boolean;
  /** One path while picking one, and the checked paths while picking several. */
  picked: string | string[] | null;
  several: boolean;
  /** Whether the viewer is showing the images listed, and which one. */
  viewing: boolean;
  index: number;
  /** Whether a new still is on its way, so it's only made once. */
  creating: boolean;
  /** Read by the listing, which is asked for again as it changes: after a failure, or for what nobody here holds. */
  asked: number;
};

/** One browser window, for every part of it. */
export type PhotoLibrary = ReturnType<typeof createLibrary>;

/** The library of the window a part is in. */
export const libraryCtx = createContext<PhotoLibrary>();

/**
 * A browser window's one source of truth: its state, and the one listing it asks for, which follows
 * where the window is and what's written or removed anywhere in the session.
 *
 * @param data - What the window was opened with.
 * @returns The library.
 */
export function createLibrary(data: PhotosData) {
  const state = mutable<LibraryState>({
    ...startOf(data?.picture),
    viewMode: 'grid',
    query: '',
    sidebarHidden: false,
    several: false,
    viewing: false,
    index: 0,
    creating: false,
    asked: 0,
  });

  const trail = (): LibraryState['trails'][FolderView] => (state.activeView === 'generative' ? [] : state.trails[state.activeView]);
  /** The folder being browsed; none in Generative, which is in every folder. */
  const folder = () => (state.activeView === 'generative' ? undefined : (trail().at(-1)?.path ?? ROOTS[state.activeView]));

  const items = dfs.list.with(() => {
    void state.asked;
    return listingOf(folder());
  });

  /** What's listed that Photos shows, in the order this place shows it. */
  const rows = () => orderOf(state.activeView, shownRows(rowsOf(items)));
  const images = () => rows().filter((row) => row.kind === 'image');
  const picks = () => {
    const paths = Array.isArray(state.picked) ? state.picked : state.picked ? [state.picked] : [];
    return rows().filter((row) => paths.includes(row.path));
  };

  /** Takes rows out of the listing: those at these paths, and what's in them. */
  const drop = (paths: string[]) => {
    const listed = rowsOf(items);
    for (let index = listed.length - 1; index >= 0; index -= 1) {
      const { path } = listed[index];
      if (paths.includes(path) || paths.includes(parentOf(path))) listed.splice(index, 1);
    }
  };

  // A still shows another picture: its window holds it, so only its row needs telling.
  LOUNGE.subscribe((event) => {
    if (event.type !== STILL_CHANGED) return;
    const row = rowsOf(items).find(({ path }) => path === event.data.path);
    if (row) Object.assign(row, { thumbnail: event.data.picture, src: event.data.picture, updated: event.data.updated });
  });

  // What's written or removed outside this window: what's gone goes, and the rest is asked for again.
  for (const root of Object.values(ROOTS)) {
    dfs.watch(root, ({ path, removed }) => {
      if (removed) drop([path]);
      else if (changesListing(folder(), path)) state.asked += 1;
    });
  }

  // What's gathered from every folder is in none of them, so there it's Photos itself.
  effect(() => {
    destination.folder = folder() ?? ROOTS.photos;
    return () => {
      destination.folder = ROOTS.photos;
    };
  });

  // Each place starts with nothing picked and nothing searched; the first is where the window opened.
  let arrived = false;
  effect(() => {
    void [state.activeView, folder()];
    if (arrived) Object.assign(state, { picked: null, several: false, query: '', viewing: false });
    arrived = true;
  });

  return {
    state,
    items,
    rows,
    images,
    picks,

    /** What this place is called: the folder opened, or the place itself. */
    get title() {
      return trail().at(-1)?.name ?? VIEW_LABELS[state.activeView];
    },

    /** Whether there's a folder to go up to. */
    get inFolder() {
      return trail().length > 0;
    },

    /** The picked row, while picking one. */
    get selected() {
      return rowsOf(items).find((row) => row.path === state.picked);
    },

    /** Opens what a row is: a folder here, a still project in a window of its own, an image in the viewer. */
    open(row: FileRow) {
      if (row.kind === 'folder') {
        if (state.activeView !== 'generative') state.trails[state.activeView] = [...trail(), { path: row.path, name: row.name }];
      } else if (row.kind === 'still') {
        openStill(row.path);
      } else {
        state.index = Math.max(
          images().findIndex(({ path }) => path === row.path),
          0
        );
        state.viewing = true;
      }
    },

    /** Goes up a folder. */
    up() {
      if (state.activeView !== 'generative') state.trails[state.activeView] = trail().slice(0, -1);
    },

    /** Starts an empty still project where the window is and opens it; the listing hears of it as it does of any new file. */
    async create() {
      if (state.creating) return;
      state.creating = true;
      try {
        openStill(await startStill(destination.folder));
      } finally {
        state.creating = false;
      }
    },

    /** Deletes what's picked, once the user confirms: they stop showing at once, and come back if the drive refuses. */
    async remove() {
      const picked = picks();
      const { title, description, action } = deleteConfirm(picked.length, 'item', 'items', 'your drive');
      const inside = picked.some((row) => row.kind === 'folder') ? ' Everything in a folder goes with it.' : '';
      const confirmed = await confirmDialog({ title, message: `${description}${inside}`, action, color: 'error' });
      if (!confirmed) return;

      const paths = picked.map((row) => row.path);
      Object.assign(state, { several: false, picked: null });
      generation.references = generation.references.filter((reference) => !paths.includes(reference.path));
      drop(paths);
      await Promise.all(picked.map(removeRow)).catch(() => {
        state.asked += 1;
      });
    },
  };
}

/**
 * Where a window starts: Photos, or the folder of the picture it was opened to show, with that
 * picture picked and previewed.
 *
 * @param picture - The picture's path.
 * @returns The place, and what's picked there.
 */
function startOf(picture?: string): Pick<LibraryState, 'activeView' | 'trails' | 'picked' | 'previewShown'> {
  const trails: LibraryState['trails'] = { photos: [], pictures: [] };
  const views = Object.keys(ROOTS) as FolderView[];
  const view = views.find((each) => picture?.startsWith(`${ROOTS[each]}/`));
  if (!view || !picture) return { activeView: 'photos', trails, picked: null, previewShown: false };

  let path = ROOTS[view];
  for (const name of picture.slice(path.length + 1).split('/').slice(0, -1)) {
    path = `${path}/${name}`;
    trails[view].push({ path, name });
  }
  return { activeView: view, trails, picked: picture, previewShown: true };
}

/**
 * Takes a row off the drive: a folder with what's in it; a still with the folder keeping its attempts.
 *
 * @param row - What to remove.
 * @returns When it's gone.
 */
async function removeRow({ kind, path }: FileRow): Promise<void> {
  await dfs.remove(path, kind === 'folder' ? { recursive: true } : undefined);
  if (kind !== 'still') return;
  const attempts = path.replace(STILL_FILE, '');
  if (await dfs.exists(attempts)) await dfs.remove(attempts, { recursive: true });
}
