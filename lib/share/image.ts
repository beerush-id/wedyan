import { type Resize, url } from '@irpclib/r2-image';

/**
 * Where the desktop shows a picture, by its home path: `/images/~/Pictures/cat.png?s=256`. The
 * server serves only the asking session's own pictures there; no session ever appears in the URL.
 */
export const IMAGES_PATH = '/images/';

/**
 * The longest edges a picture is resized to, kept once each in storage. Any other size gets the
 * original picture.
 */
export const IMAGE_SIZES = [64, 128, 256, 512, 1024];

/**
 * A picture's URL for `<img src>`: the user's own picture by its home path, resized when a size is
 * given. A plain path; nothing to sign.
 *
 * @param path - The picture's home path (`~/…`).
 * @param resize - How to resize it: `size` (longest edge, one of `IMAGE_SIZES`), `format`, `fit`.
 * @returns The URL, on this desktop's own origin.
 */
export function imageUrl(path: string, resize?: Resize): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return url(`${IMAGES_PATH}${encoded}`, resize);
}
