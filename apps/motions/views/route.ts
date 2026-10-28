import { documentAt } from '@/lib/documents/store.js';
import type { DocumentType } from '@/lib/documents/types.js';
import { stagesOf } from './library.js';

/**
 * Where a Motions window is: its library, a project open, or one of the project's documents open
 * in its own view. Each window keeps its own, so two windows can show two projects.
 */
export type MotionsRoute = {
  /** Which view shows: the library, or the type of the document open. */
  view: 'library' | Exclude<DocumentType, 'take'>;
  /** The library's collection while it shows. */
  place: string;
  /** The open project's path. */
  motion?: string;
  /** The open document's path, for a view below the project. */
  path?: string;
  /** The stage Compose last showed in the open project, to come back to. */
  stage?: string;
};

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
 * in Direct while it has no stage yet — and anything else under the project it belongs to.
 *
 * @param route - The window's route.
 * @param path - The document's path.
 * @param motion - The project it belongs to, when it isn't a project itself.
 */
export function openIn(route: MotionsRoute, path: string, motion = route.motion): void {
  const view = viewOf(path);
  if (view === 'motion') {
    const document = documentAt<'motion'>(path);
    const stage = (route.motion === path ? route.stage : undefined) ?? (document && stagesOf({ path, document })[0]?.path);
    Object.assign(route, stage ? { view: 'stage', motion: path, path: stage, stage } : { view, motion: path, path: undefined, stage: undefined });
  } else Object.assign(route, { view, motion, path, ...(view === 'stage' ? { stage: path } : {}) });
}

/**
 * Goes up one level: from a document to its project, from the project — Direct or Compose — to the library.
 *
 * @param route - The window's route.
 */
export function goUp(route: MotionsRoute): void {
  if (isEditing(route) || !route.motion) Object.assign(route, { view: 'library', motion: undefined, path: undefined, stage: undefined });
  else Object.assign(route, { view: 'motion', path: undefined });
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
