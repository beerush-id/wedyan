import { $bind, $use, mutable, Show, Snippet } from '@airlib/react';
import { Button, Divider } from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowSidebar,
  WindowSidebarLabel,
  WindowSidebarPanel,
  WindowTitle,
} from '@airlib/react-aui/desktop';
import type { FC } from 'react';
import { deleteConfirm } from '@/components/confirm.js';
import { DeleteIcon, DownloadIcon, ShareIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import {
  type WedyanFileKind,
  WedyanGallery,
  type WedyanGalleryEntry,
  type WedyanGalleryLayout,
  WedyanGalleryLayoutToggle,
  WedyanGallerySearch,
} from '@/components/WedyanGallery.js';
import FILES from '../data/files.json';
import FOLDERS from '../data/folders.json';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { DocumentsIcon, MusicsIcon, PhotosIcon, StorageIcon, VideosIcon } from './icons.js';

/** One file in a folder; pictures carry their own `src`, other kinds get a drawn thumbnail. */
type FileEntry = (typeof FILES)[number] & { src?: string };

/** One place down the side: a folder or a device. */
type Place = { name: string; label: string };

/** Each place's glyph, by name. */
const PLACE_ICONS: Record<string, FC> = {
  documents: DocumentsIcon,
  photos: PhotosIcon,
  videos: VideosIcon,
  musics: MusicsIcon,
  storage: StorageIcon,
};

/**
 * Places in the order people scan them: by name.
 *
 * @param places - The places to order.
 * @returns A new list, sorted by label.
 */
const byName = (places: Place[]): Place[] => [...places].sort((a, b) => a.label.localeCompare(b.label));

const FAVORITES = byName(FOLDERS.favorites);
const LOCATIONS = byName(FOLDERS.locations);
const ALL_PLACES: Place[] = [...FAVORITES, ...LOCATIONS];
/** The folder's files, whichever way they show, filling the window so pressing its background lets go of the pick. */
const BROWSE_CLASS = 'wedyan-files-browse';

/** What changes in storage as it's used, for this session: the files deleted, by path. */
const storage = mutable({ deleted: [] as string[] });

/**
 * The file browser: favorite folders, then locations, down the side; the chosen one's files beside
 * them, as tiles or as a list.
 */
export const files = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 520, minHeight: 340 },
}).render(() => {
  // `file` is one file's path while picking one, and the checked paths while picking several; both layouts share it.
  const view = mutable({
    folder: 'photos',
    file: null as string | string[] | null,
    several: false,
    layout: 'grid' as WedyanGalleryLayout,
    query: '',
  });

  const folderLabel = () => ALL_PLACES.find((place) => place.name === view.folder)?.label ?? manifest.label;
  const entries = () =>
    (FILES as FileEntry[])
      .filter((file) => file.folder === view.folder)
      .map(galleryEntryOf)
      .filter((entry) => !storage.deleted.includes(entry.path));

  /** The paths picked: the one file, or every checked one. */
  const pickedPaths = (): string[] => (Array.isArray(view.file) ? view.file : view.file ? [view.file] : []);

  // Takes the picked files out of storage for this session: the mode first, while the value is still a list.
  const remove = () => {
    const paths = pickedPaths();
    view.several = false;
    view.file = null;
    storage.deleted.push(...paths);
  };

  /** The actions for what's picked, in their groups: send; remove. Sending waits on the system's tools. */
  const selection = (): SelectionAction[][] => [
    [
      { label: 'Share', icon: <ShareIcon /> },
      { label: 'Download', icon: <DownloadIcon /> },
    ],
    [{ label: 'Delete', icon: <DeleteIcon />, run: remove, confirm: deleteConfirm(pickedPaths().length, 'item', 'items', 'your drive') }],
  ];

  const place = (item: Place) => {
    const Icon = PLACE_ICONS[item.name];
    return (
      <Button
        key={item.name}
        variant="text"
        size="sm"
        aria-current={$use(() => (view.folder === item.name ? 'true' : undefined))}
        onClick={() => {
          view.folder = item.name;
          view.several = false;
          view.file = null;
          view.query = '';
        }}
      >
        {Icon && <Icon />}
        <span>{item.label}</span>
      </Button>
    );
  };

  return () => (
    <Window sidebarResizeLabel="Resize sidebar">
      <Window.Snippet for="title">
        {() => (
          <>
            <WindowTitle>
              <Snippet>{() => folderLabel()}</Snippet>
            </WindowTitle>
            {/* While files are picked, what can be done with them sits beside the title. */}
            <Show when={() => pickedPaths().length > 0}>
              {() => (
                <SelectionActions
                  label="Picked files"
                  count={view.several ? `${pickedPaths().length} selected` : undefined}
                  groups={selection()}
                />
              )}
            </Show>
          </>
        )}
      </Window.Snippet>
      <Window.Snippet for="sidebar">
        {() => (
          <WindowSidebar>
            <WindowSidebarPanel>
              <WindowSidebarLabel>Favorites</WindowSidebarLabel>
              {FAVORITES.map(place)}
            </WindowSidebarPanel>
            <WindowSidebarPanel>
              <WindowSidebarLabel>Locations</WindowSidebarLabel>
              {LOCATIONS.map(place)}
            </WindowSidebarPanel>
          </WindowSidebar>
        )}
      </Window.Snippet>
      <Window.Snippet for="actions">
        {() => (
          <>
            <WedyanGallerySearch query={$bind(view, 'query')} />
            <Divider orientation="vertical" variant="ghost" size="sm" />
            <WedyanGalleryLayoutToggle layout={$bind(view, 'layout')} />
            {/* Sets the app's own buttons apart from the window's. */}
            <Divider orientation="vertical" variant="ghost" size="sm" />
          </>
        )}
      </Window.Snippet>
      <WedyanGallery
        label={$use(folderLabel)}
        entries={$use(entries)}
        value={$bind(view, 'file')}
        multiple={$bind(view, 'several')}
        layout={$use(() => view.layout)}
        query={$use(() => view.query)}
        checkable
        className={BROWSE_CLASS}
      />
    </Window>
  );
});

/**
 * A file in storage as the file every Wedyan gallery shows: by its folder's name and its own, with
 * its picture when it has one, its size, and when it last changed.
 *
 * @param file - The file in storage.
 * @returns The file, for the gallery.
 */
function galleryEntryOf(file: FileEntry): WedyanGalleryEntry {
  const folder = ALL_PLACES.find((place) => place.name === file.folder)?.label ?? file.folder;
  return {
    path: `/${folder}/${file.name}`,
    name: file.name,
    kind: file.kind as WedyanFileKind,
    picture: file.src,
    detail: file.size,
    modified: file.modified,
  };
}
