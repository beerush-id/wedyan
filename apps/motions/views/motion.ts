import { mutable } from '@airlib/react';
import { nameOf, newHeader, newId, parentOf } from '@/lib/documents/paths.js';
import type { FileRow } from '@/lib/documents/rows.js';
import { stageAt } from '@/lib/documents/stage.js';
import type { MotionDocument, PersonaDocument, StageDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { LOUNGE, LOUNGE_EVENT } from '../../../lib/kernel/workspace.h.js';

export { documentAt, follow } from '@/lib/share/documents.js';

/** How Motions animates a new motion: set from the dock, read when a prompt is sent. */
export const animation = mutable({ model: 'standard', aspect: '16:9', seconds: 6 });

/** Where a new motion goes: set by the library as it moves, read by whatever makes one. */
export const destination = mutable({ folder: '~/Motions' });

/** A project: the `.motion` and where it is. */
export type Project = { path: string; document: MotionDocument };

/** Where Motions keeps its projects. */
export const ROOT = '~/Motions';

/** A project's own file. */
export const MOTION_FILE = /\.motion$/;

/** Where people are kept. */
const PEOPLE = '~/People';

/**
 * Makes a new person on the drive, named apart from its path.
 *
 * @returns Its path.
 */
export const newPerson = async (): Promise<string> => {
  const path = `${PEOPLE}/${newId()}.persona`;
  const person: PersonaDocument = { ...newHeader(path, '.persona'), name: 'New person', type: 'persona', kind: 'person', head: { main: '' } };
  await dfs.write(path, person as never);
  return path;
};

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

/**
 * Starts a new project in its own folder, with one empty stage at its aspect ratio. Its folder and
 * file are named by its id; what it's called is its document's, and can change.
 *
 * @param name - What it's called.
 * @param aspect - Its aspect ratio, e.g. `16:9`.
 * @param cover - Its cover's address.
 * @param parent - The folder its own folder goes in.
 * @returns The new project, once it's written.
 */
export const newMotion = async (name: string, aspect: string, cover: string, parent = ROOT): Promise<Project> => {
  const id = newId();
  const folder = `${parent}/${id}`;
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
 * Gives a stage a script of its own.
 *
 * @param project - The project's path.
 * @param stage - The stage.
 * @returns When it's written.
 */
export const newScript = async (project: string, stage: StageDocument): Promise<void> => {
  stage.script = await writeScript(project, stage.name);
};

/**
 * Gives a project its script.
 *
 * @param project - The project's path.
 * @param motion - The project's `.motion`.
 * @returns When it's written.
 */
export const newMotionScript = async (project: string, motion: MotionDocument): Promise<void> => {
  motion.script = { path: await writeScript(project, motion.name) };
};

/** Writes a script, a Markdown file in its project's folder headed by what it's for, and names it. */
async function writeScript(project: string, name: string): Promise<string> {
  const path = `${parentOf(project)}/${newId()}.md`;
  await dfs.write(path, `## ${name}\n`, { metadata: { title: `${name} script` } });
  return nameOf(path);
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
