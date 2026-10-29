import { documentAt } from '@/lib/documents/store.js';
import type { DocumentType } from '@/lib/documents/types.js';
import { stagesOf } from './library.js';

/**
 * Where a Motions window is: its library, a project open, or one of the project's documents open
 * in its own view. Each window keeps its own, so two windows can show two projects.
 */
export type MotionsRoute = {
  /** Which view shows: the library, an album, or the type of the document open. */
  view: 'library' | 'album' | Exclude<DocumentType, 'take' | 'sound'>;
  /** The album open, by key, or the one a project was opened from, which going up comes back to. */
  place?: string;
  /** The open project's path. */
  motion?: string;
  /** The open document's path, for a view below the project. */
  path?: string;
  /** The stage Compose last showed in the open project, to come back to. */
  stage?: string;
  /** What Direct shows of the open project, by the key of its row; the overview when unset. */
  item?: string;
};

/** What Direct shows for a document of a project, rather than a view of its own. */
const DIRECT_TYPES = new Set(['still', 'take', 'chat', 'memo', 'persona', 'md']);

/** What a Motions window can be opened with: a document to show, by path. */
export type MotionsData = { path?: string; motion?: string } | undefined;

/**
 * The view a document's path opens in, by its extension.
 *
 * @param path - The document's path.
 * @returns Its view, or the library when Motions has none for it.
 */
export function viewOf(path: string): MotionsRoute['view'] {
  const extension = path.split('.').pop();
  return extension === 'motion' || extension === 'stage' || extension === 'still' || extension === 'chat' || extension === 'memo'
    ? extension
    : 'library';
}

/**
 * Opens a document in a route: a project in Compose, on the stage it last showed or its first —
 * in Direct while it has no stage yet — a stage in Compose, and anything else of a project in
 * Direct, picked in its list.
 *
 * @param route - The window's route.
 * @param path - The document's path.
 * @param motion - The project it belongs to, when it isn't a project itself.
 */
export function openIn(route: MotionsRoute, path: string, motion = route.motion): void {
  const view = viewOf(path);
  if (view === 'motion') {
    const same = route.motion === path;
    const document = documentAt<'motion'>(path);
    const stage = (same ? route.stage : undefined) ?? (document && stagesOf({ path, document })[0]?.path);
    const item = same ? route.item : undefined;
    Object.assign(route, stage ? { view: 'stage', motion: path, path: stage, stage, item } : { view, motion: path, path: undefined, stage: undefined, item });
  } else if (motion && DIRECT_TYPES.has(path.split('.').pop() ?? '')) {
    Object.assign(route, { view: 'motion', motion, path: undefined, item: path });
  } else Object.assign(route, { view, motion, path, ...(view === 'stage' ? { stage: path } : {}) });
}

/**
 * Goes up one level: from a document to its project, from the project — Direct or Compose — to the
 * album it was opened from, or the library, and from an album to the library.
 *
 * @param route - The window's route.
 */
export function goUp(route: MotionsRoute): void {
  if (route.view === 'album') Object.assign(route, { view: 'library', place: undefined });
  else if (isEditing(route) || !route.motion) {
    Object.assign(route, { view: route.place ? 'album' : 'library', motion: undefined, path: undefined, stage: undefined, item: undefined });
  }
  else Object.assign(route, { view: 'motion', path: undefined });
}

/**
 * Opens an album of the library.
 *
 * @param route - The window's route.
 * @param key - The album's key.
 */
export function openAlbum(route: MotionsRoute, key: string): void {
  Object.assign(route, { view: 'album', place: key, motion: undefined, path: undefined, stage: undefined, item: undefined });
}

/**
 * Whether a route is in a project's editor: Direct, its writing, or Compose, a stage being put together.
 *
 * @param route - The window's route.
 * @returns Whether it shows Direct or Compose.
 */
export function isEditing(route: MotionsRoute): boolean {
  return route.view === 'motion' || route.view === 'stage';
}
