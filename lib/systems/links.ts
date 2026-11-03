import type { PreviewTarget } from './system.js';

/**
 * A link to something on the drive, safe in Markdown whatever its name holds.
 *
 * @param scheme - What opens it, e.g. `mail`.
 * @param path - Its path, e.g. `/Mail/m1.eml`.
 * @returns The link, e.g. `mail:/Mail/m1.eml`.
 */
export function linkTo(scheme: string, path: string): string {
  return `${scheme}:${encodeURI(path)}`;
}

/**
 * A link that shows a picture, a video or a sound by its address, which a path alone can't say.
 *
 * @param src - Its address.
 * @param type - What it is.
 * @param name - What to call it.
 * @returns The link, e.g. `preview:/~/Motions/a.png?type=image&name=Hero`.
 */
export function previewLink(src: string, type: 'image' | 'video' | 'audio', name: string): string {
  return linkTo('preview', `${src}?${new URLSearchParams({ type, name })}`);
}

/**
 * What a `preview:` link shows.
 *
 * @param link - The link.
 * @returns A document's path, or what `previewLink` addressed.
 */
export function previewTarget(link: string): PreviewTarget {
  const [target, query] = linkTarget(link).split('?');
  const params = new URLSearchParams(query);
  const type = (params.get('type') as 'image' | 'video' | 'audio' | null) ?? mediaOf(target);
  if (!type) return target;
  const name = params.get('name') ?? target.slice(target.lastIndexOf('/') + 1);
  return { src: target.startsWith('~/') ? `/~${target.slice(1)}` : target, type, name };
}

/**
 * What a file is by its name, when it's a picture, a video or a sound: a path alone can say that
 * much, so a link needs no more to show one.
 *
 * @param path - The file's path.
 * @returns Its kind, or undefined for anything else.
 */
export function mediaOf(path: string): 'image' | 'video' | 'audio' | undefined {
  if (/\.(webp|png|jpe?g|gif|avif)$/i.test(path)) return 'image';
  if (/\.(mp4|webm|mov)$/i.test(path)) return 'video';
  return /\.(mp3|wav|m4a|ogg)$/i.test(path) ? 'audio' : undefined;
}

/**
 * What a link points at: everything after its scheme. A home file's address, `/~/…`, names the same
 * file as its path, so it's read as the path.
 *
 * @param link - The link, e.g. `mail:/Mail/m1.eml` or `/~/Motions/a/a.motion`.
 * @returns Its target, e.g. `/Mail/m1.eml` or `~/Motions/a/a.motion`.
 */
export function linkTarget(link: string): string {
  const target = decodeURI(link.slice(link.indexOf(':') + 1));
  return target.startsWith(HOME_ADDRESS) ? target.slice(1) : target;
}

/** How a home file's address starts: its path, served from the root. */
const HOME_ADDRESS = '/~/';
