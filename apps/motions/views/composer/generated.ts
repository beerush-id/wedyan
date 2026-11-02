import { snapshot } from '@airlib/react';
import { nameOf, newHeader, newId, parentOf } from '@/lib/documents/paths.js';
import type { FileRow } from '@/lib/documents/rows.js';
import type { SoundDocument, StillDocument, TakeDocument } from '@/lib/documents/types.js';
import { LOUNGE, LOUNGE_EVENT } from '@/lib/kernel/workspace.h.js';
import { dfs } from '@/lib/share/dfs.js';
import type { Composer } from './context.js';

/** What can be made new in a project: a generated image, video or sound. */
export type GeneratedKind = 'still' | 'take' | 'sound';

/** What each is called until it's named, and on the menus that add one. */
const GENERATED: Record<GeneratedKind, { name: string; label: string }> = {
  still: { name: 'New still', label: 'New still' },
  take: { name: 'New take', label: 'New take' },
  sound: { name: 'New sound', label: 'New sound' },
};

/** How long a new take runs, in seconds, until it's told otherwise. */
const TAKE_SECONDS = 5;

/** The menu items adding each kind, named by the kind. */
export const GENERATED_ITEMS = (Object.keys(GENERATED) as GeneratedKind[]).map((name) => ({ name, label: GENERATED[name].label }));

/**
 * Whether a menu's command makes something new.
 *
 * @param command - The command.
 * @returns Whether it names a generated kind.
 */
export const isGeneratedKind = (command: string): command is GeneratedKind => command in GENERATED;

/**
 * Makes a new generated document in the window's project, with nothing asked of it yet, for a person
 * to write its prompt in as an agent would: it's the same document, in the same place. It's held by
 * the project as an asset from the start, and at the project's shape.
 *
 * @param composer - The project's window.
 * @param kind - What to make.
 * @returns Its row in the window's list, once it's on the drive; none without a project.
 */
export async function addGenerated(composer: Composer, kind: GeneratedKind): Promise<FileRow | undefined> {
  const { project } = composer;
  if (!project) return;
  const path = `${parentOf(project.path)}/${newId()}.${kind}`;
  const { name } = GENERATED[kind];
  const document = documentOf(kind, path, name, project.document.aspect);
  composer.writing(path);
  await dfs.write(path, document as never);

  const row = composer.add({
    path,
    name,
    size: 0,
    type: '',
    mtime: new Date(),
    isDirectory: false,
    public: false,
    hidden: false,
    metadata: {},
    kind,
    duration: 0,
    position: project.document.assets.length,
    held: true,
  } as unknown as FileRow);
  project.document.assets = [...project.document.assets, nameOf(path)];
  LOUNGE.ask({ type: LOUNGE_EVENT.CREATED, data: snapshot(row) });
  return row;
}

/**
 * A new generated document, with no attempts: its first Generate makes one.
 *
 * @param kind - What it is.
 * @param path - Where it goes.
 * @param name - What it's called.
 * @param aspect - The shape it's made in.
 * @returns The document.
 */
function documentOf(kind: GeneratedKind, path: string, name: string, aspect: string): StillDocument | TakeDocument | SoundDocument {
  const header = { ...newHeader(path, `.${kind}`), name, prompt: '', references: [], attempts: [], chosen: '' };
  if (kind === 'still') return { ...header, type: 'still', settings: { aspect, batch: 1 }, edits: [] };
  if (kind === 'take') return { ...header, type: 'take', settings: { mode: 'image', aspect, seconds: TAKE_SECONDS } };
  return { ...header, type: 'sound', kind: 'speech', text: '' };
}
