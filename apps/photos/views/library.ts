import { createContext, mutable } from '@airlib/react';
import { confirmDialog } from '@/components/ConfirmHost.js';
import { deleteConfirm } from '@/components/confirm.js';
import type { WedyanGalleryLayout } from '@/components/WedyanGallery.js';
import { type FileRow, rowsOf } from '@/lib/documents/rows.js';
import { LOUNGE } from '@/lib/kernel/workspace.h.js';
import { dfs } from '@/lib/share/dfs.js';
import { HOME, isPicture, PICTURES, ROOT, STILL_FILE } from './listing.js';
import { generation, STILL_CHANGED, startStill } from './making.js';
import { openStill } from './Still.js';

/**
 * What a browser window holds: a picture to show, by path, and what the dock is set to, the one
 * source every agent's request is made with while this window is in front.
 */
export type PhotosData = { picture?: string; generation: typeof generation } | undefined;

/** A browser window's state: how it shows the pictures, and what's picked. */
export type LibraryState = {
  viewMode: WedyanGalleryLayout;
  query: string;
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
 * A browser window's one source of truth: its state, and the one listing of every picture on the
 * drive, which follows what's written or removed anywhere in the session.
 *
 * @param data - What the window was opened with.
 * @returns The library.
 */
export function createLibrary(data: PhotosData) {
  const picture = data?.picture;
  const state = mutable<LibraryState>({
    viewMode: 'grid',
    query: '',
    previewShown: Boolean(picture),
    picked: picture ?? null,
    several: false,
    viewing: false,
    index: 0,
    creating: false,
    asked: 0,
  });

  const items = dfs.list.with(() => {
    void state.asked;
    return PICTURES;
  });

  /** Takes rows out of the listing: those at these paths. */
  const drop = (paths: string[]) => {
    const listed = rowsOf(items);
    for (let index = listed.length - 1; index >= 0; index -= 1) {
      if (paths.includes(listed[index].path)) listed.splice(index, 1);
    }
  };

  // A still shows another picture: its window holds it, so only its row needs telling.
  LOUNGE.subscribe((event) => {
    if (event.type !== STILL_CHANGED) return;
    const row = rowsOf(items).find(({ path }) => path === event.data.path);
    if (row) Object.assign(row, { thumbnail: event.data.picture, src: event.data.picture, updated: event.data.updated });
  });

  // What's written or removed outside this window: what's gone goes, and the rest is asked for again.
  dfs.watch(HOME, ({ path, removed }) => {
    if (removed) drop([path]);
    else if (isPicture(path)) state.asked += 1;
  });

  return {
    state,
    items,

    /** The images listed, for the viewer. */
    images: () => rowsOf(items).filter((row) => row.kind === 'image'),

    /** The picked rows. */
    picks(): FileRow[] {
      const paths = [state.picked].flat();
      return rowsOf(items).filter((row) => paths.includes(row.path));
    },

    /** Opens what a row is: a still project in a window of its own, an image in the viewer. */
    open(row: FileRow) {
      if (row.kind === 'still') return openStill(row.path);
      const images = rowsOf(items).filter((listed) => listed.kind === 'image');
      state.index = Math.max(
        images.findIndex(({ path }) => path === row.path),
        0
      );
      state.viewing = true;
    },

    /** Starts an empty still project and opens it; the listing hears of it as it does of any new file. */
    async create() {
      if (state.creating) return;
      state.creating = true;
      try {
        openStill(await startStill(ROOT));
      } finally {
        state.creating = false;
      }
    },

    /** Deletes what's picked, once the user confirms: they stop showing at once, and come back if the drive refuses. */
    async remove() {
      const paths = [state.picked].flat() as string[];
      const { title, description, action } = deleteConfirm(paths.length, 'item', 'items', 'your drive');
      const confirmed = await confirmDialog({ title, message: description, action, color: 'error' });
      if (!confirmed) return;

      Object.assign(state, { several: false, picked: null });
      generation.references = generation.references.filter((reference) => !paths.includes(reference.path));
      drop(paths);
      await Promise.all(paths.map(removeFile)).catch(() => {
        state.asked += 1;
      });
    },
  };
}

/**
 * Takes a picture off the drive: a still with the folder keeping its attempts.
 *
 * @param path - What to remove.
 * @returns When it's gone.
 */
async function removeFile(path: string): Promise<void> {
  await dfs.remove(path);
  if (!STILL_FILE.test(path)) return;
  const attempts = path.replace(STILL_FILE, '');
  if (await dfs.exists(attempts)) await dfs.remove(attempts, { recursive: true });
}
