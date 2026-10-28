import { documentsOf, follow, resolvePath } from '@/lib/documents/store.js';
import type { MotionDocument, PersonaDocument, StageDocument } from '@/lib/documents/types.js';
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

/** A set of projects kept together: an `.album`, or one gathered by what its projects share. */
export type Album = {
  /** How a route names it: an `.album`'s path, or a gathered album's own key. */
  key: string;
  name: string;
  description: string;
  /** Its picture: the album's own, or its newest project's cover. */
  cover?: string;
  /** Its projects, newest first. */
  projects: () => Project[];
};

/**
 * The albums, as the library shows them: each `.album`, by name, then what Wedyan made, then the
 * projects in no album. The last two show only while they hold something.
 *
 * @returns Each album.
 */
export const albums = (): Album[] => {
  const kept = documentsOf('album')
    .sort((a, b) => a.document.name.localeCompare(b.document.name))
    .map(({ path, document }) => {
      const inside = () => projects().filter((project) => project.document.album && resolvePath(project.path, project.document.album) === path);
      return { key: path, name: document.name, description: document.description ?? '', cover: document.cover ?? inside()[0]?.document.cover, projects: inside };
    });
  const gathered = [
    gather('made-by-wedyan', 'Made by Wedyan', 'Everything Wedyan made from what you asked.', (project) => project.document.author.kind === 'agent'),
    gather('unsorted', 'Unsorted', 'Projects not kept in an album yet.', (project) => !project.document.album),
  ].filter((album) => album.projects().length > 0);
  return [...kept, ...gathered];
};

/**
 * One album, by its key.
 *
 * @param key - How a route names it.
 * @returns The album, if there is one by that key.
 */
export const albumOf = (key?: string): Album | undefined => albums().find((album) => album.key === key);

/**
 * An album gathered by what its projects share, rather than kept as a file.
 *
 * @param key - How a route names it.
 * @param name - Its name.
 * @param description - What it gathers, in a line.
 * @param holds - Whether a project belongs in it.
 * @returns The album.
 */
function gather(key: string, name: string, description: string, holds: (project: Project) => boolean): Album {
  const inside = () => projects().filter(holds);
  return { key, name, description, cover: inside()[0]?.document.cover, projects: inside };
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
