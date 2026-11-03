import { ADDRESS, chosenAttempt } from '@/lib/documents/generation.js';
import type { StillDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { follow } from '@/lib/share/documents.js';
import { pathFrom } from '@/lib/share/paths.js';

// A picture a document writes, like one of a persona's, is a path to its `.still` or an address:
// how any app shows it.

/**
 * One of a document's pictures as a picture to show: the attempt its `.still` shows.
 *
 * @param from - The path of the document it is written in.
 * @param source - The picture, by path from the document to its `.still`, or an address.
 * @param size - Its longest edge, where it shows small; the picture as made without one.
 * @returns The picture's address, unless the path leads to no still or the still has no attempt yet.
 */
export function pictureOf(from: string, source: string, size?: number): string | undefined {
  if (ADDRESS.test(source)) return addressOf(from, source, size);
  const still = stillAt(from, source);
  const src = still && chosenAttempt(still.document)?.src;
  return still && src ? addressOf(still.path, src, size) : undefined;
}

/**
 * The `.still` one of a document's pictures is: what keeps its prompt, settings, references and attempts.
 *
 * @param from - The path of the document it is written in.
 * @param source - The picture, by path from the document to its `.still`.
 * @returns The still and where it is, unless the path leads to none, or it hasn't arrived.
 */
export function stillAt(from: string, source: string): { path: string; document: StillDocument } | undefined {
  if (ADDRESS.test(source)) return;
  const { path, document } = follow(from, source);
  return document?.type === 'still' ? { path, document } : undefined;
}

/**
 * A picture written in a file as an address for `<img src>`: an attempt keeps its picture by path
 * from its still.
 *
 * @param file - The file it's written in, by its path in the home.
 * @param src - The picture, as written.
 * @param size - Its longest edge, if it's resized.
 * @returns Its address.
 */
export function addressOf(file: string, src: string, size?: number): string {
  return dfs.image(ADDRESS.test(src) ? src : pathFrom(file, src), size ? { size } : undefined);
}
