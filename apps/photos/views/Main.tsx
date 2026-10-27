import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, mutable, Show, Snippet } from '@airlib/react';
import {
  Button,
  DescriptionList,
  Divider,
  EmptyState,
  Gallery,
  type GalleryEntry,
  ImageViewer,
  type ImageViewerEntry,
  Toggle,
} from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowSidebar,
  WindowSidebarLabel,
  WindowSidebarPanel,
  WindowTitle,
} from '@airlib/react-aui/desktop';
import { ArrowLeft } from '@airlib/react-aui/icons';
import type { FC, KeyboardEvent, MouseEvent } from 'react';
import { DeleteIcon, DownloadIcon, ShareIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import LIBRARY from '../data/library.json';
import manifest from '../manifest.json';
import { byId, kept, library, PHOTOS, type Photo } from './library.js';
import {
  AlbumIcon,
  FavoritedIcon,
  FavoritesIcon,
  GenerativeIcon,
  LibraryIcon,
  PreviewIcon,
  ReferenceIcon,
} from './icons.js';
import { generation, PhotosDockOptions } from './options.js';

/** A set of photos down the side: the whole library, a view of it, or an album; its photos as they are now. */
type Collection = { name: string; label: string; icon: FC; photos: () => Photo[] };

/** The library's own views, in the order people reach for them. */
const VIEWS: Collection[] = [
  { name: 'all', label: 'Photos', icon: LibraryIcon, photos: () => kept(PHOTOS) },
  { name: 'generative', label: 'Generative', icon: GenerativeIcon, photos: () => kept(PHOTOS).filter((photo) => photo.prompt) },
  { name: 'favorites', label: 'Favorites', icon: FavoritesIcon, photos: () => byId(library.favorites) },
];

/** The albums, by name. */
const ALBUMS: Collection[] = LIBRARY.albums
  .map((album) => ({ name: album.name, label: album.label, icon: AlbumIcon, photos: () => byId(album.photos) }))
  .sort((a, b) => a.label.localeCompare(b.label));

const COLLECTIONS = [...VIEWS, ...ALBUMS];

const CLASS = {
  BROWSE: 'wedyan-photos-browse',
  GALLERY: 'wedyan-photos-gallery',
  PREVIEW: 'wedyan-photos-preview',
  PREVIEW_OPEN: 'wedyan-photos-preview-open',
  PREVIEW_NAME: 'wedyan-photos-preview-name',
};

const VIEWER_LABELS = {
  previous: 'Previous photo',
  next: 'Next photo',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fullscreen: 'Full screen',
};

/**
 * The photo library: its views and albums down the side, the chosen one's photos as tiles, and
 * beside them a preview of the picked photo, which can be turned off. A click picks a photo; a
 * double click, Enter, or pressing the preview's picture opens it in the viewer, which steps
 * through the rest. While Photos is in front, the dock holds how new
 * images are made.
 */
export const photos = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: { width: 900, height: 560 },
  window: { snap: '.aui-window', minWidth: 520, minHeight: 360 },
  dockExtensions: PhotosDockOptions,
}).render(() => {
  // `picked` is one photo's id while picking one, and the checked ids while picking several.
  const view = mutable({
    place: 'all',
    picked: null as string | string[] | null,
    several: false,
    viewing: false,
    preview: true,
    index: 0,
  });

  const collection = () => COLLECTIONS.find((item) => item.name === view.place) ?? COLLECTIONS[0];
  const picked = () => PHOTOS.find((photo) => photo.id === view.picked);
  const checked = () => (Array.isArray(view.picked) ? view.picked.length : 0);
  const tiles = () => collection().photos().map(toTile);
  const slides = () => collection().photos().map(toSlide);

  /**
   * Opens the viewer at a photo.
   *
   * @param id - The photo to start from.
   */
  const openViewer = (id: string) => {
    view.index = Math.max(
      collection()
        .photos()
        .findIndex((photo) => photo.id === id),
      0
    );
    view.viewing = true;
  };

  // A double click opens the tile. While picking one, its second click unpicks the tile again, so the
  // tile is found by its place among the tiles and picked; while picking several, its two clicks cancel out.
  const openTile = (event: MouseEvent<HTMLElement>) => {
    const tile = (event.target as Element).closest('[role="option"]');
    if (!tile) return;
    const at = [...event.currentTarget.querySelectorAll('[role="option"]')].indexOf(tile);
    const photo = collection().photos()[at];
    if (!photo) return;
    if (!view.several) view.picked = photo.id;
    openViewer(photo.id);
  };

  // While picking one, Enter on the picked tile opens it, caught before the gallery would take it as
  // unpicking; on any other tile, or while picking several, Enter picks or checks as usual.
  const openOnEnter = (event: KeyboardEvent<HTMLElement>) => {
    const tile = (event.target as Element).closest('[role="option"]');
    if (event.key !== 'Enter' || view.several || tile?.getAttribute('aria-selected') !== 'true') return;
    event.preventDefault();
    event.stopPropagation();
    openViewer(view.picked as string);
  };

  const back = () => {
    view.viewing = false;
  };

  // Stepping through the viewer moves the pick along, so going back lands on the last one seen.
  const step = (event: CustomEvent<number>) => {
    if (!view.several) view.picked = collection().photos()[event.detail]?.id ?? null;
  };

  /** The ids picked: the one photo, or every checked one. */
  const pickedIds = (): string[] => (Array.isArray(view.picked) ? view.picked : view.picked ? [view.picked] : []);

  // Lets go of the pick: the mode first, while the value is still a list, then the value.
  const release = () => {
    view.several = false;
    view.picked = null;
  };

  // Adds the picked photos to Favorites, or takes them out when every one is there already.
  const toggleFavorite = () => {
    const ids = pickedIds();
    const all = ids.every((id) => library.favorites.includes(id));
    library.favorites = all
      ? library.favorites.filter((id) => !ids.includes(id))
      : [...library.favorites, ...ids.filter((id) => !library.favorites.includes(id))];
  };

  // Takes the picked photos out of the library for this session.
  const remove = () => {
    const ids = pickedIds();
    release();
    library.deleted.push(...ids);
  };

  // Hands the picked photos to the next generation as references, after any already there.
  const reference = () => {
    const ids = pickedIds().filter((id) => !generation.references.includes(id));
    generation.references.push(...ids);
  };

  /** The actions for what's picked, in their groups: make with; keep; send; remove. */
  const selection = (): SelectionAction[][] => {
    const ids = pickedIds();
    const favorite = ids.every((id) => library.favorites.includes(id));
    return [
      [{ label: 'Use as reference', icon: <ReferenceIcon />, run: reference }],
      [
        {
          label: favorite ? 'Remove from Favorites' : 'Add to Favorites',
          icon: favorite ? <FavoritedIcon /> : <FavoritesIcon />,
          run: toggleFavorite,
        },
      ],
      [
        { label: 'Share', icon: <ShareIcon /> },
        { label: 'Download', icon: <DownloadIcon /> },
      ],
      [{ label: 'Delete', icon: <DeleteIcon />, run: remove }],
    ];
  };

  const place = (item: Collection) => {
    const Icon = item.icon;
    return (
      <Button
        key={item.name}
        variant="text"
        size="sm"
        aria-current={$use(() => (view.place === item.name ? 'true' : undefined))}
        onClick={() => {
          view.place = item.name;
          view.picked = null;
          view.several = false;
          view.viewing = false;
        }}
      >
        <Icon />
        <span>{item.label}</span>
      </Button>
    );
  };

  const preview = () => (
    <aside className={`${CLASS.PREVIEW} ${AUI_CLASS.GLASS_PANEL}`} aria-label="Preview">
      <Show
        when={picked}
        fallback={() => (
          <Show
            when={checked}
            fallback={() => (
              <EmptyState title="Nothing picked" description="Pick a photo to see it here." level={3}>
                <EmptyState.Snippet for="icon">{() => <LibraryIcon />}</EmptyState.Snippet>
              </EmptyState>
            )}
          >
            {(count) => (
              <EmptyState
                title={count === 1 ? '1 photo checked' : `${count} photos checked`}
                description="Press Escape to pick one again."
                level={3}
              >
                <EmptyState.Snippet for="icon">{() => <LibraryIcon />}</EmptyState.Snippet>
              </EmptyState>
            )}
          </Show>
        )}
      >
        {(photo) => (
          <>
            <button
              type="button"
              className={CLASS.PREVIEW_OPEN}
              aria-label={`Open ${photo.name}`}
              onClick={() => openViewer(photo.id)}
            >
              <img src={photo.src} alt="" />
            </button>
            <h3 className={CLASS.PREVIEW_NAME}>{photo.name}</h3>
            <DescriptionList
              size="sm"
              items={[
                { label: 'Size', value: photo.size },
                { label: 'Date', value: photo.modified },
              ]}
            />
            {photo.prompt && (
              <DescriptionList size="sm" layout="stacked" items={[{ label: 'Prompt', value: photo.prompt }]} />
            )}
          </>
        )}
      </Show>
    </aside>
  );

  return () => (
    <Window sidebarResizeLabel="Resize sidebar">
      <Window.Snippet for="title">
        {() => (
          <>
            <WindowTitle>
              <Snippet>{() => collection().label}</Snippet>
            </WindowTitle>
            {/* While photos are picked, what can be done with them sits beside the title. */}
            <Show when={() => !view.viewing && pickedIds().length > 0}>
              {() => (
                <SelectionActions
                  label="Picked photos"
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
              <WindowSidebarLabel>Library</WindowSidebarLabel>
              {VIEWS.map(place)}
            </WindowSidebarPanel>
            <WindowSidebarPanel>
              <WindowSidebarLabel>Albums</WindowSidebarLabel>
              {ALBUMS.map(place)}
            </WindowSidebarPanel>
          </WindowSidebar>
        )}
      </Window.Snippet>
      <Window.Snippet for="actions">
        {() => (
          <Show
            when={() => view.viewing}
            fallback={() => (
              <>
                <Toggle
                  aria-label="Preview"
                  size="sm"
                  variant="text"
                  pressed={$bind(view, 'preview')}
                  className={AUI_CLASS.CONTROL_ICON}
                >
                  <PreviewIcon />
                </Toggle>
                {/* Sets the app's own button apart from the window's. */}
                <Divider orientation="vertical" variant="ghost" size="sm" />
              </>
            )}
          >
            {() => (
              <Button aria-label="All photos" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={back}>
                <ArrowLeft />
              </Button>
            )}
          </Show>
        )}
      </Window.Snippet>
      <Show
        when={() => view.viewing}
        fallback={() => (
          <div className={CLASS.BROWSE}>
            <div className={CLASS.GALLERY} onDoubleClick={openTile} onKeyDownCapture={openOnEnter}>
              <Gallery
                label={$use(() => collection().label)}
                items={$use(tiles)}
                value={$bind(view, 'picked')}
                multiple={$bind(view, 'several')}
                checkable
              />
            </div>
            <Show when={() => view.preview}>{preview}</Show>
          </div>
        )}
      >
        {() => (
          <ImageViewer
            label={collection().label}
            items={$use(slides)}
            index={$bind(view, 'index')}
            labels={VIEWER_LABELS}
            onchange={step}
          />
        )}
      </Show>
    </Window>
  );
});

/**
 * A photo as a gallery tile: the picture, captioned with its name, size, and date.
 *
 * @param photo - The photo to show.
 * @returns The tile.
 */
function toTile(photo: Photo): GalleryEntry {
  return {
    value: photo.id,
    src: photo.src,
    alt: photo.name,
    title: photo.name,
    description: photo.size,
    meta: photo.modified,
  };
}

/**
 * A photo as one of the viewer's images, captioned with its name and date.
 *
 * @param photo - The photo to show.
 * @returns The viewer's entry.
 */
function toSlide(photo: Photo): ImageViewerEntry {
  return { src: photo.src, alt: photo.name, caption: `${photo.name} · ${photo.modified}` };
}
