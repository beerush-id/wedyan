import { mutable } from '@airlib/react';
import { chosenAttempt } from '@/lib/documents/generation.js';
import { documentAt, documentsOf, drive, follow, nameOf, parentOf, supply } from '@/lib/documents/store.js';
import type { DocumentHeader, DocumentType, PersonaDocument, StillDocument, WedyanDocument } from '@/lib/documents/types.js';
import type { AgentFile } from '@/lib/share/agents.js';
import AGENTS_SAMPLE from '../data/agents.json';
import PEOPLE_SAMPLE from '../data/people.json';
import PERSONALITY_SAMPLE from '../data/personality.json';
import SKILLS_SAMPLE from '../data/skills.json';
import TOOLS_SAMPLE from '../data/tools.json';

// A person made from generated pictures, with the stills they're made from, until the drive serves the user's own.
supply(Object.entries(PEOPLE_SAMPLE) as unknown as [string, WedyanDocument][]);

// The format doesn't list `.agent` among the drive's documents yet, so agents go on and come off
// the drive under the shape the contract gives them.
supply(Object.entries(AGENTS_SAMPLE) as unknown as [string, WedyanDocument][]);

// Nor `.skill`: the user's own skills go on the drive under the shape Lounge mocks for them.
supply(Object.entries(SKILLS_SAMPLE) as unknown as [string, WedyanDocument][]);

/** Where the people and characters live: the People folder at the drive's root. */
export const PEOPLE = '/People';

/** Where the user's own agents live: the Agents folder at the drive's root. */
export const AGENTS = '/Agents';

/** Where the user's own skills live: the Skills folder at the drive's root. */
export const SKILLS_FOLDER = '/Skills';

/**
 * One of the user's own skills — a teacher, a scientist — as a `.skill` file: what it's for in a
 * line, its instructions in Markdown, and exactly the tools and actions it may call. Mocked here
 * until the format names it.
 */
export type SkillFile = Omit<DocumentHeader, 'type' | 'description'> & {
  type: 'skill';
  /** What it's for, in a line: what the assistant reads to decide when to use it. */
  description: string;
  /** How to work as it, in Markdown. */
  instructions: string;
  /** The server tools it may call, by name. */
  tools: string[];
  /** The desktop actions it may take, by name. */
  actions: string[];
};

/** Something a skill can be allowed to call: a server tool or a desktop action, by its name, with what it does. */
export type Callable = { name: string; hint: string };

/** Everything a skill can be allowed to call: the contract's desktop actions and the server tools it names. */
export const CALLABLES: { tools: Callable[]; actions: Callable[] } = TOOLS_SAMPLE;

/** What a persona is: a real person, a character, or a mascot. */
export type PersonaKind = PersonaDocument['kind'];

/** Each kind a persona can be, with its name. */
export const KINDS: Record<PersonaKind, string> = {
  person: 'Person',
  character: 'Character',
  mascot: 'Mascot',
};

/** The apps' skills an agent can be given, with their names and what they let it do; the user's own come on top. */
export const SKILLS: Record<string, { label: string; hint: string }> = {
  motions: { label: 'Motions', hint: 'Make and edit videos: scripts, stages, clips and sound.' },
  photos: { label: 'Photos', hint: 'Make and edit images.' },
};

/**
 * People or agents in name order, as the side lists them.
 *
 * @param listed - Each one and where it is.
 * @returns The same, ordered by name.
 */
export function byName<T extends { document: { name: string } }>(listed: T[]): T[] {
  return listed.sort((a, b) => a.document.name.localeCompare(b.document.name));
}

/**
 * Every persona kept in People.
 *
 * @returns Each `.persona` under the People folder still on the drive.
 */
export const people = (): { path: string; document: PersonaDocument }[] =>
  documentsOf('persona').filter(({ path }) => path.startsWith(`${PEOPLE}/`));

/**
 * Every agent kept in Agents.
 *
 * @returns Each `.agent` under the Agents folder still on the drive.
 */
export const agents = (): { path: string; document: AgentFile }[] =>
  (documentsOf('agent' as DocumentType) as unknown as { path: string; document: AgentFile }[]).filter(({ path }) =>
    path.startsWith(`${AGENTS}/`)
  );

