import {
  documentAt,
  documentsOf,
  follow,
  freePath,
  nameOf,
  newHeader,
  parentOf,
  resolvePath,
  supply,
} from '@/lib/documents/store.js';
import type {
  MotionAsset,
  MotionDocument,
  PersonaDocument,
  StageDocument,
  StillDocument,
  TakeDocument,
} from '@/lib/documents/types.js';
import ALBUM_TAGS from '../data/albums.json';
import { runtime } from './composition.js';

/** A project as Motions lists it: the `.motion` and where it is. */
export type Project = { path: string; document: MotionDocument };

/**
 * The projects kept, newest first.
 *
 * @returns Every `.motion` still on the drive.
 */
export const projects = (): Project[] =>
  documentsOf('motion').sort((a, b) => b.document.updated.localeCompare(a.document.updated));

/** Where Motions browses from: the Motions folder at the drive's root. */
export const ROOT = '/Motions';

/** The tag of what's kept as a favorite. */
export const FAVORITE = 'favorite';

/** The tag of what Wedyan made. */
export const GENERATIVE = 'generative';

/** How many of the newest projects Recents lists. */
const RECENT_COUNT = 8;

/** The albums: each a tag that the projects in it carry, and its name. */
export const ALBUMS: { tag: string; label: string }[] = ALBUM_TAGS;

/** What a listing is asked for: one folder's contents, every project carrying a tag, or the newest projects. */
export type ListingRequest = { folder: string } | { tag: string } | { recent: true };

/** One thing a listing holds: a folder, with how much it holds; or a project, its folder shown as the project. */
export type Entry = { kind: 'folder'; path: string; name: string; count: number } | { kind: 'motion'; path: string; name: string; project: Project };

/**
 * Lists Motions as asked: a folder's contents, every project carrying a tag, or the newest projects.
 * A mock of the drive's listing request, answered from the projects at hand.
 *
 * @param request - A folder, a tag, or the newest.
 * @returns What the folder holds, the projects with the tag, or the newest projects.
 */
export function listing(request: ListingRequest): Entry[] {
  if ('recent' in request) return projects().slice(0, RECENT_COUNT).map(entryOf);
  if ('tag' in request) return byName(projects().filter((project) => project.document.tags?.includes(request.tag)).map(entryOf));
  return folderOf(request.folder);
}

/**
 * What a folder holds: its folders, then its projects, each in name order. A project's folder — the
 * one holding its `.motion` — lists as the project; other folders show how many projects they hold.
 *
 * @param folder - The folder's path, e.g. `/Motions`.
 * @returns What it holds.
 */
function folderOf(folder: string): Entry[] {
  const folders = new Map<string, number>();
  const entries: Entry[] = [];
  for (const project of projects()) {
    const home = parentOf(project.path);
    if (parentOf(home) === folder) entries.push(entryOf(project));
    else if (home.startsWith(`${folder}/`)) {
      const child = `${folder}/${home.slice(folder.length + 1).split('/')[0]}`;
      folders.set(child, (folders.get(child) ?? 0) + 1);
    }
  }
  const subfolders: Entry[] = [...folders].map(([path, count]) => ({ kind: 'folder', path, name: nameOf(path), count }));
  return [...byName(subfolders), ...byName(entries)];
}

/**
 * A project as a listing holds it, by its `.motion`'s path.
 *
 * @param project - The project.
 * @returns Its entry.
 */
function entryOf(project: Project): Entry {
  return { kind: 'motion', path: project.path, name: project.document.name, project };
}

/**
 * Entries in name order.
 *
 * @param entries - The entries.
 * @returns The same entries, ordered by name.
 */
