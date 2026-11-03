import { Show } from '@airlib/react';
import { Window, WindowBody, WindowContent, type WindowRenderProps } from '@airlib/react-aui/desktop';
import { attachFacts } from '@/lib/systems/public.js';
import { animation } from '../motion.js';
import { createLibrary, libraryCtx } from './context.js';
import { LibrarySheet } from './Sheet.js';
import { LibrarySidebar } from './Sidebar.js';
import { LibraryToolbar } from './Toolbar.js';

/**
 * Motions' library: a browser of the Motions folder, as Photos is of its own, where each project
 * lists as one file. Every part reads the library this window publishes.
 *
 * @param props - The window's props.
 * @returns The window's view.
 */
export function LibraryWindow(props: WindowRenderProps) {
  const library = createLibrary();
  libraryCtx.set(library);
  attachFacts(props.instance, () => {
    const { activeView, folder, picked, query } = library.state;
    return {
      view: activeView,
      ...(activeView === 'all' ? { folder } : {}),
      ...(picked?.length ? { picked } : {}),
      ...(query ? { searching: query } : {}),
      // How a new project is made while this window is in front: the dock's settings.
      animation,
    };
  });

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
