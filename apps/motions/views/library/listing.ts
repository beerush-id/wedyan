import type { ListOptions } from '@irpclib/r2-file';
import type { WedyanGalleryEntry } from '@/components/WedyanGallery.js';
import { FILE_TYPES, FLAGGED } from '@/lib/documents/file-types.js';
import { homePath, nameOf } from '@/lib/documents/paths.js';
import type { FileRow } from '@/lib/documents/rows.js';
import type { FileChange } from '@/lib/share/workspace.js';
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
  if (view === 'all') return [folder, { sort: ['-type', 'name'] }];
  if (view === 'recent') return [ROOT, { ...PROJECTS, sort: '-mtime', limit: RECENT_COUNT }];
  return [ROOT, { ...PROJECTS, sort: 'name', filter: { ...PROJECTS.filter, metadata: { [view]: FLAGGED } } }];
}

/**
 * Whether a change alters what a listing holds: a project coming, going or being saved, which moves
 * it in Recents and may change its flags, a stage, which changes a project's length, or a folder
 * coming or going.
 *
 * @param change - What changed.
 * @returns Whether to list again.
 */
export const changesListing = ({ path, removed }: FileChange): boolean =>
  removed || MOTION_FILE.test(path) || path.endsWith('.stage') || !nameOf(path).includes('.');

/**
 * What a listed row shows as: a project, whether its `.motion` or the folder holding one of its own
 * name was listed; a plain folder; nothing else lists.
 *
 * @param row - The listed row.
 * @returns Its tile.
 */
export function tileOf(row: FileRow): WedyanGalleryEntry[] {
  if (row.kind === 'motion') {
    return [
      {
        path: row.path,
        name: row.name,
        kind: 'motion',
        picture: row.thumbnail,
        detail: [duration(row.duration), statusOf(row), row.author].join(' · '),
        modified: row.updated && shortDate(row.updated),
      },
    ];
  }
  return row.isDirectory ? [{ path: homePath(row.path), name: row.name, kind: 'folder', detail: 'Folder' }] : [];
}

/**
 * Where a project stands, in a word.
 *
 * @param project - The project's row.
 * @returns `Rendered` or `Draft`.
 */
export function statusOf(project: FileRow): string {
  return project.status === 'rendered' ? 'Rendered' : 'Draft';
}
