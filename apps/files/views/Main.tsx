import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, Show, Snippet } from '@airlib/react';
import { Button, Divider, EmptyState, Spinner } from '@airlib/react-aui';
import { defineWindow, Window, WindowSidebar, WindowSidebarLabel, WindowSidebarPanel, WindowTitle } from '@airlib/react-aui/desktop';
import { ArrowLeft } from '@airlib/react-aui/icons';
import { IRPC_STATUS } from '@irpclib/irpc';
import { DeleteIcon, DownloadIcon } from '@/components/icons.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import { WedyanGallery, WedyanGalleryLayoutToggle, WedyanGallerySearch } from '@/components/WedyanGallery.js';
import type { FileRow } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import { downloadImage } from '@/lib/systems/download.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { createFiles } from './context.js';
import { DocumentsIcon, StorageIcon } from './icons.js';
import { entryOf, isRemovable } from './listing.js';

/** The folder's files, whichever way they show, filling the window so pressing its background lets go of the pick. */
const BROWSE_CLASS = 'wedyan-files-browse';

/** What's said while a folder is on its way. */
const LOADING = 'Loading your files';

/**
 * The file browser: the home and its folders down the side; what's in the folder open beside them,
 * as tiles or as a list, going into folders and showing the rest where it's opened.
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
  const { state, items } = browser;
  const pending = () => items.status === IRPC_STATUS.PENDING;

  /** The actions for what's picked, in their groups: keep; remove. What needs a kind only shows when each is one. */
  const selection = (): SelectionAction[][] => {
    const rows = browser.picks();
    return [
      ...(rows.every((row) => row.kind === 'image') ? [[{ label: 'Download', icon: <DownloadIcon />, run: () => download(rows) }]] : []),
      ...(rows.every(isRemovable) ? [[{ label: 'Delete', icon: <DeleteIcon />, run: () => void browser.remove() }]] : []),
    ];
  };

  return () => (
    <Window sidebarResizeLabel="Resize sidebar">
      <Window.Snippet for="title">
        {() => (
          <>
            <Show when={() => state.trail.length > 0}>
              {() => (
                <Button aria-label="Up a folder" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={browser.up}>
                  <ArrowLeft />
                </Button>
              )}
            </Show>
            <WindowTitle>
              <Snippet>{() => browser.title}</Snippet>
            </WindowTitle>
            {/* While files are picked, what can be done with them sits beside the title. */}
            <Show when={() => browser.pickedPaths().length > 0}>
              {() => (
                <SelectionActions
                  label="Picked files"
                  count={state.several ? `${browser.pickedPaths().length} selected` : undefined}
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
              <WindowSidebarLabel>Drive</WindowSidebarLabel>
              <Button
                variant="text"
                size="sm"
                aria-current={$use(() => (state.trail.length ? undefined : 'true'))}
                onClick={() => browser.goTo()}
              >
                <StorageIcon />
                <span>Home</span>
              </Button>
              <Snippet>
                {() =>
                  browser.places().map((place) => (
                    <Button
                      key={place.path}
                      variant="text"
                      size="sm"
                      aria-current={$use(() => (state.trail[0]?.path === place.path ? 'true' : undefined))}
                      onClick={() => browser.goTo(place)}
                    >
                      <DocumentsIcon />
                      <span>{place.name}</span>
                    </Button>
                  ))
                }
              </Snippet>
            </WindowSidebarPanel>
          </WindowSidebar>
        )}
      </Window.Snippet>
      <Window.Snippet for="actions">
        {() => (
          <>
            <WedyanGallerySearch query={$bind(state, 'query')} />
            <Divider orientation="vertical" variant="ghost" size="sm" />
            <WedyanGalleryLayoutToggle layout={$bind(state, 'layout')} />
            {/* Sets the app's own buttons apart from the window's. */}
            <Divider orientation="vertical" variant="ghost" size="sm" />
          </>
        )}
      </Window.Snippet>
      <Show
        when={() => browser.rows().length}
        fallback={() => (
          <EmptyState
            title={$use(() => (pending() ? LOADING : items.error ? "Couldn't load your files" : 'Nothing here yet'))}
            description={$use(() => (pending() ? undefined : items.error?.message))}
          >
            <EmptyState.Snippet for="icon">{() => (pending() ? <Spinner label={LOADING} /> : <DocumentsIcon />)}</EmptyState.Snippet>
          </EmptyState>
        )}
      >
        {() => (
          <WedyanGallery
            label={$use(() => browser.title)}
            entries={$use(() => browser.rows().map(entryOf))}
            value={$bind(state, 'picked')}
            multiple={$bind(state, 'several')}
            layout={$use(() => state.layout)}
            query={$use(() => state.query)}
            checkable
            className={BROWSE_CLASS}
            onopen={({ path }) => browser.open(path)}
          />
        )}
      </Show>
    </Window>
  );
});

/**
 * Saves pictures from the drive to the user's computer, each named after what it's called.
 *
 * @param rows - The pictures.
 */
function download(rows: FileRow[]): void {
  for (const row of rows) void downloadImage(dfs.image(row.path), row.name);
}
