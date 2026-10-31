import { Show } from '@airlib/react';
import { Window, WindowBody, WindowContent } from '@airlib/react-aui/desktop';
import { createLibrary, libraryCtx } from './context.js';
import { LibrarySheet } from './Sheet.js';
import { LibrarySidebar } from './Sidebar.js';
import { LibraryToolbar } from './Toolbar.js';

/**
 * Motions' library: a browser of the Motions folder, as Photos is of its own, where each project
 * lists as one file. Every part reads the library this window publishes.
 *
 * @returns The window's view.
 */
export function LibraryWindow() {
  const library = createLibrary();
  libraryCtx.set(library);

  return () => (
    <Window>
      <Window.Snippet for="sidebar">{() => <Show when={() => !library.state.sidebarHidden}>{() => <LibrarySidebar />}</Show>}</Window.Snippet>
      <Window.Snippet for="body">
        {() => (
          <WindowBody>
            <LibraryToolbar />
            <WindowContent>
              <LibrarySheet />
            </WindowContent>
          </WindowBody>
        )}
      </Window.Snippet>
    </Window>
  );
}
