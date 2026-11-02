import { Show } from '@airlib/react';
import { defineWindow, Window, WindowBody, WindowContent, type WindowRenderProps } from '@airlib/react-aui/desktop';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { createLibrary, libraryCtx, type PhotosData } from './library.js';
import { BrowseOptions } from './options.js';
import { pictures } from './prompt.js';
import { LibrarySheet } from './Sheet.js';
import { LibrarySidebar } from './Sidebar.js';
import { LibraryToolbar } from './Toolbar.js';

/**
 * Photos' browser, like a file explorer of the folders pictures are kept in: down the side, each
 * folder, and everything Wedyan made; as tiles, what the place holds, and beside them a preview of
 * the picked one, off until it's turned on. While it's in front, the dock holds how new images are
 * made. Every part reads the library this window publishes.
 */
export const photos = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 520, minHeight: 360 },
  multiple: true,
  dockExtensions: BrowseOptions,
}).render(PhotosWindow);

/**
 * Opens a browser, on a picture when given one.
 *
 * @param picture - The picture to show, by path.
 * @returns The browser's window.
 */
export function openPhotos(picture?: string) {
  return photos.open(picture ? { picture } : undefined, {
    name: 'browser',
    get contexts() {
      return pictures();
    },
  });
}

/**
 * A browser window: publishes its library, and lays out its parts.
 *
 * @param props - The window's props.
 * @returns The window's view.
 */
function PhotosWindow(props: WindowRenderProps) {
  const library = createLibrary(props.instance.data as PhotosData);
  libraryCtx.set(library);

  return () => (
    <Window sidebarResizeLabel="Resize sidebar">
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
