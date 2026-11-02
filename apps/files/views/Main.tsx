import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, For, setup, Show, Snippet } from '@airlib/react';
import { Button, Divider, EmptyState, GalleryItem, Spinner } from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowSidebar,
  WindowSidebarLabel,
  WindowSidebarPanel,
  WindowTitle,
} from '@airlib/react-aui/desktop';
import { ArrowLeft, FolderIcon } from '@airlib/react-aui/icons';
import { IRPC_STATUS } from '@irpclib/irpc';
import type { FC } from 'react';
import { AgentsIcon, PeopleIcon } from '@/apps/lounge/views/icons.js';
import { MemosIcon } from '@/apps/memo/views/icons.js';
import { ProjectsIcon } from '@/apps/motions/views/icons.js';
import { LibraryIcon } from '@/apps/photos/views/icons.js';
import { DeleteIcon, DownloadIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import {
  WedyanGallery,
  WedyanGalleryLayoutToggle,
  WedyanGalleryRow,
  WedyanGallerySearch,
} from '@/components/WedyanGallery.js';
import { nameOf } from '@/lib/documents/paths.js';
import { type FileRow, rowsOf } from '@/lib/documents/rows.js';
import { isMedia } from '@/lib/documents/words.js';
import { dfs } from '@/lib/share/dfs.js';
import { AGENTS_PATH, isSystemPath, MEMOS_PATH } from '@/lib/share/system.js';
import { downloadImage } from '@/lib/systems/download.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { createFiles, type Files, filesCtx } from './context.js';
import { DocumentsIcon, PhotosIcon, StorageIcon } from './icons.js';
import { detailOf, HOME, modifiedOf, pictureOf, whereOf } from './listing.js';

/** The folder's files, whichever way they show, filling the window so pressing its background lets go of the pick. */
const BROWSE_CLASS = 'wedyan-files-browse';

/** What's said while a listing is on its way. */
const LOADING = 'Loading your files';

/** Each known folder's own glyph, the one its app shows; any other folder is a plain folder. */
const PLACE_ICONS: Record<string, FC> = {
  [AGENTS_PATH]: AgentsIcon,
  [MEMOS_PATH]: MemosIcon,
  '~/Motions': ProjectsIcon,
  '~/People': PeopleIcon,
  '~/Photos': PhotosIcon,
  '~/Pictures': LibraryIcon,
};

/**
 * The file browser: the home and its folders down the side; what's in the folder open beside them,
 * as tiles or as a list, or what a search finds on the drive.
 */
export const files = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 520, minHeight: 340 },
}).render(() => {
  const browser = createFiles();
  filesCtx.set(browser);

  return () => (
    <Window sidebarResizeLabel="Resize sidebar">
      <Window.Snippet for="title">{() => <FilesTitle />}</Window.Snippet>
      <Window.Snippet for="sidebar">{() => <FilesPlaces />}</Window.Snippet>
      <Window.Snippet for="actions">{() => <FilesActions />}</Window.Snippet>
      <FilesList />
    </Window>
  );
});

/** Where the window is, the way back up, and what can be done with what's picked. */
const FilesTitle = setup(() => {
  const browser = filesCtx.get() as Files;
  const { state } = browser;

  return () => (
    <>
      <Show when={() => state.trail.length > 0}>
        {() => (
          <Button
            aria-label="Up a folder"
            size="sm"
            variant="text"
            className={AUI_CLASS.CONTROL_ICON}
            onClick={browser.up}
          >
            <ArrowLeft />
          </Button>
        )}
      </Show>
      <WindowTitle>
        <Snippet>{() => (state.query ? `Search: ${state.query}` : state.here.name)}</Snippet>
      </WindowTitle>
      <Show when={() => [state.picked].flat().filter(Boolean).length > 0}>
        {() => (
          <SelectionActions
            label="Picked files"
            count={$use(() => (state.several ? `${[state.picked].flat().length} selected` : undefined))}
            groups={$use(() => groupsOf(browser))}
          />
        )}
      </Show>
    </>
  );
}, 'FilesTitle');

/** One of the drive's top folders, to go to. */
const FilesPlace = setup<{ row: FileRow }>((props) => {
  const browser = filesCtx.get() as Files;
  const { state } = browser;

  return () => {
    const { path, name } = props.row;
    const Icon = PLACE_ICONS[path] ?? FolderIcon;
    return (
      <Button
        variant="text"
        size="sm"
        aria-current={$use(() => ([state.here.path, state.trail[1]?.path].includes(path) ? 'true' : undefined))}
        onClick={() => browser.goTo({ path, name })}
      >
        <Icon />
        <span>{name}</span>
      </Button>
    );
  };
}, 'FilesPlace');

