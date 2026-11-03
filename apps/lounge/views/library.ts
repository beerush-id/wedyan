import { mutable } from '@airlib/react';
import type { ListOptions } from '@irpclib/r2-file';
import { FILE_TYPES } from '@/lib/documents/file-types.js';
import { ADDRESS, chosenAttempt } from '@/lib/documents/generation.js';
import { nameOf, newHeader, newId, parentOf } from '@/lib/documents/paths.js';
import type { FileRow } from '@/lib/documents/rows.js';
import type { PersonaDocument, StillDocument } from '@/lib/documents/types.js';
import { LOUNGE, LOUNGE_EVENT } from '@/lib/kernel/workspace.h.js';
import { AGENT_EXTENSION, type AgentFile } from '@/lib/share/agents.js';
import { dfs } from '@/lib/share/dfs.js';
import { addressOf, pictureOf, stillAt } from '@/lib/share/pictures.js';
import { AGENTS_PATH } from '@/lib/share/system.js';

/** Where the people and characters live. */
export const PEOPLE = '~/People';

/** The extension of a person's file. */
export const PERSONA_EXTENSION = '.persona';

/** The person or agent a link asked for, until the window opens it. */
export const opening = mutable({ path: null as string | null });

/**
 * Whether Lounge opens a file: a person or an agent.
 *
 * @param path - The file's path.
 * @returns True for a `.persona` or an `.agent`.
 */
export function opensFile(path: string): boolean {
  return path.endsWith(PERSONA_EXTENSION) || path.endsWith(AGENT_EXTENSION);
}

/** What each list asks `list` for: only the files it shows, not the folders of pictures beside them. */
export const LISTINGS: Record<'people' | 'agents', [string, ListOptions]> = {
  people: [PEOPLE, { filter: { type: FILE_TYPES.persona } }],
  agents: [AGENTS_PATH, { filter: { type: FILE_TYPES.agent } }],
};

/** What a persona is: a real person, a character, or a mascot. */
export type PersonaKind = PersonaDocument['kind'];

/** Each kind a persona can be, with its name. */
export const KINDS: Record<PersonaKind, string> = {
  person: 'Person',
  character: 'Character',
  mascot: 'Mascot',
};

/** The apps' skills an agent can be given, by the name the kernel resolves them with. */
export const SKILLS: Record<string, { label: string; hint: string }> = {
  motions: { label: 'Motions', hint: 'Make and edit videos: scripts, stages, clips and sound.' },
  photos: { label: 'Photos', hint: 'Make and edit images.' },
};

/** The longest edge of a person's picture where it shows small: a portrait or a tile. */
const SMALL_PICTURE = 256;

/** The longest edge of a person's picture where it fills its tab. */
const LARGE_PICTURE = 1024;

/**
 * Listed rows in name order, as the side shows them: files are named by id, so only the rows know.
 *
 * @param rows - The rows.
 * @returns The same rows, ordered by what they're called.
 */
