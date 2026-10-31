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
  const type = params.get('type') as 'image' | 'video' | 'audio' | null;
  return type ? { src: target, type, name: params.get('name') ?? undefined } : target;
}

/**
 * What a link points at: everything after its scheme.
 *
 * @param link - The link, e.g. `mail:/Mail/m1.eml`.
 * @returns Its target, e.g. `/Mail/m1.eml`.
 */
export function linkTarget(link: string): string {
  return decodeURI(link.slice(link.indexOf(':') + 1));
}
