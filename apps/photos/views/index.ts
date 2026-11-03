import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, linkTarget, mediaOf } from '@/lib/systems/public.js';
import { STILL_FILE } from './listing.js';
import { openPhotos, photos } from './Main.js';
import { openStill, stillProject } from './Still.js';

export { COMMANDS as commands } from './prompt.js';
export { photos, stillProject };

/** What Photos opens: `photos:~/Photos/boats.still` in a window of its own, any other picture in the browser, picked. */
export const linkHandle: Record<string, LinkHandle> = {
  photos: (link) => {
    const path = linkTarget(link);
    if (STILL_FILE.test(path)) openStill(path);
    else openPhotos(path);
  },
};

/**
 * Whether Photos opens a file: a still, or a picture.
 *
 * @param path - The file's path.
 * @returns True for a `.still` or a picture file.
 */
export function opens(path: string): boolean {
  return STILL_FILE.test(path) || mediaOf(path) === 'image';
}

/** Photos' entry: launching it opens the browser. */
export default (() => {
  openPhotos();
}) satisfies AUIBoot;