export function byName(rows: FileRow[]): FileRow[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Changes a persona or an agent in place and marks when it changed.
 *
 * @param document - The persona or agent.
 * @param change - What to change in it.
 */
export function edit(document: { updated: string }, change: () => void): void {
  change();
  document.updated = new Date().toISOString();
}

/**
 * Makes a new person in People, named apart from its path, with nothing filled in: no head yet.
 *
 * @returns Where it was put, once it's written.
 */
export async function newPerson(): Promise<string> {
  const path = `${PEOPLE}/${newId()}${PERSONA_EXTENSION}`;
  const person: PersonaDocument = { ...newHeader(path, PERSONA_EXTENSION), name: 'New person', type: 'persona', kind: 'person', head: { main: '' } };
  await dfs.write(path, person as never);
  return path;
}

/**
 * Makes a new agent in Agents, named apart from its path, with no skills yet: the user grants each one.
 *
 * @returns Where it was put, once it's written.
 */
export async function newAgent(): Promise<string> {
  const path = `${AGENTS_PATH}/${newId()}${AGENT_EXTENSION}`;
  const agent: AgentFile = { ...newHeader(path, AGENT_EXTENSION), name: 'New agent', type: 'agent', description: '', skills: [] };
  await dfs.write(path, agent as never);
  return path;
}

/**
 * Makes a new, empty still for one of a persona's pictures, in the folder named after them beside
 * their file, to be made from the prompt beside it.
 *
 * @param personaPath - Where the persona is.
 * @param name - What the still is called, e.g. `Face`.
 * @param aspect - The shape it's made in, e.g. `1:1`.
 * @param face - Whether it's their face, which its pictures are described as.
 * @returns The still as the persona writes it, by path from the persona, once it's written.
 */
export async function newStill(personaPath: string, name: string, aspect: string, face = false): Promise<string> {
  const folder = nameOf(personaPath).slice(0, -PERSONA_EXTENSION.length);
  const path = `${parentOf(personaPath)}/${folder}/${newId()}.still`;
  const still: StillDocument = {
    ...newHeader(path, '.still'),
    name,
    type: 'still',
    prompt: '',
    settings: { aspect, batch: 1 },
    references: [],
    attempts: [],
    edits: [],
    chosen: '',
    ...(face ? { describedAs: 'face' as const } : {}),
  };
  await dfs.write(path, still as never);
  return `${folder}/${nameOf(path)}`;
}

/**
 * Tells every other window what a person or an agent is now called. A list shows the name its
 * listing gave it, and a file saving itself tells nobody.
 *
 * @param path - Where it is.
 * @param title - What it's called now.
 */
export function announceName(path: string, title: string): void {
  LOUNGE.ask({ type: LOUNGE_EVENT.RENAMED, data: { path, title } });
}

/**
 * Tells every window what a person now looks like. The list shows the portrait its listing gave it,
 * and a file saving itself tells nobody.
 *
 * @param path - Where the person is.
 * @param persona - The person.
 */
export function announcePortrait(path: string, persona: PersonaDocument): void {
  const main = persona.head?.main;
  const still = main ? stillAt(path, main) : undefined;
  const thumbnail = main && ADDRESS.test(main) ? main : still && chosenAttempt(still.document)?.src;
  const message = { type: LOUNGE_EVENT.PORTRAIT, data: { path, thumbnail } };
  LOUNGE.ask(message);
  LOUNGE.broadcast(message);
}

/**
 * Takes a person or an agent off the drive, telling every other window; a person's pictures stay
 * in their folder.
 *
 * @param path - Where it is.
 * @returns When it's gone.
 */
export async function removeFile(path: string): Promise<void> {
  LOUNGE.ask({ type: LOUNGE_EVENT.REMOVED, data: [path] });
  await dfs.remove(path);
}

/**
 * A listed person's portrait. A row carries what their still writes, from the still's folder: the
 * folder named after them, beside their file.
 *
 * @param row - The person's row.
 * @returns The picture's address, unless they have no face yet.
 */
export function rowPortrait(row: FileRow): string | undefined {
  return row.thumbnail ? addressOf(row.path, row.thumbnail, SMALL_PICTURE) : undefined;
}

/**
 * A persona's portrait: its main face, small.
 *
 * @param path - Where the persona is.
 * @param persona - The persona.
 * @returns The picture's address, unless it has no face yet or its path leads to no picture.
 */
export function portraitOf(path: string, persona: PersonaDocument): string | undefined {
  // A persona of an older shape has no head; it shows its initials until it's given one.
  const main = persona.head?.main;
  return main ? pictureOf(path, main, SMALL_PICTURE) : undefined;
}

/** A large picture, for the main one on a tab of a person's pictures. */
export const largePicture = (from: string, source: string): string | undefined => pictureOf(from, source, LARGE_PICTURE);

/** A small picture, for a tile of a person's pictures. */
export const tilePicture = (from: string, source: string): string | undefined => pictureOf(from, source, SMALL_PICTURE);

/**
 * Who made an agent and when it last changed, in a line: Wedyan's with the ask it came from.
 *
 * @param document - The agent.
 * @returns E.g. `By Wedyan, asked "A voice to tell it" · Updated …`.
 */
export function factsOf(document: AgentFile): string {
  const { author } = document;
  const by = author.kind === 'agent' ? `By Wedyan${author.ask ? `, asked “${author.ask}”` : ''}` : 'By you';
  return `${by} · Updated ${longDate(document.updated)}`;
}


/**
 * A date and time as the open item shows it, e.g. `Oct 30, 2026, 9:00 AM`.
 *
 * @param iso - The date, as an ISO string.
 * @returns Its date and time.
 */
function longDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
