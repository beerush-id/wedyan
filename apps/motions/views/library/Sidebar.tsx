import { $bind, setup } from '@airlib/react';
import { Listbox, ListboxOption } from '@airlib/react-aui';
import { WindowSidebar, WindowSidebarLabel, WindowSidebarPanel } from '@airlib/react-aui/desktop';
import { ClockIcon } from '@airlib/react-aui/icons';
import { FavoritesIcon } from '@/components/icons.js';
import { GenerativeIcon, ProjectsIcon } from '../icons.js';
import { libraryCtx, type MotionLibrary } from './context.js';
import { VIEW_LABELS } from './listing.js';

/** The library's places: a list whose value is the place open. */
export const LibrarySidebar = setup(() => {
  const { state } = libraryCtx.get() as MotionLibrary;

  return () => (
    <WindowSidebar>
      <WindowSidebarPanel>
        <WindowSidebarLabel>Library</WindowSidebarLabel>
        <Listbox aria-label="Library" size="sm" required value={$bind(state, 'activeView')}>
          <ListboxOption value="recent">
            <ClockIcon />
            <span>{VIEW_LABELS.recent}</span>
          </ListboxOption>
          <ListboxOption value="favourite">
            <FavoritesIcon />
            <span>{VIEW_LABELS.favourite}</span>
          </ListboxOption>
          <ListboxOption value="generative">
            <GenerativeIcon />
            <span>{VIEW_LABELS.generative}</span>
          </ListboxOption>
          <ListboxOption value="all">
            <ProjectsIcon />
            <span>{VIEW_LABELS.all}</span>
          </ListboxOption>
        </Listbox>
      </WindowSidebarPanel>
    </WindowSidebar>
  );
}, 'LibrarySidebar');