function byName(entries: Entry[]): Entry[] {
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A project's stages, in playing order, with where each is.
 *
 * @param project - The project.
 * @returns Each stage it lists that is on the drive.
 */
export const stagesOf = (project: Project): { path: string; document: StageDocument }[] =>
  project.document.stages
    .map((stage) => follow<'stage'>(project.path, stage))
    .filter((entry): entry is { path: string; document: StageDocument } => !!entry.document);

/**
 * A project's casts: every persona its stages list, each once, in the order they first appear.
 * They aren't kept in the project; they come from its stages.
 *
 * @param project - The project.
 * @returns Each persona its stages name that is on the drive, with where it is.
 */
export const castsOf = (project: Project): { path: string; document: PersonaDocument }[] => {
  const casts = new Map<string, PersonaDocument>();
  for (const stage of stagesOf(project)) {
    for (const cast of stage.document.casts ?? []) {
      const { path, document } = follow<'persona'>(stage.path, cast);
      if (document && !casts.has(path)) casts.set(path, document);
    }
  }
  return [...casts].map(([path, document]) => ({ path, document }));
};

/**
 * Adds an empty stage at the end of a project, in its folder, the size and pace of its first stage
 * — full HD at 30 frames a second while it has none — with every cast the project has.
 *
 * @param project - The project.
 * @returns The new stage's path.
 */
export const newStage = (project: Project): string => {
  const path = freePath(parentOf(project.path), 'Stage', '.stage');
  const first = stagesOf(project)[0]?.document.composition;
  const stage: StageDocument = {
    ...newHeader(path, '.stage'),
    type: 'stage',
    casts: castsOf(project).map((cast) => cast.path),
    composition: {
      id: crypto.randomUUID(),
      options: { frameRate: first?.options.frameRate ?? 30 },
      props: { ...(first?.props ?? { width: 1920, height: 1080 }) },
      tracks: [],
    },
  };
  supply([[path, stage]]);
  project.document.stages.push(nameOf(path));
  project.document.updated = new Date().toISOString();
  return path;
};

/**
 * Puts a persona in a project: every stage names them, each one that doesn't already.
 *
 * @param project - The project.
 * @param persona - The persona's path.
 */
export const addCast = (project: Project, persona: string): void => {
  for (const { path, document } of stagesOf(project)) {
    const casts = (document.casts ??= []);
    if (!casts.some((cast) => resolvePath(path, cast) === persona)) casts.push(persona);
  }
  project.document.updated = new Date().toISOString();
};

/**
 * An asset's picture: an image itself, or a generated one's chosen attempt; none for sound.
 *
 * @param from - The project's path, which the asset's own path is written from.
 * @param asset - The asset.
 * @returns Its picture's address, if it has one.
 */
export const pictureOf = (from: string, asset: MotionAsset): string | undefined => {
  if (asset.kind === 'image') return asset.src;
  if (asset.kind === 'still') {
    const still = documentAt<'still'>(follow(from, asset.src).path) as StillDocument | undefined;
    return still?.attempts.find((attempt) => attempt.id === still.chosen)?.src;
  }
  if (asset.kind === 'take') {
    const take = documentAt<'take'>(follow(from, asset.src).path) as TakeDocument | undefined;
    return take?.attempts.find((attempt) => attempt.id === take.chosen)?.poster;
  }
};

/**
 * How long a project runs as made so far: its stages one after another.
 *
 * @param project - The project.
 * @returns Its length, in seconds.
 */
export const length = (project: Project): number =>
  stagesOf(project).reduce((total, stage) => total + runtime(stage.document.composition), 0);

/**
 * A length as tiles show it, e.g. `0:13`.
 *
 * @param seconds - The length.
 * @returns Minutes and seconds.
 */
export const duration = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/**
 * A date as lists show it, e.g. `Oct 27`.
 *
 * @param iso - The date, as an ISO string.
 * @returns Its month and day.
 */
export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * A stage's poster: the picture of its first clip that has one.
 *
 * @param stage - The stage.
 * @returns The picture's address, if any clip has one.
 */
export const posterOf = (stage: StageDocument): string | undefined => {
  for (const track of stage.composition.tracks) {
    for (const segment of track.segments) {
      const thumbnail = segment.options.meta?.thumbnail;
      if (typeof thumbnail === 'string') return thumbnail;
    }
  }
};
