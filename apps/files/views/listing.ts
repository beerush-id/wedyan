import { kindArt, type WedyanFileKind } from '@/components/WedyanGallery.js';
import { ADDRESS } from '@/lib/documents/generation.js';
import { parentOf } from '@/lib/documents/paths.js';
import { type FileRow, shortDate, sizeOf } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import { pathFrom } from '@/lib/share/paths.js';

/** A folder to go to: where it is and what it's called. */
export type Place = { path: string; name: string };

/** The top of the user's drive. */
export const HOME: Place = { path: '~', name: 'Home' };

/** What the drive calls a folder. */
export const FOLDER_TYPE = 'inode/directory';

/** How long typing rests before it's searched, in milliseconds. */
export const SEARCH_WAIT = 250;

/** The most a search brings back. */
export const FOUND_LIMIT = 100;

/** The longest edge a picture is asked for at on a tile, as `dfs.image` serves it. */
const TILE_SIZE = 256;

/**
 * A row's picture, small: an image itself, what a document says shows it, or its kind's art.
 *
 * @param row - The row.
 * @returns The picture's address.
 */
export function pictureOf(row: FileRow): string {
  if (row.kind === 'image') return dfs.image(row.path, { size: TILE_SIZE });
  const { thumbnail } = row;
  if (!thumbnail) return kindArt(row.kind as WedyanFileKind);
  return ADDRESS.test(thumbnail) ? thumbnail : dfs.image(pathFrom(row.path, thumbnail), { size: TILE_SIZE });
}

/**
 * What matters about a row in a folder, in a line.
 *
 * @param row - The row.
 * @returns A file's size, or that it's a folder.
 */
export const detailOf = (row: FileRow): string => (row.isDirectory ? 'Folder' : sizeOf(row.size));

/**
 * What matters about a row a search found, in a line: where it is.
 *
 * @param row - The row.
 * @returns The folder it's in.
 */
export const whereOf = (row: FileRow): string => parentOf(row.path).replace(HOME.path, HOME.name);

/**
 * When a row last changed, short.
 *
 * @param row - The row.
 * @returns The date; none for a folder.
 */
export const modifiedOf = (row: FileRow): string | undefined =>
  row.isDirectory || !row.updated ? undefined : shortDate(row.updated);
