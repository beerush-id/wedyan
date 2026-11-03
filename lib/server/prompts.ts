import type { ChatOutput } from '@irpclib/ai-kit';
import type { AIAdapter } from '@irpclib/ai-kit/worker';
import { mutable } from '@irpclib/irpc/core';
import { read } from '@irpclib/r2-file';
import { DEFAULT_MODELS } from '@/lib/agents/index.js';
import SHEETS from '@/lib/agents/SHEETS.md?raw';
import { ADDRESS, chosenAttempt, defaultPictures, settingsOf } from '@/lib/documents/generation.js';
import { nameOf, parentOf } from '@/lib/documents/paths.js';
import type { PersonaDocument, StillDocument, TakeDocument } from '@/lib/documents/types.js';
import { kernel } from '@/lib/kernel/package.js';
import { promptWrite } from '@/lib/kernel/prompts.h.js';
import { pathFrom } from '@/lib/share/paths.js';

/** The model prompts are written with: the agents' own, as they'd write one. */
const WRITER = DEFAULT_MODELS.agents;

/** Where Motions projects live: a document in one is made in its project's art style. */
const MOTIONS = '~/Motions/';

/** The longest stretch of a project's script read for its art style. */
const SCRIPT_LIMIT = 12_000;

/** What the writer is told: the rules an agent follows when it writes a prompt itself. */
const RULES = `You write the prompt an image or video model makes a picture from. Answer with the prompt alone, no preamble, no quotes.

Keep what the draft asks for: it's what the user wants. Then make it hold together:
- Name every person in it by name, with the few features that make them recognizable, taken from their descriptions, in those same words. Never give anyone a feature their descriptions don't.
- With two or more people in the frame, say who is where and doing what, so they can't be swapped.
- Name every reference with what it's for, from what it shows.
- If the project's script states an art style, copy it in word for word.
- Say how the picture is framed: how far away, from what angle, in what light.
- For a video, say what moves and how the camera frames and moves over its length.
Never ask the picture to carry readable words.`;

/**
 * Sets up writing prompts on the server's models: the desktop's `prompt.write`.
 *
 * @param adapter - The server's models.
 */
export function setupPrompts(adapter: AIAdapter): void {
  kernel.construct(promptWrite, (path, draft) => writePrompt(adapter, path, draft));
}

/**
 * Writes a still's or a take's prompt from what it's made from.
 *
 * @param adapter - The server's models.
 * @param path - The still or take, in the home.
 * @param draft - What its prompt says now.
 * @returns The prompt.
 */
async function writePrompt(adapter: AIAdapter, path: string, draft: string): Promise<string> {
  if (!path.startsWith('~/') || !/\.(still|take)$/.test(path)) throw new Error('prompt.write needs a .still or a .take in the home (~/…)');
  const source = await read<StillDocument | TakeDocument>(path, { encoding: 'json' });
  const [people, references, script, owner] = await Promise.all([
    Promise.all((source.casts ?? []).map((cast) => personOf(path, cast, source.castPictures?.[cast]))),
    Promise.all(source.references.map((reference) => referenceOf(path, reference))),
    scriptOf(path),
    ownerOf(path),
  ]);
  const { aspect, seconds } = settingsOf(source);
  const facts = [
    `It is a ${source.type === 'take' ? `video, ${seconds} seconds long,` : 'picture'} in ${aspect}, called "${source.name}".`,
    owner
      ? `It is ${owner.persona.name}'s ${owner.part}: write it as the picture below that fits.${owner.persona.description ? ` Who they are: ${owner.persona.description}` : ''}\n\n${SHEETS}`
      : '',
    `The draft:\n${draft.trim() || '(empty: write it from the rest)'}`,
    people.length ? `Who's in it:\n${people.join('\n')}` : 'Nobody is cast in it.',
    references.length ? `Its references:\n${references.join('\n')}` : 'It has no references.',
    script ? `Its project's script:\n${script}` : '',
  ];
  return ask(adapter, `${RULES}\n\n${facts.filter(Boolean).join('\n\n')}`);
}

/**
 * Someone cast in a picture, as the writer reads them: their name, who they are, and each of their
 * pictures going with it, in words.
 */
