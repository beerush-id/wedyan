/**
 * A path written in a file, as a path in the home: relative ones resolve from that file's folder,
 * as the formats write them (`../Skills/Teacher.skill`, `Hero/a1.webp`); home paths stay as they
 * are. Never leaves the home.
 *
 * @param file - The file it's written in, by its path in the home.
 * @param path - The path as written.
 * @returns Its path in the home.
 */
export function pathFrom(file: string, path: string): string {
  const parts = path.startsWith('~/') ? [] : file.slice(2).split('/').slice(0, -1);
  for (const part of (path.startsWith('~/') ? path.slice(2) : path).split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return `~/${parts.join('/')}`;
}

/**
 * A path in the home as a file in the same folder writes it: relative to that folder.
 *
 * @param file - The file it will be written in, by its path in the home.
 * @param path - The path in the home, inside that file's folder.
 * @returns The path from that file's folder.
 */
export function pathTo(file: string, path: string): string {
  const folder = file.slice(0, file.lastIndexOf('/') + 1);
  return path.startsWith(folder) ? path.slice(folder.length) : path;
}
