import { Show } from '@airlib/react';
import { defineWindow, Window, WindowBody, WindowContent } from '@airlib/react-aui/desktop';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../../manifest.json';
import { CONTEXTS } from '../prompt.js';
import { createLibrary, libraryCtx } from './context.js';
import { LibraryDockOptions } from './DockOptions.js';
import { LibrarySheet } from './Sheet.js';
import { LibrarySidebar } from './Sidebar.js';
import { LibraryToolbar } from './Toolbar.js';

/**
 * Motions' library: a browser of the Motions folder, as Photos is of its own, where each project
 * lists as one file. Every part reads the library this window publishes.
 */
export const motionLibrary = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 560, minHeight: 400 },
  dockExtensions: LibraryDockOptions,
}).render(() => {
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
});

/**
 * Brings the library forward, or opens it.
 *
 * @returns The library's window.
 */
export function openLibrary() {
  const [open] = motionLibrary.instances;
  if (!open) return motionLibrary.open(undefined, { name: 'library', contexts: CONTEXTS });
  open.focus();
  return open;
}
