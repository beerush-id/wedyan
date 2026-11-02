import type { WedyanFileKind, WedyanGalleryEntry } from '@/components/WedyanGallery.js';
import { ADDRESS } from '@/lib/documents/generation.js';
import { type FileRow, shortDate, sizeOf } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import { pathFrom } from '@/lib/share/paths.js';
import { SYSTEM_FILES } from '@/lib/share/system.js';

/** A folder to go to: where it is and what it's called. */
export type Place = { path: string; name: string };

/** The top of the user's drive. */
export const HOME = '~';

/** The longest edge a picture is asked for at on a tile, as `dfs.image` serves it. */
const TILE_SIZE = 256;

/** The kinds the gallery has its own art for; anything else reads as a document. */
const KINDS: WedyanFileKind[] = ['folder', 'image', 'video', 'audio', 'still', 'take', 'sound', 'motion', 'stage'];

/** Whether a path is the system's own, by what `SYSTEM_FILES` writes for it; `{n}` is a page number. */
const isSystem = (path: string, kind: 'file' | 'folder'): boolean =>
  SYSTEM_FILES.some((entry) => {
    if (entry.kind !== kind) return false;
    const [before, after] = entry.path.split('{n}');
    return after === undefined ? path === before : path.startsWith(before) && path.endsWith(after);
  });

/**
 * Whether a listed row is the user's to see: the system's own files, like the conversation, aren't.
 *
 * @param row - The row.
 * @returns Whether Files lists it.
 */
export const isShown = (row: FileRow): boolean => row.isDirectory || !isSystem(row.path, 'file');

/**
 * Whether a listed row is the user's to delete: the system's own folders are shown, and stay.
 *
 * @param row - The row.
 * @returns Whether it can go.
 */
export const isRemovable = (row: FileRow): boolean => !isSystem(row.path, 'folder');

/**
 * Puts rows in the order a folder shows them: folders first, then by what they're called.
 *
 * @param rows - The rows.
 * @returns The rows in order.
 */
export const orderOf = (rows: FileRow[]): FileRow[] =>
  [...rows].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));

/**
 * The folders at the top of the drive, for down the side.
 *
 * @param rows - The home's rows.
 * @returns Each folder, in order.
 */
export const placesOf = (rows: FileRow[]): Place[] =>
  orderOf(rows)
    .filter((row) => row.isDirectory)
    .map(({ path, name }) => ({ path, name }));

/**
 * A listed row as the file every Wedyan gallery shows.
 *
 * @param row - The row.
 * @returns The file, for the gallery.
 */
export function entryOf(row: FileRow): WedyanGalleryEntry {
  return {
    path: row.path,
    name: row.name,
    kind: KINDS.includes(row.kind as WedyanFileKind) ? (row.kind as WedyanFileKind) : 'document',
    picture: pictureOf(row),
    detail: row.isDirectory ? 'Folder' : sizeOf(row.size),
    modified: row.isDirectory || !row.updated ? undefined : shortDate(row.updated),
  };
}

/**
 * A listed row's picture, small: an image itself, or what a document says shows it.
 *
 * @param row - The row.
 * @returns The picture's address; none for what's shown by its kind's art.
 */
function pictureOf(row: FileRow): string | undefined {
  if (row.kind === 'image') return dfs.image(row.path, { size: TILE_SIZE });
  const { thumbnail } = row;
  if (!thumbnail) return;
  return ADDRESS.test(thumbnail) ? thumbnail : dfs.image(pathFrom(row.path, thumbnail), { size: TILE_SIZE });
}
