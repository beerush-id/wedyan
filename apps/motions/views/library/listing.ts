import type { FileInfo, ListOptions } from '@irpclib/r2-file';
import type { WedyanGalleryEntry } from '@/components/WedyanGallery.js';
import { FILE_TYPES, FLAGGED } from '@/lib/documents/file-types.js';
import { homePath, nameOf } from '@/lib/documents/paths.js';
import type { FileChange } from '@/lib/share/workspace.js';
import { documentAt, duration, MOTION_FILE, type Project, ROOT, shortDate } from '../motion.js';

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
 * What a listed file shows as: a project, by a `.motion` or a folder holding one of its own name; a
 * plain folder; nothing else lists.
 *
 * @param file - The listed file.
 * @param lengthOf - How long a project runs, by its id.
 * @returns Its tile, once a project has arrived.
 */
export function tileOf(file: FileInfo, lengthOf: (project: string) => number): WedyanGalleryEntry[] {
  const path = homePath(file.path);
  const motion = file.isDirectory ? `${path}/${file.name}.motion` : path;
  const document = documentAt<'motion'>(motion);
  if (!document) return file.isDirectory ? [{ path, name: file.name, kind: 'folder', detail: 'Folder' }] : [];

  const project = { path: motion, document };
  const by = document.author.kind === 'agent' ? 'Wedyan' : 'You';
  return [
    {
      path: motion,
      name: document.name,
      kind: 'motion',
      detail: [duration(lengthOf(document.id)), statusOf(project), by].join(' · '),
      modified: shortDate(document.updated),
    },
  ];
}

/**
 * Where a project stands, in a word.
 *
 * @param project - The project.
 * @returns `Rendered` or `Draft`.
 */
export function statusOf(project: Project): string {
  return project.document.status === 'rendered' ? 'Rendered' : 'Draft';
}
