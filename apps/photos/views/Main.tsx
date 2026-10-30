import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, mutable, Show, Snippet } from '@airlib/react';
import {
  Button,
  DescriptionList,
  Divider,
  EmptyState,
  ImageViewer,
  type ImageViewerEntry,
  Toggle,
  Tooltip,
} from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowSidebar,
  WindowSidebarLabel,
  WindowSidebarPanel,
  WindowTitle,
} from '@airlib/react-aui/desktop';
import { AddIcon, ArrowLeft, FolderIcon } from '@airlib/react-aui/icons';
import type { ReactNode } from 'react';
import { DeleteIcon, DownloadIcon, ShareIcon, SidebarCloseIcon, SidebarOpenIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import {
  BROWSE_CLASS,
  WedyanGallery,
  type WedyanGalleryEntry,
  type WedyanGalleryLayout,
  WedyanGalleryLayoutToggle,
  WedyanGallerySearch,
} from '@/components/WedyanGallery.js';
import { documentAt, drive, nameOf, parentOf, supply } from '@/lib/documents/store.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { AlbumIcon, FavoritedIcon, FavoritesIcon, GenerativeIcon, LibraryIcon, PreviewIcon, ReferenceIcon } from './icons.js';
import {
  ALBUMS,
  allTagged,
  chosenPicture,
  type Entry,
  FAVORITE,
  freeStillPath,
  GENERATIVE,
  type ListingRequest,
  library,
  listing,
  type Photo,
  ROOT,
  toggleTag,
  VIEWER_LABELS,
} from './library.js';
import { generation, PhotosDockOptions } from './options.js';
import { COMMANDS, CONTEXTS } from './prompt.js';
import { StillProject } from './Still.js';

/** What a Photos window can be opened with: a still project to show, by path; the browser otherwise. */
export type PhotosData = { still?: string } | undefined;

/** The tags Photos lists down its side, by tag, with their names. */
const TAG_LABELS: Record<string, string> = {
  [FAVORITE]: 'Favorites',
  [GENERATIVE]: 'Generative',
  ...Object.fromEntries(ALBUMS.map((album) => [album.tag, album.label])),
};

const CLASS = {
  BROWSE: BROWSE_CLASS.ROOT,
  GALLERY: BROWSE_CLASS.GALLERY,
  PREVIEW: BROWSE_CLASS.PREVIEW,
  PREVIEW_OPEN: BROWSE_CLASS.PREVIEW_OPEN,
  PREVIEW_NAME: BROWSE_CLASS.PREVIEW_NAME,
};

/**
 * Photos: a browser of the Photos folder, like a file explorer. Down the side: Photos itself, and
 * the tags — Favorites, Generative, and each album — which list every file carrying them. As tiles: the open folder's folders, still projects and images, or the tag's files, and
 * beside them a preview of the picked one, which can be turned off. A double click, Enter, or pressing the preview's picture
 * opens what's picked: a folder, a still project in a window of its own, or an image in the
 * viewer, which steps through the rest. While Photos is in front, the dock holds how new images
 * are made.
 */
export const photos = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 520, minHeight: 360 },
  multiple: true,
  dockExtensions: PhotosDockOptions,
}).render((props) => {
  // A window opened on a still project shows that project for its whole life.
  const still = (props.instance.data as PhotosData)?.still;
  if (still) return () => <StillProject path={still} />;

  // `picked` is one path while picking one, and the checked paths while picking several. While a
  // tag is listed, `folder` is still the one it was opened from, to go back to.
  const view = mutable({
    folder: ROOT,
    tag: null as string | null,
    picked: null as string | string[] | null,
    several: false,
    viewing: false,
    previewHidden: false,
    layout: 'grid' as WedyanGalleryLayout,
    query: '',
    sidebarHidden: false,
    index: 0,
  });

  const entries = (): Entry[] => listing(view.tag ? { tag: view.tag } : { folder: view.folder });
  const images = (): Photo[] => entries().flatMap((entry) => (entry.kind === 'photo' ? [entry.photo] : []));
  const picked = () => entries().find((entry) => entry.path === view.picked);
  const checked = () => (Array.isArray(view.picked) ? view.picked.length : 0);
  const title = () => (view.tag ? TAG_LABELS[view.tag] : view.folder === ROOT ? manifest.label : nameOf(view.folder));

  // Lets go of the pick: the mode first, while the value is still a list, then the value.
  const release = () => {
    view.several = false;
    view.picked = null;
  };

  /**
   * Lists a folder, or every file carrying a tag, in place of what's shown, with nothing picked and
   * nothing searched, as a new place starts.
   *
   * @param request - The folder, or the tag.
   */
  const go = (request: ListingRequest) => {
    release();
    Object.assign(view, 'tag' in request ? { tag: request.tag } : { folder: request.folder, tag: null }, { viewing: false, query: '' });
  };

  /**
   * Opens the viewer at an image.
   *
   * @param path - The image to start from.
   */
  const openViewer = (path: string) => {
    view.index = Math.max(
      images().findIndex((photo) => photo.path === path),
      0
    );
    view.viewing = true;
  };

  /**
   * Opens what a tile is: a folder, here; a still project, in a window of its own; an image, in the viewer.
   *
   * @param entry - What the tile is.
   */
  const open = (entry: Entry) => {
    if (entry.kind === 'folder') go({ folder: entry.path });
    else if (entry.kind === 'still') openStill(entry.path);
    else openViewer(entry.path);
  };

  // Back from the viewer to the tiles, from a tag to the folder it was opened from, or up from a folder to the one it's in.
  const back = () => {
    if (view.viewing) view.viewing = false;
    else go({ folder: view.tag ? view.folder : parentOf(view.folder) });
  };

  // Stepping through the viewer moves the pick along, so going back lands on the last one seen.
  const step = (event: CustomEvent<number>) => {
    if (!view.several) view.picked = images()[event.detail]?.path ?? null;
  };

  // Starts a still project in the open folder — from a tag, the folder it was opened from — and opens it.
  const newStill = () => {
    const path = freeStillPath(view.folder);
    const now = new Date().toISOString();
    supply([
      [
        path,
        {
          type: 'still',
          version: 1,
          id: crypto.randomUUID(),
          name: nameOf(path).replace(/\.still$/, ''),
          created: now,
          updated: now,
          author: { kind: 'user' },
          tags: [GENERATIVE],
          prompt: '',
          references: [],
          attempts: [],
          edits: [],
          chosen: '',
        },
      ],
    ]);
    openStill(path);
  };

  /** The paths picked: the one, or every checked one. */
  const pickedPaths = (): string[] => (Array.isArray(view.picked) ? view.picked : view.picked ? [view.picked] : []);

  // Takes the picked images and still projects out of Photos for this session.
  const remove = () => {
    const paths = pickedPaths();
    release();
    library.deleted.push(...paths.filter((path) => !path.endsWith('.still')));
    drive.deleted.push(...paths.filter((path) => path.endsWith('.still')));
  };

  // Hands the picked images to the next generation as references, after any already there.
  const reference = () => {
    const paths = pickedPaths().filter((path) => !generation.references.includes(path));
    generation.references.push(...paths);
  };

  /** The actions for what's picked, in their groups: make with; keep; send; remove. */
  const selection = (): SelectionAction[][] => {
    const paths = pickedPaths();
    const favorite = allTagged(paths, FAVORITE);
    return [
      [{ label: 'Use as reference', icon: <ReferenceIcon />, run: reference }],
      [
        {
          label: favorite ? 'Remove from Favorites' : 'Add to Favorites',
          icon: favorite ? <FavoritedIcon /> : <FavoritesIcon />,
          run: () => toggleTag(paths, FAVORITE),
        },
      ],
      [
        { label: 'Share', icon: <ShareIcon /> },
        { label: 'Download', icon: <DownloadIcon /> },
      ],
      [{ label: 'Delete', icon: <DeleteIcon />, run: remove }],
    ];
  };

  /** One place down the side: Photos itself, or a tag. */
  const place = (label: string, icon: ReactNode, current: () => boolean, run: () => void) => (
    <Button key={label} variant="text" size="sm" aria-current={$use(() => (current() ? 'true' : undefined))} onClick={run}>
      {icon}
      <span>{label}</span>
    </Button>
  );

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
              <EmptyState title={count === 1 ? '1 item checked' : `${count} items checked`} description="Press Escape to pick one again." level={3}>
                <EmptyState.Snippet for="icon">{() => <LibraryIcon />}</EmptyState.Snippet>
              </EmptyState>
            )}
          </Show>
        )}
      >
        {(entry) => {
          const facts = entryFacts(entry);
          return (
            <>
              <button type="button" className={CLASS.PREVIEW_OPEN} aria-label={`Open ${entry.name}`} onClick={() => open(entry)}>
                {facts.picture ? <img src={facts.picture} alt="" /> : <FolderIcon />}
              </button>
              <h3 className={CLASS.PREVIEW_NAME}>{entry.name}</h3>
              <DescriptionList size="sm" items={facts.items} />
              {facts.prompt && <DescriptionList size="sm" layout="stacked" items={[{ label: 'Prompt', value: facts.prompt }]} />}
            </>
          );
        }}
      </Show>
    </aside>
  );

  return () => (
    <Window sidebarResizeLabel="Resize sidebar">
      <Window.Snippet for="title">
        {() => (
          <>
            {/* Going back leads, set apart from the view it leaves: its sidebar and where it is. */}
            <Show when={() => view.viewing || !!view.tag || view.folder !== ROOT}>
              {() => (
                <>
                  <Button
                    aria-label={view.viewing ? 'Back to the tiles' : view.tag ? 'Back to the folder' : 'Up a folder'}
                    size="sm"
                    variant="text"
                    className={AUI_CLASS.CONTROL_ICON}
                    onClick={back}
                  >
                    <ArrowLeft />
                  </Button>
                  <Divider orientation="vertical" variant="ghost" size="sm" />
                </>
              )}
            </Show>
            <Toggle aria-label="Hide sidebar" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(view, 'sidebarHidden')}>
              <Snippet>{() => (view.sidebarHidden ? <SidebarOpenIcon /> : <SidebarCloseIcon />)}</Snippet>
              <Tooltip>Hide sidebar</Tooltip>
            </Toggle>
            <WindowTitle>
              <Snippet>{title}</Snippet>
            </WindowTitle>
            {/* While things are picked, what can be done with them sits beside the title. */}
            <Show when={() => !view.viewing && pickedPaths().length > 0}>
              {() => (
                <SelectionActions
                  label="Picked photos"
                  count={view.several ? `${pickedPaths().length} selected` : undefined}
                  groups={selection()}
                />
              )}
            </Show>
          </>
        )}
      </Window.Snippet>
      <Window.Snippet for="sidebar">
        {() =>
          !view.sidebarHidden && (
            <WindowSidebar>
              <WindowSidebarPanel>
                <WindowSidebarLabel>Library</WindowSidebarLabel>
                {place(manifest.label, <LibraryIcon />, () => !view.tag && view.folder === ROOT, () => go({ folder: ROOT }))}
                {place(TAG_LABELS[FAVORITE], <FavoritesIcon />, () => view.tag === FAVORITE, () => go({ tag: FAVORITE }))}
                {place(TAG_LABELS[GENERATIVE], <GenerativeIcon />, () => view.tag === GENERATIVE, () => go({ tag: GENERATIVE }))}
              </WindowSidebarPanel>
              <WindowSidebarPanel>
                <WindowSidebarLabel>Albums</WindowSidebarLabel>
                {ALBUMS.map((album) => place(album.label, <AlbumIcon />, () => view.tag === album.tag, () => go({ tag: album.tag })))}
              </WindowSidebarPanel>
            </WindowSidebar>
          )
        }
      </Window.Snippet>
      <Window.Snippet for="actions">
        {() => (
          <Show when={() => !view.viewing}>
            {() => (
              <>
                <WedyanGallerySearch query={$bind(view, 'query')} />
                <Divider orientation="vertical" variant="ghost" size="sm" />
                <Button aria-label="New still project" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={newStill}>
                  <AddIcon />
                  <Tooltip>New still project</Tooltip>
                </Button>
                {/* Making something apart from how the files show. */}
                <Divider orientation="vertical" variant="ghost" size="sm" />
                <WedyanGalleryLayoutToggle layout={$bind(view, 'layout')} />
                <Toggle aria-label="Hide preview" size="sm" variant="text" pressed={$bind(view, 'previewHidden')} className={AUI_CLASS.CONTROL_ICON}>
                  <PreviewIcon />
                  <Tooltip>Hide preview</Tooltip>
                </Toggle>
                {/* Sets the app's own buttons apart from the window's. */}
                <Divider orientation="vertical" variant="ghost" size="sm" />
              </>
            )}
          </Show>
        )}
      </Window.Snippet>
      <Show
        when={() => view.viewing}
        fallback={() => (
          <div className={CLASS.BROWSE}>
            <WedyanGallery
              label={$use(title)}
              entries={$use(() => entries().map(galleryEntryOf))}
              value={$bind(view, 'picked')}
              multiple={$bind(view, 'several')}
              layout={$use(() => view.layout)}
              query={$use(() => view.query)}
              checkable
              className={CLASS.GALLERY}
              onopen={(file) => {
                const entry = entries().find((each) => each.path === file.path);
                if (entry) open(entry);
              }}
            />
            <Show when={() => !view.previewHidden}>{preview}</Show>
          </div>
        )}
      >
        {() => (
          <ImageViewer label={title()} items={$use(() => images().map(toSlide))} index={$bind(view, 'index')} labels={VIEWER_LABELS} onchange={step} />
        )}
      </Show>
    </Window>
  );
});

