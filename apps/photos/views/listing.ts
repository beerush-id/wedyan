import type { ListOptions } from '@irpclib/r2-file';
import { kindArt, type WedyanFileKind } from '@/components/WedyanGallery.js';
import { ADDRESS } from '@/lib/documents/generation.js';
import { type FileRow, shortDate, sizeOf } from '@/lib/documents/rows.js';
import { isMedia } from '@/lib/documents/words.js';
import { dfs } from '@/lib/share/dfs.js';
import { pathFrom } from '@/lib/share/paths.js';

/** Where a new still is kept. */
export const ROOT = '~/Photos';

/** The drive's home, which everything Photos shows is under. */
export const HOME = '~';

/** Every picture on the drive, wherever it's kept, newest first. */
export const PICTURES: [string, ListOptions] = [HOME, { recursive: true, sort: '-mtime', scope: { pictures: 'true' } }];

/** A still project's own file. */
export const STILL_FILE = /\.still$/;

/** What the image viewer's buttons say. */
export const VIEWER_LABELS = {
  previous: 'Previous photo',
  next: 'Next photo',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fullscreen: 'Full screen',
};

/** The longest edge a picture is asked for at on a tile, as `dfs.image` serves it. */
const TILE_SIZE = 256;

/** The longest edge a picture is asked for at in the viewer, as `dfs.image` serves it. */
export const VIEWER_SIZE = 1600;

/**
 * Whether a file is one Photos might show, so a change to it lists the drive again.
 *
 * @param path - The file.
 * @returns Whether it's a still or a picture.
 */
export const isPicture = (path: string): boolean => STILL_FILE.test(path) || isMedia(path);

/**
 * A picture written in a still as an address to show it from: attempts are kept by path from the
 * still, and only an address reaches `<img>`.
 *
 * @param still - The still's path.
 * @param src - The picture, as written.
 * @param size - Its longest edge, one of `IMAGE_SIZES`; the original without one.
 * @returns Its address.
 */
export function addressOf(still: string, src: string, size?: number): string {
  return dfs.image(ADDRESS.test(src) ? src : pathFrom(still, src), size ? { size } : undefined);
}

/**
 * A listed row's picture, small: an image itself, a still's chosen attempt, or its kind's art.
 *
 * @param row - The row.
 * @param size - Its longest edge, one of `IMAGE_SIZES`.
 * @returns The picture's address.
 */
export function pictureOf(row: FileRow, size = TILE_SIZE): string {
  if (row.kind === 'image') return dfs.image(row.path, { size });
  if (row.thumbnail) return addressOf(row.path, row.thumbnail, size);
  return kindArt(row.kind as WedyanFileKind);
}

/**
 * A listed row's picture at its own size, to keep.
 *
 * @param row - The row.
 * @returns Its address; none for a still with nothing made yet.
 */
export function originalOf(row: FileRow): string | undefined {
  if (row.kind === 'image') return dfs.image(row.path);
  if (row.src) return addressOf(row.path, row.src);
}

/**
 * A listed row's picture as the viewer shows it.
 *
 * @param row - The row.
 * @returns Its address; none for a still with nothing made yet.
 */
export function viewedOf(row: FileRow): string | undefined {
  if (row.kind === 'image') return dfs.image(row.path, { size: VIEWER_SIZE });
  if (row.src) return addressOf(row.path, row.src, VIEWER_SIZE);
}

/**
 * What matters about a listed row, in a line.
 *
 * @param row - The row.
 * @returns An image's size, or that it's a still.
 */
export const detailOf = (row: FileRow): string => (row.kind === 'image' ? sizeOf(row.size) : 'Still project');

/**
 * When a listed row last changed, short.
 *
 * @param row - The row.
 * @returns The date.
 */
export const modifiedOf = (row: FileRow): string => shortDate(row.updated ?? row.mtime);
