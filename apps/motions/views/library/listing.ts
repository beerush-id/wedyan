import type { ListOptions } from '@irpclib/r2-file';
import { kindArt, type WedyanFileKind } from '@/components/WedyanGallery.js';
import { FILE_TYPES, FLAGGED } from '@/lib/documents/file-types.js';
import { nameOf, parentOf } from '@/lib/documents/paths.js';
import type { FileRow } from '@/lib/documents/rows.js';
import { duration, MOTION_FILE, ROOT, shortDate } from '../motion.js';

/** The places down the library's side. */
export type LibraryView = 'recent' | 'favourite' | 'generative' | 'all';

/** The places down the side, with their names. */
export const VIEW_LABELS: Record<LibraryView, string> = {
  recent: 'Recents',
  favourite: 'Favorites',
  generative: 'Generative',
  all: 'All motions',
};

/** How many of the newest projects Recents lists. */
const RECENT_COUNT = 10;

/** Every project, from every folder. */
const PROJECTS = { recursive: true, filter: { type: FILE_TYPES.motion } };

/**
 * What a place asks `list` for: only what it shows.
 *
 * @param view - The place.
 * @param folder - The folder being browsed, which is what `all` shows.
 * @returns `list`'s arguments.
 */
export function listingOf(view: LibraryView, folder: string): [string, ListOptions] {
  if (view === 'all') return [folder, {}];
  if (view === 'recent') return [ROOT, { ...PROJECTS, sort: '-mtime', limit: RECENT_COUNT }];
  return [ROOT, { ...PROJECTS, filter: { ...PROJECTS.filter, metadata: { [view]: FLAGGED } } }];
}

/**
 * Puts rows in the order a place shows them: Recents as listed, newest first; anywhere else folders
 * first, by what they're called, which only the rows know: files are named by id.
 *
 * @param view - The place.
 * @param rows - The rows.
 * @returns The rows in order.
 */
export function orderOf(view: LibraryView, rows: FileRow[]): FileRow[] {
  if (view === 'recent') return rows;
  return [...rows].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
}

/**
 * Whether a file belongs in what a place lists: in a folder, what's directly in it, a folder or the
 * project in one; anywhere else, any project.
 *
 * @param view - The place.
 * @param folder - The folder being browsed.
 * @param path - The file.
 * @returns Whether it's listed there.
 */
export const changesListing = (view: LibraryView, folder: string, path: string): boolean => {
  if (view !== 'all') return MOTION_FILE.test(path);
  if (MOTION_FILE.test(path)) return parentOf(parentOf(path)) === folder;
  return parentOf(path) === folder && !nameOf(path).includes('.');
};

/**
 * A listed row's picture: a project's thumbnail, or its kind's art.
 *
 * @param row - The row.
 * @returns The picture's address.
 */
export const pictureOf = (row: FileRow): string => row.thumbnail || kindArt(row.kind as WedyanFileKind);

/**
 * What matters about a listed row, in a line.
 *
 * @param row - The row.
 * @returns A project's length, status and author, or that it's a folder.
 */
export const detailOf = (row: FileRow): string =>
  row.kind === 'motion' ? [duration(row.duration), statusOf(row), row.author].join(' · ') : 'Folder';

/**
 * When a listed row last changed, short.
 *
 * @param row - The row.
 * @returns The date; none for a folder.
 */
export const modifiedOf = (row: FileRow): string | undefined => (row.updated ? shortDate(row.updated) : undefined);

/**
 * Where a project stands, in a word.
 *
 * @param project - The project's row.
 * @returns `Rendered` or `Draft`.
 */
export function statusOf(project: FileRow): string {
  return project.status === 'rendered' ? 'Rendered' : 'Draft';
}