async function personOf(from: string, cast: string, picked?: string[]): Promise<string> {
  const path = pathFrom(from, cast);
  const persona = await read<PersonaDocument>(path, { encoding: 'json' }).catch(() => undefined);
  if (!persona) return `- ${nameOf(cast)}: not found`;
  const pictures = await Promise.all((picked ?? defaultPictures(persona)).map((picture) => pictureWords(path, picture)));
  const seen = pictures.filter(Boolean).map((words) => `  - ${words}`);
  return [`- ${persona.name}${persona.description ? `: ${persona.description}` : ''}`, ...seen].join('\n');
}

/**
 * The person a picture belongs to, when it's one of theirs: a person's pictures are kept in the
 * folder named after their file, which says what each one is.
 *
 * @param path - The picture's still.
 * @returns The person, and which of their pictures it is; nothing for anyone else's picture.
 */
async function ownerOf(path: string): Promise<{ persona: PersonaDocument; part: string } | undefined> {
  const personaPath = `${parentOf(path)}.persona`;
  const persona = await read<PersonaDocument>(personaPath, { encoding: 'json' }).catch(() => undefined);
  if (!persona) return;
  const is = (written?: string) => !!written && pathFrom(personaPath, written) === path;
  if (is(persona.head?.main)) return { persona, part: 'face' };
  if (persona.head?.poses?.some(is)) return { persona, part: 'other head picture: a close-up as the draft asks, or a sheet of facial features or expressions only when the draft asks for one' };
  if (is(persona.body?.main) || persona.body?.poses?.some(is)) return { persona, part: 'figure' };
  if (is(persona.wardrobe?.main) || persona.wardrobe?.outfits?.some(is)) return { persona, part: 'outfit' };
}

/** A reference as the writer reads it: what it shows, or what it was made from. */
async function referenceOf(from: string, reference: string): Promise<string> {
  return `- ${(await pictureWords(from, reference)) ?? `a picture, ${nameOf(reference)}`}`;
}

/**
 * A picture in words: its chosen attempt's description, or the prompt it was made from.
 *
 * @param from - The document it's written in.
 * @param picture - The picture, as written: a still, a take, or an address.
 * @returns The words, unless there are none to give.
 */
async function pictureWords(from: string, picture: string): Promise<string | undefined> {
  if (ADDRESS.test(picture) || !/\.(still|take)$/.test(picture)) return;
  const made = await read<StillDocument | TakeDocument>(pathFrom(from, picture), { encoding: 'json' }).catch(() => undefined);
  if (!made) return;
  const described = chosenAttempt(made)?.description;
  return described ? `${made.name}, as drawn: ${described}` : made.prompt ? `${made.name}, made from: ${made.prompt}` : undefined;
}

/**
 * The script of the Motions project a document is in, where its art style is written.
 *
 * @param path - The document.
 * @returns The script, cut to a length the writer reads whole; nothing outside a project.
 */
async function scriptOf(path: string): Promise<string | undefined> {
  if (!path.startsWith(MOTIONS)) return;
  const id = path.slice(MOTIONS.length).split('/')[0];
  const project = await read<{ script?: { path: string } }>(`${MOTIONS}${id}/${id}.motion`, { encoding: 'json' }).catch(() => undefined);
  if (!project?.script?.path) return;
  const script = await read<string>(pathFrom(`${MOTIONS}${id}/${id}.motion`, project.script.path), { encoding: 'text' }).catch(() => undefined);
  return script?.slice(0, SCRIPT_LIMIT);
}

/**
 * Asks the writer once, and gives back what it wrote.
 *
 * @param adapter - The server's models.
 * @param text - Everything the writer is told.
 * @returns The prompt.
 */
async function ask(adapter: AIAdapter, text: string): Promise<string> {
  const live = mutable<{ data?: ChatOutput }>({});
  await new Promise<void>((resolve, reject) => {
    void adapter.ask(
      [{ role: 'user', type: 'text', text }],
      { model: WRITER.model, ...(WRITER.effort ? { reasoningEffort: WRITER.effort } : {}) },
      { state: live, resolve, reject },
    );
  });
  const written = (live.data?.text || (live.data?.chunks ?? []).join('')).trim();
  if (!written) throw new Error('No prompt came back');
  return written;
}