/**
 * Every skill kept in Skills.
 *
 * @returns Each `.skill` under the Skills folder still on the drive.
 */
export const skills = (): { path: string; document: SkillFile }[] =>
  (documentsOf('skill' as DocumentType) as unknown as { path: string; document: SkillFile }[]).filter(({ path }) =>
    path.startsWith(`${SKILLS_FOLDER}/`)
  );

/**
 * The skill at a path.
 *
 * @param path - Its path.
 * @returns Its document, unless there's no skill there.
 */
export function skillAt(path: string): SkillFile | undefined {
  const document = documentAt(path) as unknown as SkillFile | undefined;
  return document?.type === 'skill' ? document : undefined;
}

/**
 * The persona at a path.
 *
 * @param path - Its path.
 * @returns Its document, unless there's no persona there.
 */
export function personaAt(path: string): PersonaDocument | undefined {
  const document = documentAt(path);
  return document?.type === 'persona' ? document : undefined;
}

/**
 * The agent at a path.
 *
 * @param path - Its path.
 * @returns Its document, unless there's no agent there.
 */
export function agentAt(path: string): AgentFile | undefined {
  const document = documentAt(path) as unknown as AgentFile | undefined;
  return document?.type === 'agent' ? document : undefined;
}

/**
 * Changes a persona, an agent or a skill in place and marks when it changed.
 *
 * @param document - The persona, agent or skill.
 * @param change - What to change in it.
 */
export function edit(document: { updated: string }, change: () => void): void {
  change();
  document.updated = new Date().toISOString();
}

/**
 * Makes a new person in People, with nothing filled in but their name: no head yet.
 *
 * @returns Where it was put.
 */
export function newPerson(): string {
  const path = freePath(PEOPLE, 'New person', '.persona');
  const persona: PersonaDocument = { ...headerOf(path, '.persona'), type: 'persona', kind: 'person', head: { main: '' } };
  supply([[path, persona]]);
  return path;
}

/**
 * Makes a new agent in Agents, with no skills yet: the user grants each one.
 *
 * @returns Where it was put.
 */
export function newAgent(): string {
  const path = freePath(AGENTS, 'New agent', '.agent');
  const agent: AgentFile = { ...headerOf(path, '.agent'), type: 'agent', description: '', skills: [] };
  supply([[path, agent as unknown as WedyanDocument]]);
  return path;
}

/**
 * Makes a new skill in Skills, with no instructions and nothing it may call yet: the user grants each one.
 *
 * @returns Where it was put.
 */
export function newSkill(): string {
  const path = freePath(SKILLS_FOLDER, 'New skill', '.skill');
  const skill: SkillFile = { ...headerOf(path, '.skill'), type: 'skill', description: '', instructions: '', tools: [], actions: [] };
  supply([[path, skill as unknown as WedyanDocument]]);
  return path;
}

/**
 * Makes a new, empty still for one of a persona's pictures, in the folder named after them beside
 * their file, to be made from the prompt beside it.
 *
 * @param personaPath - Where the persona is.
 * @param base - What the still is called, e.g. `Face`.
 * @param aspect - The shape it's made in, e.g. `1:1`.
 * @returns The still as the persona writes it: its path from the persona.
 */
export function newStill(personaPath: string, base: string, aspect: string): string {
  const folder = nameOf(personaPath).slice(0, -'.persona'.length);
  const path = freePath(`${parentOf(personaPath)}/${folder}`, base, '.still');
  const still: StillDocument = {
    ...headerOf(path, '.still'),
    type: 'still',
    prompt: '',
    settings: { aspect, batch: 1 },
    references: [],
    attempts: [],
    edits: [],
    chosen: '',
  };
  supply([[path, still]]);
  return `${folder}/${nameOf(path)}`;
}

/** One try at a persona's personality: what it was asked, the model it was asked of, and when. */
export type PersonalityTry = { id: string; prompt: string; model: string; created: string };

/** How a persona's personality is made: its prompt, the model it's asked of, and every try, with the one chosen. */
export type Personality = { prompt: string; model: string; tries: PersonalityTry[]; chosen: string };

// How each persona's personality was made, by the persona's path, until the drive keeps it.
const personalities = mutable(PERSONALITY_SAMPLE as Record<string, Personality>);

