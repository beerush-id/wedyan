import { mutable } from '@airlib/react';
import { nameOf, newHeader, newId, parentOf, resolvePath } from '@/lib/documents/paths.js';
import type { FileRow } from '@/lib/documents/rows.js';
import type { DocumentOf, DocumentType, MotionDocument, StageDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { LOUNGE, LOUNGE_EVENT } from '../../../lib/kernel/workspace.h.js';

/** How Motions animates a new motion: set from the dock, read when a prompt is sent. */
export const animation = mutable({ model: 'standard', aspect: '16:9', seconds: 6 });

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
export function follow<T extends DocumentType = DocumentType>(
  from: string,
  path: string,
): { path: string; document: DocumentOf<T> | undefined } {
  const resolved = resolvePath(from, path);
  return { path: resolved, document: documentAt<T>(resolved) };
}

/**
 * Makes a folder in the library, named apart from its path.
 *
 * @param parent - The folder it goes in.
 * @param title - What it's called.
 * @returns Its row, which is a fact already: the folder is made behind it, and others are told.
 */
export const newFolder = (parent: string, title: string): FileRow => {
  const path = `${parent}/${newId()}`;
  const row = {
    path,
    name: title,
    size: 0,
    type: 'inode/directory',
    mtime: new Date(),
    isDirectory: true,
    public: false,
    hidden: false,
    metadata: { title },
    kind: 'folder',
    duration: 0,
    position: 0,
  } as FileRow;
  LOUNGE.ask({ type: LOUNGE_EVENT.CREATED, data: row });
  void dfs.mkdir(path, { metadata: { title } });
  return row;
};

/**
 * Saves a row's new name. A project's name is its document's, so it's saved there; a folder's is
 * all it has, and only its row changes. Neither moves.
 *
 * @param row - What's renamed, already holding its new name.
 * @returns When it's saved.
 */
export const rename = async (row: FileRow): Promise<void> => {
  const title = row.name;
  LOUNGE.ask({ type: LOUNGE_EVENT.RENAMED, data: { path: row.path, title } });

  if (row.kind !== 'motion') {
    await dfs.update(row.path, { metadata: { title } });
    return;
  }
  const document = await dfs.load<MotionDocument>(row.path);
  if (document) await dfs.write(row.path, { ...document, name: title, updated: new Date().toISOString() } as never);
};

/**
 * Takes projects off the drive: each `.motion` with the folder holding it, which is the project.
 *
 * @param paths - What's picked: projects by their `.motion`, or folders.
 * @returns When they're gone.
 */
export const removeEntries = (paths: string[]): Promise<unknown> => {
  LOUNGE.ask({ type: LOUNGE_EVENT.REMOVED, data: paths });
  return Promise.all(paths.map((path) => dfs.remove(MOTION_FILE.test(path) ? parentOf(path) : path, { recursive: true })));
};

/** A stage's size at each aspect ratio a motion is made at. */
const STAGE_SIZES: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

/**
 * Starts a new project in its own folder, with one empty stage at its aspect ratio. Its folder and
 * file are named by its id; what it's called is its document's, and can change.
 *
 * @param name - What it's called.
 * @param aspect - Its aspect ratio, e.g. `16:9`.
 * @param cover - Its cover's address.
 * @returns The new project, once it's written.
 */
export const newMotion = async (name: string, aspect: string, cover: string): Promise<Project> => {
  const id = newId();
  const folder = `${ROOT}/${id}`;
  const path = `${folder}/${id}.motion`;
  const document: MotionDocument = {
    ...newHeader(path, '.motion'),
    id,
    name,
    type: 'motion',
    aspect,
    cover,
    status: 'draft',
    assets: [],
  };
  const stage = newId();
  await dfs.write(`${folder}/${stage}.stage`, stageAt(stage, folder, 'Stage 1', document, 0) as never);
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
export const newStage = (project: Project, stages: FileRow[]): string => {
  const id = newId();
  const folder = parentOf(project.path);
  const last = Math.max(-1, ...stages.map((stage) => stage.position));
  const path = `${folder}/${id}.stage`;
  void dfs.write(path, stageAt(id, folder, `Stage ${stages.length + 1}`, project.document, last + 1) as never);
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
  const path = `${parentOf(project)}/${newId()}.md`;
  await dfs.write(path, `## ${stage.name}\n`, { metadata: { title: `${stage.name} script` } });
  stage.script = nameOf(path);
};

/**
 * A new empty stage of a project: its size, its casts, at 30 frames a second.
 *
 * @param id - Its id, which names its file.
 * @param folder - The folder it goes in.
 * @param name - What it's called.
 * @param project - The project's `.motion`.
 * @param order - Its place in the project.
 * @returns The stage.
 */
function stageAt(id: string, folder: string, name: string, project: MotionDocument, order: number): StageDocument {
  return {
    ...newHeader(`${folder}/${id}.stage`, '.stage'),
    id,
    name,
    type: 'stage',
    projectId: project.id,
    order,
    casts: [...(project.casts ?? [])],
    composition: {
      id: crypto.randomUUID(),
      options: { frameRate: 30 },
      props: STAGE_SIZES[project.aspect] ?? STAGE_SIZES['16:9'],
      tracks: [],
    },
  };
}

/**
 * Puts a persona in a project.
 *
 * @param project - The project.
 * @param persona - The persona's path.
 */
export const addCast = (project: Project, persona: string): void => {
  project.document.casts = [...(project.document.casts ?? []), persona];
  project.document.updated = new Date().toISOString();
};

/**
 * How long a project runs as made so far: its stages one after another.
 *
 * @param stages - Its stages.
 * @returns Its length, in seconds.
 */
export const length = (stages: FileRow[]): number => stages.reduce((total, stage) => total + stage.duration, 0);

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