/** The home and the folders at the top of the drive. */
const FilesPlaces = setup(() => {
  const browser = filesCtx.get() as Files;
  const { state, places } = browser;

  return () => (
    <WindowSidebar>
      <WindowSidebarPanel>
        <WindowSidebarLabel>Drive</WindowSidebarLabel>
        <Button
          variant="text"
          size="sm"
          aria-current={$use(() => (state.here.path === HOME.path ? 'true' : undefined))}
          onClick={() => browser.goTo(HOME)}
        >
          <StorageIcon />
          <span>{HOME.name}</span>
        </Button>
        <For each={() => rowsOf(places)}>{(row: FileRow) => <FilesPlace row={row} />}</For>
      </WindowSidebarPanel>
    </WindowSidebar>
  );
}, 'FilesPlaces');

/** Searching the drive, what's on its way while rows are already showing, and how files show. */
const FilesActions = setup(() => {
  const { state, items, found } = filesCtx.get() as Files;

  return () => (
    <>
      <Show
        when={() =>
          (state.query ? found : items).status === IRPC_STATUS.PENDING && rowsOf(state.query ? found : items).length
        }
      >
        {() => <Spinner size="sm" label={LOADING} />}
      </Show>
      <WedyanGallerySearch query={$bind(state, 'query')} />
      <Divider orientation="vertical" variant="ghost" size="sm" />
      <WedyanGalleryLayoutToggle layout={$bind(state, 'layout')} />
      {/* Sets the app's own buttons apart from the window's. */}
      <Divider orientation="vertical" variant="ghost" size="sm" />
    </>
  );
}, 'FilesActions');

/** What's in front, the search's result while there's a query, otherwise the folder open; or why there's nothing. */
const FilesList = setup(() => {
  const browser = filesCtx.get() as Files;
  const { state, items, found } = browser;

  return () => (
    <Show
      when={() => rowsOf(state.query ? found : items).length}
      fallback={() => (
        <EmptyState
          title={$use(() => {
            const { status, error } = state.query ? found : items;
            if (status === IRPC_STATUS.PENDING) return LOADING;
            return error ? "Couldn't load your files" : state.query ? 'Nothing found' : 'Nothing here yet';
          })}
          description={$use(() => (state.query ? found : items).error?.message)}
        >
          <EmptyState.Snippet for="icon">
            {() =>
              (state.query ? found : items).status === IRPC_STATUS.PENDING ? (
                <Spinner label={LOADING} />
              ) : (
                <DocumentsIcon />
              )
            }
          </EmptyState.Snippet>
        </EmptyState>
      )}
    >
      {() => (
        <WedyanGallery
          label={$use(() => state.here.name)}
          entries={$use(() => rowsOf(state.query ? found : items))}
          value={$bind(state, 'picked')}
          multiple={$bind(state, 'several')}
          layout={$use(() => state.layout)}
          checkable
          className={BROWSE_CLASS}
          onopen={browser.open}
        >
          <WedyanGallery.Snippet for="tile">{(row: FileRow) => <FileTile row={row} />}</WedyanGallery.Snippet>
          <WedyanGallery.Snippet for="row">{(row: FileRow) => <FileLine row={row} />}</WedyanGallery.Snippet>
        </WedyanGallery>
      )}
    </Show>
  );
}, 'FilesList');

/** One row as a tile, the only thing that reads it: found, what matters is where it is. */
const FileTile = setup<{ row: FileRow }>((props) => {
  const { state } = filesCtx.get() as Files;

  return () => {
    const { row } = props;
    return (
      <GalleryItem
        value={row.path}
        src={pictureOf(row)}
        alt={row.name}
        title={row.name}
        description={$use(() => (state.query ? whereOf(row) : detailOf(row)))}
        meta={modifiedOf(row)}
      />
    );
  };
}, 'FileTile');

/** One row in the list layout, the only thing that reads it: found, what matters is where it is. */
const FileLine = setup<{ row: FileRow }>((props) => {
  const { state } = filesCtx.get() as Files;

  return () => {
    const { row } = props;
    return (
      <WedyanGalleryRow
        value={row.path}
        src={pictureOf(row)}
        title={row.name}
        description={state.query ? whereOf(row) : detailOf(row)}
        meta={modifiedOf(row)}
      />
    );
  };
}, 'FileLine');

/**
 * The actions for what's picked, in their groups: keep; remove. What needs a kind only shows when
 * each is one.
 *
 * @param browser - The window.
 * @returns The groups of actions.
 */
function groupsOf(browser: Files): SelectionAction[][] {
  const paths = [browser.state.picked].flat() as string[];
  return [
    ...(paths.every(isMedia) ? [[{ label: 'Download', icon: <DownloadIcon />, run: () => download(paths) }]] : []),
    ...(paths.some((path) => isSystemPath(path, 'folder'))
      ? []
      : [[{ label: 'Delete', icon: <DeleteIcon />, run: () => void browser.remove() }]]),
  ];
}

/**
 * Saves files from the drive to the user's computer, each named after its file.
 *
 * @param paths - The files.
 */
function download(paths: string[]): void {
  for (const path of paths) void downloadImage(dfs.image(path), nameOf(path));
}
