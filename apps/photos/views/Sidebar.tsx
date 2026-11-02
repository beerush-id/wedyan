import { $bind, setup } from '@airlib/react';
import { Listbox, ListboxOption } from '@airlib/react-aui';
import { WindowSidebar, WindowSidebarLabel, WindowSidebarPanel } from '@airlib/react-aui/desktop';
import { FolderIcon } from '@airlib/react-aui/icons';
import { GenerativeIcon, LibraryIcon } from './icons.js';
import { libraryCtx, type PhotoLibrary } from './library.js';
import { VIEW_LABELS } from './listing.js';

/** The browser's places: a list whose value is the place open. */
export const LibrarySidebar = setup(() => {
  const { state } = libraryCtx.get() as PhotoLibrary;

  return () => (
    <WindowSidebar>
      <WindowSidebarPanel>
        <WindowSidebarLabel>Library</WindowSidebarLabel>
        <Listbox aria-label="Library" size="sm" aside required value={$bind(state, 'activeView')}>
          <ListboxOption value="photos">
            <LibraryIcon />
            <span>{VIEW_LABELS.photos}</span>
          </ListboxOption>
          <ListboxOption value="pictures">
            <FolderIcon />
            <span>{VIEW_LABELS.pictures}</span>
          </ListboxOption>
          <ListboxOption value="generative">
            <GenerativeIcon />
            <span>{VIEW_LABELS.generative}</span>
          </ListboxOption>
        </Listbox>
      </WindowSidebarPanel>
    </WindowSidebar>
  );
}, 'LibrarySidebar');
