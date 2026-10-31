import { defineWindow } from '@airlib/react-aui/desktop';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../../manifest.json';
import { CONTEXTS } from '../prompt.js';
import { LibraryDockOptions } from './DockOptions.js';
import { LibraryWindow } from './Window.js';

/** The library's window. */
export const motionLibrary = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 560, minHeight: 400 },
  dockExtensions: LibraryDockOptions,
}).render(LibraryWindow);

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
