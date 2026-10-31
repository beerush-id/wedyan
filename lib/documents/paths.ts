/** Where a listed path starts from: the user's home in the mount. */
const MOUNTED_HOME = /^\/users\/[^/]+/;

/**
 * A listed file's path as the desktop writes it.
 *
 * @param mounted - Its path as r2-file lists it, from the mount's root.
 * @returns Its home path (`~/…`).
 */
export function homePath(mounted: string): string {
  return mounted.startsWith('~') ? mounted : `~${mounted.replace(MOUNTED_HOME, '')}`;
}

/**
 * A new file's or folder's name: what it's found by, whatever it's called, so naming it never moves it.
 *
 * @returns A short id.
 */
export function newId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 12);
}

/**
 * Where a path written in a document leads: relative paths from the document's folder, absolute
 * ones as they are.
 *
 * @param from - The path of the document it is written in.
 * @param path - The path as written, e.g. `Promo.stage` or `../../Memos/Tone.memo`.
 * @returns The path it leads to.
 */
export function resolvePath(from: string, path: string): string {
  if (path.startsWith('/') || path.startsWith('~')) return path;
  const parts = from.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/**
 * The last part of a path: a file's or a folder's name.
 *
 * @param path - The path.
 * @returns Its name.
 */
export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * The folder a path is in.
 *
 * @param path - The path.
 * @returns Its folder's path.
 */
export function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

/**
 * The header a new document starts with, named after its file and made by the user.
 *
 * @param path - Where it goes.
 * @param extension - Its file's extension, left out of its name.
 * @returns Its header.
 */
export function newHeader(path: string, extension: string) {
  const now = new Date().toISOString();
  return {
    version: 1 as const,
    id: crypto.randomUUID(),
    name: nameOf(path).slice(0, -extension.length),
    created: now,
    updated: now,
    author: { kind: 'user' as const },
  };
}
