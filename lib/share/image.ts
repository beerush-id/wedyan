import { type Resize, url } from '@irpclib/r2-image';

/**
 * The longest edges a picture is resized to, kept once each in storage. Any other size gets the
 * original picture.
 */
export const IMAGE_SIZES = [64, 128, 256, 512, 1024];

/**
 * A picture's URL with its resizing spelled out, for when writing `?s=` by hand isn't wanted. Never
 * required: any file's home path is already its `src` (`~/Pictures/cat.png?s=256`), served only to
 * its own session, with nothing to sign and no session in the URL.
 *
 * @param path - The picture's home path (`~/…`), or the address it's stored by (`/~/…`). Anything
 *   hosted elsewhere, like `https:` or `data:`, isn't this desktop's to resize and stays as it is.
 * @param resize - How to resize it: `size` (longest edge, one of `IMAGE_SIZES`), `format`, `fit`.
 * @returns The URL, from this desktop's root so it reads the same on any page.
 */
export function imageUrl(path: string, resize?: Resize): string {
  if (ELSEWHERE.test(path)) return path;
  const [file] = path.replace(/^\//, '').split('?');
  const encoded = file.split('/').map(encodeURIComponent).join('/');
  return url(`/${encoded}`, resize);
}

/** A picture hosted somewhere else, by its scheme. */
const ELSEWHERE = /^[a-z][a-z0-9+.-]*:/i;