/**
 * Opens a still project in a Photos window of its own, or brings forward the one already showing it.
 *
 * @param path - The still's path.
 * @returns The window showing it.
 */
export function openStill(path: string) {
  const showing = photos.instances.find((instance) => (instance.data as PhotosData)?.still === path);
  if (showing) {
    showing.focus();
    return showing;
  }

  return photos.open(
    { still: path },
    {
      name: 'still',
      commands: COMMANDS,
      contexts: CONTEXTS,
      get title() {
        return documentAt<'still'>(path)?.name ?? nameOf(path);
      },
      get thumbnail() {
        const document = documentAt<'still'>(path);
        return document && chosenPicture(document);
      },
    }
  );
}

/**
 * What the preview says about a tile: its picture, its facts, and the prompt it was made from.
 *
 * @param entry - What the tile is.
 * @returns Its picture, facts and prompt.
 */
function entryFacts(entry: Entry): { picture?: string; items: { label: string; value: string }[]; prompt?: string } {
  if (entry.kind === 'folder') return { items: [{ label: 'Holds', value: countOf(entry.count) }] };
  if (entry.kind === 'still') {
    const { document } = entry;
    return {
      picture: chosenPicture(document),
      items: [
        { label: 'Attempts', value: String(document.attempts.length) },
        { label: 'Updated', value: new Date(document.updated).toLocaleDateString(undefined, { dateStyle: 'medium' }) },
      ],
      prompt: document.prompt || undefined,
    };
  }
  const { photo } = entry;
  return {
    picture: photo.src,
    items: [
      { label: 'Size', value: photo.size },
      { label: 'Date', value: photo.modified },
    ],
    prompt: photo.prompt,
  };
}