/**
 * How a persona's personality is made, started empty for one that has none yet.
 *
 * @param path - Where the persona is.
 * @returns Its prompt, model and tries, to edit in place.
 */
export function personalityOf(path: string): Personality {
  personalities[path] ??= { prompt: '', model: 'balanced', tries: [], chosen: '' };
  return personalities[path];
}

/**
 * Takes personas, agents and skills off the drive, for this session.
 *
 * @param paths - Where they are.
 */
export function remove(paths: string[]): void {
  drive.deleted.push(...paths);
}

/**
 * A persona's portrait: its main face, as a picture.
 *
 * @param path - Where the persona is.
 * @param persona - The persona.
 * @returns The picture's address, unless it has no face yet or its path leads to no picture.
 */
export function portraitOf(path: string, persona: PersonaDocument): string | undefined {
  // A persona of an older shape has no head; it shows its initials until it's given one.
  const main = persona.head?.main;
  return main ? pictureOf(path, main) : undefined;
}

/**
 * One of a persona's pictures as a picture to show: an address as it is, a `.still` by the
 * attempt it shows.
 *
 * @param from - The path of the persona it is written in.
 * @param source - The picture, by image address or by path from the persona.
 * @returns The picture's address, unless the path leads to no picture.
 */
export function pictureOf(from: string, source: string): string | undefined {
  if (isAddress(source)) return source;
  const still = stillAt(from, source);
  return still && chosenAttempt(still.document)?.src;
}

/**
 * The `.still` one of a persona's pictures was made as: what keeps its prompt, settings and attempts.
 *
 * @param from - The path of the persona it is written in.
 * @param source - The picture, by image address or by path from the persona.
 * @returns The still and where it is, unless the picture is an address or its path leads to no still.
 */
export function stillAt(from: string, source: string): { path: string; document: StillDocument } | undefined {
  if (isAddress(source)) return;
  const { path, document } = follow(from, source);
  return document?.type === 'still' ? { path, document } : undefined;
}

/**
 * A user skill as an agent writes it among its skills: by path from the agent's file, beside the
 * app skills it names by name.
 *
 * @param path - Where the skill is.
 * @returns E.g. `../Skills/Teacher.skill`.
 */
export function skillRef(path: string): string {
  return `..${path}`;
}

/**
 * What a list shows about an agent: the skills it has, the apps' and the user's own, by name.
 *
 * @param agent - The agent.
 * @returns E.g. `Motions · Teacher`, or `No skills`.
 */
export function skillsOf(agent: AgentFile): string {
  const own = skills();
  const nameOf = (skill: string) =>
    SKILLS[skill]?.label ?? own.find(({ path }) => skillRef(path) === skill)?.document.name ?? skill;
  return agent.skills.map(nameOf).join(' · ') || 'No skills';
}

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

/**
 * Whether a picture is written as an image's address rather than a path on the drive.
 *
 * @param source - The picture as written.
 * @returns Whether it's an address.
 */
function isAddress(source: string): boolean {
  return /^(https?:|data:|blob:)/.test(source);
}

/**
 * The header a new document starts with, named after its file and made by the user.
 *
 * @param path - Where it goes.
 * @param extension - Its file's extension, left out of its name.
 * @returns Its header.
 */
function headerOf(path: string, extension: string) {
  const now = new Date().toISOString();
  return {
    version: 1 as const,
    id: crypto.randomUUID(),
    name: nameOf(path).slice(0, -extension.length),
    created: now,
    updated: now,
    author: { kind: 'user' as const },
  };
}

/**
 * A free path for a new file in a folder: `<base><extension>`, or the first `<base> N<extension>`
 * not taken.
 *
 * @param folder - The folder it goes in.
 * @param base - Its name before a number.
 * @param extension - Its extension, e.g. `.persona`.
 * @returns The path.
 */
function freePath(folder: string, base: string, extension: string): string {
  // A deleted file's path stays taken: the drive keeps hiding whatever is put back there.
  const taken = (path: string) => !!documentAt(path) || drive.deleted.includes(path);
  let path = `${folder}/${base}${extension}`;
  for (let n = 2; taken(path); n++) path = `${folder}/${base} ${n}${extension}`;
  return path;
}
