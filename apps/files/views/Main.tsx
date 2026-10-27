import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, For, mutable, Show, Snippet } from '@airlib/react';
import { Button, Gallery, type GalleryEntry, Listbox, ListboxOption, Toggle, ToggleGroup } from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowSidebar,
  WindowSidebarLabel,
  WindowSidebarPanel,
  WindowTitle,
} from '@airlib/react-aui/desktop';
import type { FC } from 'react';
import { DeleteIcon, DownloadIcon, ShareIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import FILES from '../data/files.json';
import FOLDERS from '../data/folders.json';
import manifest from '../manifest.json';
import {
  DocumentsIcon,
  ListIcon,
  MusicsIcon,
  PhotosIcon,
  StorageIcon,
  ThumbnailsIcon,
  VideosIcon,
} from './icons.js';

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
const LIST_CLASS = 'wedyan-files-list';
/** Either view of a folder's files, filling the window so pressing its background lets go of the pick. */
const PICK_CLASS = 'wedyan-files-pick';

/** How a folder's files are shown: as picture tiles, or as rows with their details. */
type FileView = 'thumbnails' | 'list';

/** What changes in storage as it's used, for this session: the files deleted. */
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
  rect: { width: 780, height: 500 },
  window: { snap: '.aui-window', minWidth: 520, minHeight: 340 },
}).render(() => {
  // `file` is one file's id while picking one, and the checked ids while picking several; both views share it.
  const view = mutable({
    folder: 'photos',
    file: null as string | string[] | null,
    several: false,
    mode: 'thumbnails' as FileView,
  });

  const folderLabel = () => ALL_PLACES.find((place) => place.name === view.folder)?.label ?? manifest.label;
  const tiles = () =>
    (FILES as FileEntry[])
      .filter((file) => file.folder === view.folder && !storage.deleted.includes(file.id))
      .map(toTile);

  /** The ids picked: the one file, or every checked one. */
  const pickedIds = (): string[] => (Array.isArray(view.file) ? view.file : view.file ? [view.file] : []);

  // Takes the picked files out of storage for this session: the mode first, while the value is still a list.
  const remove = () => {
    const ids = pickedIds();
    view.several = false;
    view.file = null;
    storage.deleted.push(...ids);
  };

  /** The actions for what's picked, in their groups: send; remove. Sending waits on the system's tools. */
  const selection = (): SelectionAction[][] => [
    [
      { label: 'Share', icon: <ShareIcon /> },
      { label: 'Download', icon: <DownloadIcon /> },
    ],
    [{ label: 'Delete', icon: <DeleteIcon />, run: remove }],
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
            <Show when={() => pickedIds().length > 0}>
              {() => (
                <SelectionActions
                  label="Picked files"
                  count={view.several ? `${pickedIds().length} selected` : undefined}
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
          <ToggleGroup aria-label="View" value={$bind(view, 'mode')} required size="xs">
            <Toggle value="thumbnails" aria-label="Thumbnails" size="xs" className={AUI_CLASS.CONTROL_ICON}>
              <ThumbnailsIcon />
            </Toggle>
            <Toggle value="list" aria-label="List" size="xs" className={AUI_CLASS.CONTROL_ICON}>
              <ListIcon />
            </Toggle>
          </ToggleGroup>
        )}
      </Window.Snippet>
      <Show
        when={() => view.mode === 'list'}
        fallback={() => (
          <Gallery
            label={$use(folderLabel)}
            items={$use(tiles)}
            value={$bind(view, 'file')}
            multiple={$bind(view, 'several')}
            checkable
            className={PICK_CLASS}
          />
        )}
      >
        {() => (
          <Listbox
            label={$use(folderLabel)}
            value={$bind(view, 'file')}
            multiple={$bind(view, 'several')}
            checkable
            className={`${LIST_CLASS} ${PICK_CLASS}`}
          >
            <For each={tiles}>
              {(tile) => (
                <ListboxOption value={tile.value}>
                  <img src={tile.src} alt="" className={`${LIST_CLASS}-thumb`} />
                  <span className={`${LIST_CLASS}-name`}>{tile.title}</span>
                  <span className={`${LIST_CLASS}-detail`}>{tile.description}</span>
                  <span className={`${LIST_CLASS}-detail`}>{tile.meta}</span>
                </ListboxOption>
              )}
            </For>
          </Listbox>
        )}
      </Show>
    </Window>
  );
});

/**
 * A file as a gallery tile: its picture, or a thumbnail drawn for its kind, captioned with its
 * name, size, and when it last changed.
 *
 * @param file - The file to show.
 * @returns The tile.
 */
function toTile(file: FileEntry): GalleryEntry {
  return {
    value: file.id,
    src: file.src ?? kindThumbnail(file.kind),
    alt: file.name,
    title: file.name,
    description: file.size,
    meta: file.modified,
  };
}

/** Each kind's tint and glyph, drawn on the thumbnail's 480 × 360 canvas. */
const KIND_ART: Record<string, { tint: string; glyph: string }> = {
  video: { tint: '#c8553d', glyph: '<path d="M212 140v80l68-40z"/>' },
  audio: {
    tint: '#1f7a6d',
    glyph: '<circle cx="222" cy="218" r="22"/><rect x="236" y="134" width="10" height="86"/><path d="M246 134q30 8 30 36q-12-16-30-16z"/>',
  },
  pdf: { tint: '#b23a3a', glyph: pageGlyph() },
  document: { tint: '#3e6aa8', glyph: pageGlyph() },
  archive: {
    tint: '#7a6a58',
    glyph: '<rect x="196" y="112" width="88" height="136" rx="10" fill-opacity="0.35"/><rect x="234" y="112" width="12" height="16"/><rect x="234" y="136" width="12" height="16"/><rect x="234" y="160" width="12" height="16"/><rect x="226" y="184" width="28" height="30" rx="6"/>',
  },
};

/**
 * A page with lines on it, for documents of any kind.
 *
 * @returns The glyph's SVG markup.
 */
function pageGlyph(): string {
  return '<rect x="196" y="112" width="88" height="136" rx="10" fill-opacity="0.35"/><rect x="214" y="142" width="52" height="8" rx="4"/><rect x="214" y="166" width="52" height="8" rx="4"/><rect x="214" y="190" width="34" height="8" rx="4"/>';
}

/**
 * A thumbnail for a file with no picture of its own: its kind's tint and glyph.
 *
 * @param kind - The file's kind, e.g. `video` or `pdf`.
 * @returns The thumbnail as a data URL.
 */
function kindThumbnail(kind: string): string {
  const art = KIND_ART[kind] ?? KIND_ART.document;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><rect width="480" height="360" fill="${art.tint}"/><g fill="#fff7ef">${art.glyph}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