/**
 * What a folder holds, as the files every Wedyan gallery shows: a folder by how much it holds, a
 * still project by when it changed, an image by its picture, size and date.
 *
 * @param entry - What the folder holds.
 * @returns The file, for the gallery.
 */
function galleryEntryOf(entry: Entry): WedyanGalleryEntry {
  if (entry.kind === 'folder') {
    return { path: entry.path, name: entry.name, kind: 'folder', detail: countOf(entry.count) };
  }
  if (entry.kind === 'still') {
    const { document } = entry;
    return {
      path: entry.path,
      name: entry.name,
      kind: 'still',
      detail: 'Still project',
      modified: new Date(document.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    };
  }
  const { photo } = entry;
  return { path: entry.path, name: entry.name, kind: 'image', picture: photo.src, detail: photo.size, modified: photo.modified };
}

/**
 * How much a folder holds, in words.
 *
 * @param count - How many items.
 * @returns E.g. `1 item` or `3 items`.
 */
function countOf(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
}

/**
 * An image as one of the viewer's, captioned with its name and date.
 *
 * @param photo - The image to show.
 * @returns The viewer's entry.
 */
function toSlide(photo: Photo): ImageViewerEntry {
  return { src: photo.src, alt: photo.name, caption: `${photo.name} · ${photo.modified}` };
}
