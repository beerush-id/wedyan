/** The room a window keeps from the desktop's edges, so it reads as a window rather than maximized. */
const INSET = 16;

/** The room kept at the foot for the dock, so a window doesn't open under it. */
const DOCK_ROOM = 80;

/** The largest a window opens by default, so it doesn't sprawl across a large screen. */
const MAX_SIZE = { width: 1280, height: 800 };

/**
 * Where an app's window opens by default: as large as the desktop allows, up to 1280 × 800, centred
 * in the room above the dock and clear of the edges — a window that can still be moved and resized,
 * not a maximized one. Read each time a window opens, so it fits the screen it opens on; once the
 * window is moved or resized, where it was is remembered instead.
 *
 * @returns The window's place and size, read as it opens.
 */
export function fullRect(): { x: number; y: number; width: number; height: number } {
  const room = () => ({
    width: Math.max(window.innerWidth - INSET * 2, 0),
    height: Math.max(window.innerHeight - INSET - DOCK_ROOM, 0),
  });
  const size = () => ({ width: Math.min(room().width, MAX_SIZE.width), height: Math.min(room().height, MAX_SIZE.height) });

  return {
    get x() {
      return INSET + Math.round((room().width - size().width) / 2);
    },
    get y() {
      return INSET + Math.round((room().height - size().height) / 2);
    },
    get width() {
      return size().width;
    },
    get height() {
      return size().height;
    },
  };
}
