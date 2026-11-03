import { defineWindow, Window, WindowBody, WindowContent, type WindowRenderProps } from '@airlib/react-aui/desktop';
import { attachCommands, attachFacts } from '@/lib/systems/public.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { createLibrary, libraryCtx, type PhotosData } from './library.js';
import { generation } from './making.js';
import { BrowseOptions } from './options.js';
import { browserCommands, pictures } from './prompt.js';
import { LibrarySheet } from './Sheet.js';
import { LibraryToolbar } from './Toolbar.js';

/**
 * Photos' browser: one view of every picture on the drive, wherever it's kept, newest first, as
 * tiles, and beside them a preview of the picked one, off until it's turned on. While it's in front,
 * the dock holds how new images are made. Every part reads the library this window publishes.
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
  return photos.open({ ...(picture ? { picture } : {}), generation } satisfies PhotosData, {
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
  attachCommands(props.instance, browserCommands());
  attachFacts(props.instance, () => {
    const { picked, viewing, index, query } = library.state;
    return {
      ...(picked?.length ? { picked } : {}),
      ...(viewing ? { viewing: library.images()[index]?.path } : {}),
      ...(query ? { searching: query } : {}),
      // How a new picture is made while this window is in front: the dock's settings.
      generation,
    };
  });

  return () => (
    <Window>
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
