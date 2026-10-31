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
 * What a link points at: everything after its scheme.
 *
 * @param link - The link, e.g. `mail:/Mail/m1.eml`.
 * @returns Its target, e.g. `/Mail/m1.eml`.
 */
export function linkTarget(link: string): string {
  return decodeURI(link.slice(link.indexOf(':') + 1));
}
