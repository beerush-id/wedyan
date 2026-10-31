import { pictureAt } from '@/lib/documents/generation.js';
import { nameOf, newHeader, parentOf, resolvePath } from '@/lib/documents/paths.js';
import type { StageRow } from '@/lib/documents/stage.js';
import type {
  DocumentOf,
  DocumentType,
  MotionAsset,
  MotionDocument,
  PersonaDocument,
  StageDocument,
  StillDocument,
  TakeDocument,
} from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';

/** A project: the `.motion` and where it is. */
export type Project = { path: string; document: MotionDocument };

/** Where Motions keeps its projects. */
export const ROOT = '~/Motions';

/** A project's own file. */
export const MOTION_FILE = /\.motion$/;

/**
 * The document at a path, live.
 *
 * @param path - Its path.
 * @returns The document, once it has arrived and if it's there.
 */
export function documentAt<T extends DocumentType = DocumentType>(path?: string): DocumentOf<T> | undefined {
  return path ? (dfs.read<DocumentOf<T>>(path).data ?? undefined) : undefined;
}

/**
 * The document a path written in another document leads to.
 *
 * @param from - The path of the document it is written in.
 * @param path - The path as written.
 * @returns Where it leads, and the document there, once it has arrived.
 */
export function follow<T extends DocumentType = DocumentType>(from: string, path: string): { path: string; document: DocumentOf<T> | undefined } {
  const resolved = resolvePath(from, path);
  return { path: resolved, document: documentAt<T>(resolved) };
}

/**
 * A free path for something new in a folder: `<base><extension>`, or the first `<base> N<extension>`
 * not taken.
 *
 * @param taken - The paths taken.
 * @param folder - The folder it goes in.
 * @param base - Its name before a number.
 * @param extension - Its extension, if it's a file.
 * @returns The path.
 */
export function freePath(taken: Set<string>, folder: string, base: string, extension = ''): string {
  let path = `${folder}/${base}${extension}`;
  for (let n = 2; taken.has(path); n++) path = `${folder}/${base} ${n}${extension}`;
  return path;
}

/**
 * Takes projects off the drive: each `.motion` with the folder holding it, which is the project.
 *
 * @param paths - What's picked: projects by their `.motion`, or folders.
 * @returns When they're gone.
 */
export const removeEntries = (paths: string[]): Promise<unknown> =>
  Promise.all(paths.map((path) => dfs.remove(MOTION_FILE.test(path) ? parentOf(path) : path, { recursive: true })));

/**
 * A project's casts.
 *
 * @param project - The project.
 * @returns Each persona it names that is on the drive, with where it is.
 */
export const castsOf = (project: Project): { path: string; document: PersonaDocument }[] =>
  (project.document.casts ?? [])
    .map((cast) => follow<'persona'>(project.path, cast))
    .filter((cast): cast is { path: string; document: PersonaDocument } => !!cast.document);

/**
 * A cast's picture. People are still kept on Lounge's drive, by the same path without `~`.
 *
 * @param path - The persona's home path.
 * @returns Its picture's address, if it has one.
 */
export const castPicture = (path: string): string | undefined => pictureAt(path.slice(1), path.slice(1));

/** A stage's size at each aspect ratio a motion is made at. */
const STAGE_SIZES: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

/**
 * Starts a new project in its own folder, with one empty stage at its aspect ratio.
 *
 * @param name - What it's called, which its folder and file take too.
 * @param aspect - Its aspect ratio, e.g. `16:9`.
 * @param cover - Its cover's address.
 * @returns The new project, once it's written.
 */
export const newMotion = async (name: string, aspect: string, cover: string): Promise<Project> => {
  let folder = `${ROOT}/${name}`;
  for (let n = 2; await dfs.exists(folder); n++) folder = `${ROOT}/${name} ${n}`;
  const path = `${folder}/${nameOf(folder)}.motion`;
  const document: MotionDocument = {
    ...newHeader(path, '.motion'),
    type: 'motion',
    aspect,
    cover,
    status: 'draft',
    assets: [],
  };
  await dfs.write(`${folder}/Stage.stage`, stageAt(`${folder}/Stage.stage`, document, 0) as never);
  await dfs.write(path, document as never);
  return { path, document };
};

/**
 * Adds an empty stage at the end of a project, in its folder, at the project's aspect ratio, with
 * every cast the project has.
 *
 * @param project - The project.
 * @param stages - The stages it has.
 * @returns The new stage's path.
 */
export const newStage = (project: Project, stages: StageRow[]): string => {
  const path = freePath(new Set(stages.map((stage) => stage.path)), parentOf(project.path), 'Stage', '.stage');
  const last = Math.max(-1, ...stages.map((stage) => stage.order));
  void dfs.write(path, stageAt(path, project.document, last + 1) as never);
  return path;
};

/**
 * Gives a stage a script of its own, a Markdown file beside its project's, headed by the stage's name.
 *
 * @param project - The project's path.
 * @param stage - The stage.
 * @returns When it's written.
 */
export const newScript = async (project: string, stage: StageDocument): Promise<void> => {
  const folder = parentOf(project);
  let path = `${folder}/${stage.name}.md`;
  for (let n = 2; await dfs.exists(path); n++) path = `${folder}/${stage.name} ${n}.md`;
  await dfs.write(path, `## ${stage.name}\n`);
  stage.script = nameOf(path);
};

/**
 * A new empty stage of a project: its size, its casts, at 30 frames a second.
 *
 * @param path - Where it goes.
 * @param project - The project's `.motion`.
 * @param order - Its place in the project.
 * @returns The stage.
 */
function stageAt(path: string, project: MotionDocument, order: number): StageDocument {
  return {
    ...newHeader(path, '.stage'),
    type: 'stage',
    projectId: project.id,
    order,
    casts: [...(project.casts ?? [])],
    composition: { id: crypto.randomUUID(), options: { frameRate: 30 }, props: STAGE_SIZES[project.aspect] ?? STAGE_SIZES['16:9'], tracks: [] },
  };
}

/**
 * Puts a persona in a project.
 *
 * @param project - The project.
 * @param persona - The persona's path.
 */
export const addCast = (project: Project, persona: string): void => {
  (project.document.casts ??= []).push(persona);
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
    const still = follow<'still'>(from, asset.src).document as StillDocument | undefined;
    return still?.attempts.find((attempt) => attempt.id === still.chosen)?.src;
  }
  if (asset.kind === 'take') {
    const take = follow<'take'>(from, asset.src).document as TakeDocument | undefined;
    return take?.attempts.find((attempt) => attempt.id === take.chosen)?.poster;
  }
};

/**
 * How long a project runs as made so far: its stages one after another.
 *
 * @param stages - Its stages.
 * @returns Its length, in seconds.
 */
export const length = (stages: StageRow[]): number => stages.reduce((total, stage) => total + stage.duration, 0);

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
