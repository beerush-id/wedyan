import type { ListOptions } from '@irpclib/r2-file';
import { kindArt, type WedyanFileKind } from '@/components/WedyanGallery.js';
import { FILE_TYPES } from '@/lib/documents/file-types.js';
import { ADDRESS } from '@/lib/documents/generation.js';
import { parentOf } from '@/lib/documents/paths.js';
import type { FileRow } from '@/lib/documents/rows.js';
import { dfs } from '@/lib/share/dfs.js';
import { pathFrom } from '@/lib/share/paths.js';

/** The places down the side: the two folders pictures are kept in, and everything Wedyan made. */
export type LibraryView = 'photos' | 'pictures' | 'generative';

/** A place that's a folder to browse. */
export type FolderView = Exclude<LibraryView, 'generative'>;

/** The places down the side, with their names. */
export const VIEW_LABELS: Record<LibraryView, string> = {
  photos: 'Photos',
  pictures: 'Pictures',
  generative: 'Generative',
};

/** Where pictures are kept on the drive. */
export const ROOTS: Record<FolderView, string> = { photos: '~/Photos', pictures: '~/Pictures' };

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

/** Every still on the drive, newest first: `list` takes one folder, and they're kept under two. */
const STILLS: ListOptions = { recursive: true, sort: '-mtime', filter: { type: FILE_TYPES.still } };

/** The drive's home, the one folder holding both of `ROOTS`. */
const HOME = '~';

/** The longest edge a picture is asked for at on a tile, as `dfs.image` serves it. */
const TILE_SIZE = 256;

/** The kinds Photos shows, in the order a folder lists them. */
const SHOWN_KINDS = ['folder', 'still', 'image'];

/**
 * What a place asks `list` for.
 *
 * @param folder - The folder being browsed; none in Generative, which gathers from every folder.
 * @returns `list`'s arguments.
 */
export function listingOf(folder: string | undefined): [string, ListOptions] {
  return folder ? [folder, {}] : [HOME, STILLS];
}

/**
 * What of a listing belongs in Photos: folders, still projects and images under `ROOTS`, leaving out
 * what's part of a still: the folder its attempts are kept in, beside it, and those attempts.
 *
 * @param rows - The listed rows.
 * @returns The rows Photos shows.
 */
export function shownRows(rows: FileRow[]): FileRow[] {
  const stills = new Set(rows.filter((row) => row.kind === 'still').map((row) => row.path));
  const inStill = ({ path }: FileRow) => stills.has(`${path}.still`) || stills.has(`${parentOf(path)}.still`);
  return rows.filter((row) => SHOWN_KINDS.includes(row.kind) && isKept(row.path) && !inStill(row));
}

/**
 * Puts rows in the order a place shows them: Generative as listed, newest first; a folder by kind,
 * then by what they're called.
 *
 * @param view - The place.
 * @param rows - The rows.
 * @returns The rows in order.
 */
export function orderOf(view: LibraryView, rows: FileRow[]): FileRow[] {
  if (view === 'generative') return rows;
  const rank = (row: FileRow) => SHOWN_KINDS.indexOf(row.kind);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Whether a change to a file changes what a place lists.
 *
 * @param folder - The folder being browsed; none in Generative.
 * @param path - The file.
 * @returns Whether it's listed there.
 */
export const changesListing = (folder: string | undefined, path: string): boolean =>
  folder ? parentOf(path) === folder : STILL_FILE.test(path);

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
  return ADDRESS.test(src) ? src : dfs.image(pathFrom(still, src), size ? { size } : undefined);
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
  if (row.kind === 'still' && row.thumbnail) return addressOf(row.path, row.thumbnail, size);
  return kindArt(row.kind as WedyanFileKind);
}

/**
 * A listed row's picture at its own size, to view or keep.
 *
 * @param row - The row.
 * @returns Its address; none for a folder, or a still with nothing made yet.
 */
export function originalOf(row: FileRow): string | undefined {
  if (row.kind === 'image') return dfs.image(row.path);
  if (row.kind === 'still' && row.src) return addressOf(row.path, row.src);
}

/**
 * What matters about a listed row, in a line.
 *
 * @param row - The row.
 * @returns An image's size, or what it is.
 */
export function detailOf(row: FileRow): string {
  if (row.kind === 'image') return sizeOf(row.size);
  return row.kind === 'still' ? 'Still project' : 'Folder';
}

/**
 * When a listed row last changed, short.
 *
 * @param row - The row.
 * @returns The date; none for a folder.
 */
export function modifiedOf(row: FileRow): string | undefined {
  if (row.kind === 'folder') return;
  return shortDate(row.updated ?? row.mtime);
}

/**
 * A date as lists show it, e.g. `Oct 27`.
 *
 * @param date - The date.
 * @returns Its month and day.
 */
export function shortDate(date: string | Date): string {
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * How large a file is, in words.
 *
 * @param bytes - Its size.
 * @returns E.g. `2.4 MB` or `340 kB`.
 */
export function sizeOf(bytes: number): string {
  const large = bytes >= 1_000_000;
  const format = new Intl.NumberFormat(undefined, { style: 'unit', unit: large ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1 });
  return format.format(bytes / (large ? 1_000_000 : 1_000));
}

/**
 * Whether a file is under one of `ROOTS`.
 *
 * @param path - The file.
 * @returns Whether Photos keeps it.
 */
function isKept(path: string): boolean {
  return Object.values(ROOTS).some((root) => path.startsWith(`${root}/`));
}
