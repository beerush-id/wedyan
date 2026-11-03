import type { AIAdapter } from '@irpclib/ai-kit/worker';
import { write } from '@irpclib/r2-file';
import type { ImageWorkerEnv } from '@irpclib/r2-image/worker';
import { chosenAttempt, settingsOf } from '@/lib/documents/generation.js';
import { newHeader, newId } from '@/lib/documents/paths.js';
import type { GeneratedAttempt, PersonaDocument, SoundDocument, StillDocument, TakeDocument } from '@/lib/documents/types.js';
import { MOTION_FACE, MOTION_FIGURE, MOTION_OUTFIT, MOTION_PICTURE, MOTION_VOICE } from '@/lib/kernel/agent.h.js';
import { DOC_ATTEMPTS } from '@/lib/kernel/document.h.js';
import { makeAttempts, makeStill, newStill } from '@/lib/server/stills.js';
import { pathFrom } from '@/lib/share/paths.js';
import { addAttempts, applyRequest, requestOf } from '@/lib/share/stills.js';
import { speakAttempt } from '@/lib/speech/speech.js';
import { activity, askOf, changeDocument, documentOf, eachOf, folderOf, trash, userAgrees } from './store.js';
import {
  personaCreate,
  personaDelete,
  personaEdit,
  personaGenerate,
  personaRead,
  type PersonaChanges,
  type PersonaFile,
  type PersonaInit,
  type SoundChange,
  type SoundFile,
  type SoundInit,
  type StillChanges,
  type StillFile,
  type StillGeneration,
  type StillInit,
  type TakeChange,
  type TakeFile,
  type TakeInit,
  soundCreate,
  soundDelete,
  soundEdit,
  soundGenerate,
  soundRead,
  stillCreate,
  stillDelete,
  stillEdit,
  stillGenerate,
  stillRead,
  sys,
  takeCreate,
  takeDelete,
  takeEdit,
  takeRead,
} from './system.h.js';

/** Where each kind of file lives until it's told otherwise. */
export const PEOPLE = '~/People';
export const STILLS = '~/Stills';
export const SOUNDS = '~/Sounds';
export const TAKES = '~/Takes';

/** The model tier what's made here is made with, until the user picks another. */
const MODEL = 'standard';

/** How long a sound is written to run when it couldn't be spoken. */
const SOUND_SECONDS = 5;

/** The shortest and longest a video can be asked for, in seconds. */
const MIN_VIDEO_SECONDS = 1;
const MAX_VIDEO_SECONDS = 10;

/** A persona's pictures: the still each is kept in, what it's called, and what shows it being made. */
const PARTS = {
  head: { file: 'Head.still', label: 'face', aspect: '1:1', activity: MOTION_FACE },
  body: { file: 'Figure.still', label: 'figure', aspect: '3:4', activity: MOTION_FIGURE },
  wardrobe: { file: 'Outfit.still', label: 'outfit', aspect: '3:4', activity: MOTION_OUTFIT },
};

type Part = keyof typeof PARTS;

/**
 * Sets up the system's files: people, stills, sounds and takes.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer, for R2 Image to size references.
 * @returns What makes each, for what puts them in a project.
 */
export function setupFiles(adapter: AIAdapter, pictures: ImageWorkerEnv) {
  const makers = {
    persona: (cwd: string | null | undefined, init: PersonaInit) => makePerson(adapter, pictures, folderOf(cwd, PEOPLE), init),
    still: (cwd: string | null | undefined, init: StillInit) => makeNewStill(adapter, pictures, folderOf(cwd, STILLS), init),
    sound: (cwd: string | null | undefined, init: SoundInit) => makeSound(folderOf(cwd, SOUNDS), init),
    take: (cwd: string | null | undefined, init: TakeInit) => makeTake(folderOf(cwd, TAKES), init),
  };

  sys.construct(personaCreate, (cwd, items) => eachOf(items, (init) => makers.persona(cwd, init)));
  sys.construct(personaRead, async (path) => personaFile(path, await documentOf(path, 'persona')));
  sys.construct(personaEdit, editPerson);
  sys.construct(personaDelete, async (path) => {
    const persona = await documentOf(path, 'persona');
    if (!(await userAgrees(`Move ${persona.name} to the trash?`))) return { deleted: 0 };
    await trash([path]);
    return { deleted: 1 };
  });
  sys.construct(personaGenerate, (path, part) => drawPart(adapter, pictures, path, part));

  sys.construct(stillCreate, (cwd, items) => eachOf(items, (init) => makers.still(cwd, init)));
  sys.construct(stillRead, async (path) => stillFile(path, await documentOf(path, 'still')));
  sys.construct(stillEdit, async (path, changes) => stillFile(path, await changeDocument(path, 'still', (still) => written(still, changes))));
  sys.construct(stillDelete, (path) => trashFiles([path], 'still'));
  sys.construct(stillGenerate, (items) => eachOf(items, (item) => newStillAttempt(adapter, pictures, item)));

  sys.construct(soundCreate, (cwd, items) => eachOf(items, (init) => makers.sound(cwd, init)));
  sys.construct(soundRead, async (path) => soundFile(path, await documentOf(path, 'sound')));
  sys.construct(soundEdit, (items) =>
    Promise.all(items.map(async ({ path, ...changes }) => soundFile(path, await changeDocument(path, 'sound', (sound) => written(sound, changes))))),
  );
  sys.construct(soundDelete, (paths) => trashFiles(paths, 'sound'));
  sys.construct(soundGenerate, (paths) => eachOf(paths, newSoundAttempt));

  sys.construct(takeCreate, (cwd, items) => Promise.all(items.map((init) => makers.take(cwd, init))));
  sys.construct(takeRead, async (path) => takeFile(path, await documentOf(path, 'take')));
  sys.construct(takeEdit, (items) =>
    Promise.all(items.map(async ({ path, ...changes }) => takeFile(path, await changeDocument(path, 'take', (take) => written(take, changes))))),
  );
  sys.construct(takeDelete, (paths) => trashFiles(paths, 'take'));

  return makers;
}

/** Writes what's named onto a document, and leaves the rest. */
function written<T extends object>(document: T, changes: StillChanges | Omit<SoundChange, 'path'> | Omit<TakeChange, 'path'>): void {
  const { settings, ...named } = changes;
  Object.assign(document, Object.fromEntries(Object.entries(named).filter(([, value]) => value !== undefined)));
  if (settings) Object.assign(document, { settings: { ...(document as { settings?: object }).settings, ...settings } });
}

/** Trashes files of one type, once they're known to be that and the user agrees. */
async function trashFiles(paths: string[], type: 'still' | 'sound' | 'take') {
  const files = await Promise.all(paths.map((path) => documentOf(path, type)));
  const names = files.map(({ name }) => name).join(', ');
  if (!(await userAgrees(`Move ${names} to the trash?`))) return { deleted: 0 };
  await trash(paths);
  return { deleted: paths.length };
}

/** A person as the tools read them. */
function personaFile(path: string, persona: PersonaDocument, failed?: string): PersonaFile {
  return { ...persona, path, ...(failed ? { failed } : {}) };
}

/** A still as the tools read it, saying so when it has nothing to show. */
function stillFile(path: string, still: StillDocument): StillFile {
  return { ...still, path, ...(still.attempts.length ? {} : { failed: 'No picture came back' }) };
}

/** A sound as the tools read it, with how long it runs, saying so when it hasn't been spoken. */
export function soundFile(path: string, sound: SoundDocument): SoundFile {
  const chosen = chosenAttempt(sound);
  return { ...sound, path, ...(chosen ? { seconds: chosen.seconds } : { failed: 'Its words could not be spoken' }) };
}

/** A take as the tools read it. */
function takeFile(path: string, take: TakeDocument): TakeFile {
  return { ...take, path };
}

/**
 * Makes someone, with the face everything they're in is made from; each other picture is drawn from
 * what's made before it, so it's the same person.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer.
 * @param cwd - The folder they go in.
 * @param init - Who they are.
 * @returns Them, saying which pictures didn't come back.
 */
async function makePerson(adapter: AIAdapter, pictures: ImageWorkerEnv, cwd: string, init: PersonaInit): Promise<PersonaFile> {
  const { name, head, body, wardrobe, kind = 'character', description, voice, attachDefault } = init;
  const id = newId();
  const path = `${cwd}/${id}.persona`;
  const part = (which: Part, prompt: string, references: string[]) => {
    const { file, label, aspect, activity: shown } = PARTS[which];
    const settings = { model: MODEL, aspect, batch: 1 };
    return activity(shown, name, () =>
      makeStill(adapter, pictures, `${cwd}/${id}/${file}`, `${name} ${label}`, { prompt, settings, references, casts: [] }),
    );
  };
  const face = await part('head', head, []);
  const headPath = `${cwd}/${id}/${PARTS.head.file}`;
  const figure = body && face.attempts.length ? await part('body', body, [headPath]) : undefined;
  const drawnFigure = figure?.attempts.length ? [`${cwd}/${id}/${PARTS.body.file}`] : [];
  const worn = wardrobe && face.attempts.length ? await part('wardrobe', wardrobe, [headPath, ...drawnFigure]) : undefined;

  const persona: PersonaDocument = {
    ...newHeader(path, '.persona'),
    name,
    description,
    author: { kind: 'agent' },
    type: 'persona',
    kind,
    voice,
    head: { main: `${id}/${PARTS.head.file}` },
    // Their figure and outfit are theirs: what they're cast in takes them along with their face.
    ...(figure?.attempts.length ? { body: { main: `${id}/${PARTS.body.file}` } } : {}),
    ...(worn?.attempts.length ? { wardrobe: { main: `${id}/${PARTS.wardrobe.file}` } } : {}),
    attachDefault: attachDefault ?? Boolean(figure?.attempts.length || worn?.attempts.length),
  };
  await write(path, persona as never);
  const failed = [
    !face.attempts.length && 'their face',
    body && !figure?.attempts.length && 'their figure',
    wardrobe && !worn?.attempts.length && 'their outfit',
  ].filter(Boolean);
  return personaFile(path, persona, failed.length ? `No picture came back for ${failed.join(' or ')}` : undefined);
}

/**
 * Changes a person. What's asked of a picture is kept on its still, so that's where it's written; a
 * picture they don't have yet is written as a still with nothing drawn.
 *
 * @param path - The person.
 * @param changes - What changes.
 * @returns Them, as written.
 */
async function editPerson(path: string, changes: PersonaChanges): Promise<PersonaFile> {
  const { head, body, wardrobe, ...fields } = changes;
  const persona = await changeDocument(path, 'persona', async (changed) => {
    Object.assign(changed, Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)));
    for (const [which, prompt] of Object.entries({ head, body, wardrobe })) {
      if (prompt) await askPart(path, changed, which as Part, prompt);
    }
  });
  return personaFile(path, persona);
}

/** Writes what's asked of a person's picture onto its still, giving them that still if they have none. */
async function askPart(path: string, persona: PersonaDocument, which: Part, prompt: string): Promise<void> {
  const { file, label } = PARTS[which];
  const written = persona[which]?.main;
  if (written) {
    await changeDocument(pathFrom(path, written), 'still', (still) => void (still.prompt = prompt));
    return;
  }
  const main = `${path.slice(path.lastIndexOf('/') + 1, -'.persona'.length)}/${file}`;
  const still = { ...newStill(pathFrom(path, main)), name: `${persona.name} ${label}`, prompt };
  await write(pathFrom(path, main), still as never);
  persona[which] = { main };
}

/** Draws one of a person's pictures again. */
async function drawPart(adapter: AIAdapter, pictures: ImageWorkerEnv, path: string, which: Part): Promise<PersonaFile> {
  const persona = await documentOf(path, 'persona');
  const main = persona[which]?.main;
  if (!main) throw new Error(`${persona.name} has no ${PARTS[which].label} to draw: give it a prompt with sys.persona.edit`);
  const made = await activity(PARTS[which].activity, persona.name, () => newStillAttempt(adapter, pictures, pathFrom(path, main)));
  return personaFile(path, persona, made.failed);
}

/**
 * Makes a new still and its first picture, one image at a time, since what's asked may be many.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer.
 * @param cwd - The folder it goes in.
 * @param init - What it is.
 * @returns It, saying when no picture came back.
 */
async function makeNewStill(adapter: AIAdapter, pictures: ImageWorkerEnv, cwd: string, init: StillInit): Promise<StillFile> {
  const { name, prompt, settings, references = [], casts = [], castPictures } = init;
  const path = `${cwd}/${newId()}.still`;
  const request = { prompt, settings: { model: MODEL, batch: 1, ...settings }, references, casts, castPictures };
  return stillFile(path, await activity(MOTION_PICTURE, name, () => makeStill(adapter, pictures, path, name, request)));
}

/**
 * Makes a new attempt of a still. What's asked with it is written into the still first; the still
 * among its own references means it's made from what it shows now, and isn't kept there. A window
 * editing the still takes the attempts into its copy, so they're saved with its edits.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer.
 * @param item - The still, and anything more that's asked.
 * @returns It, saying when no picture came back; a failure leaves it as it was.
 */
async function newStillAttempt(adapter: AIAdapter, pictures: ImageWorkerEnv, item: StillGeneration): Promise<StillFile> {
  const { path, prompt, settings, references } = typeof item === 'string' ? { path: item, prompt: undefined, settings: undefined, references: undefined } : item;
  const front = askOf()?.front?.();
  const target = front?.path ?? path;
  const still = await documentOf(target, 'still');
  const itself = (reference: string) => pathFrom(target, reference) === target;
  const asked = {
    ...(prompt ? { prompt } : {}),
    settings: { ...settings, ...front?.settings },
    ...(references ? { references: references.filter((reference) => !itself(reference)) } : {}),
  };
  applyRequest(still, asked);
  const request = requestOf(still);
  const changing = references?.some(itself) && chosenAttempt(still);
  const made = changing ? { ...request, references: [...(request.references ?? []), target] } : request;
  const attempts = await activity(MOTION_PICTURE, still.name, () => makeAttempts(adapter, pictures, target, made).catch(() => []));
  if (!attempts.length) return { ...still, path: target, failed: 'No picture came back' };
  const taken = await takenByDesktop(target, request, attempts);
  if (taken) return stillFile(target, await documentOf(target, 'still'));
  return stillFile(target, await changeDocument(target, 'still', (changed) => {
    applyRequest(changed, asked);
    addAttempts(changed, attempts);
  }));
}

/** Whether a desktop editing a document took its new attempts into its own copy. */
async function takenByDesktop(path: string, request: object, attempts: GeneratedAttempt[]): Promise<boolean> {
  const ask = askOf();
  const taken = (await ask?.desktop({ name: DOC_ATTEMPTS, args: { path, request, attempts } as never, after: -1, ask: true, agent: ask.agent }).catch(() => undefined)) as
    | { added?: boolean }
    | undefined;
  return Boolean(taken?.added);
}

/**
 * Writes a sound and speaks it, kept even when the voice model doesn't answer, so its words are
 * there to speak again.
 *
 * @param cwd - The folder it goes in.
 * @param init - What it says, and how.
 * @returns It, with how long it runs, saying when it couldn't be spoken.
 */
async function makeSound(cwd: string, init: SoundInit): Promise<SoundFile> {
  const { name, text, prompt = '', voice, kind = 'speech', settings, references } = init;
  const path = `${cwd}/${newId()}.sound`;
  const attempt = await activity(MOTION_VOICE, name, () => speakAttempt(path, text).catch(() => undefined));
  const sound: SoundDocument = {
    ...newHeader(path, '.sound'),
    name,
    author: { kind: 'agent' },
    type: 'sound',
    kind,
    prompt,
    text,
    voice,
    references,
    settings: { model: MODEL, seconds: Math.ceil(attempt?.seconds ?? SOUND_SECONDS), ...settings },
    attempts: attempt ? [attempt] : [],
    chosen: attempt?.id ?? '',
  };
  await write(path, sound as never);
  return soundFile(path, sound);
}

/** Speaks a sound again as a new attempt, which it then plays. */
async function newSoundAttempt(path: string): Promise<SoundFile> {
  const sound = await documentOf(path, 'sound');
  const text = sound.text?.trim();
  if (!text) throw new Error(`${sound.name} has no words to say`);
  const attempt = await activity(MOTION_VOICE, sound.name, () => speakAttempt(path, text).catch(() => undefined));
  if (!attempt) return { ...sound, path, failed: 'Its words could not be spoken' };
  if (await takenByDesktop(path, {}, [attempt])) return soundFile(path, await documentOf(path, 'sound'));
  return soundFile(path, await changeDocument(path, 'sound', (changed) => addAttempts(changed as never, [attempt])));
}

/**
 * Writes a take: the video it will be, with nothing generated.
 *
 * @param cwd - The folder it goes in.
 * @param init - What it is.
 * @returns It.
 */
async function makeTake(cwd: string, init: TakeInit): Promise<TakeFile> {
  const { name, prompt, settings, references = [], casts = [], castPictures } = init;
  const path = `${cwd}/${newId()}.take`;
  const take: TakeDocument = {
    ...newHeader(path, '.take'),
    name,
    author: { kind: 'agent' },
    type: 'take',
    prompt,
    settings: { mode: 'image', model: MODEL, ...settings },
    references,
    casts,
    castPictures,
    attempts: [],
    chosen: '',
  };
  const { seconds } = settingsOf(take);
  take.settings = { ...take.settings, seconds: Math.min(Math.max(Math.ceil(seconds), MIN_VIDEO_SECONDS), MAX_VIDEO_SECONDS) };
  await write(path, take as never);
  return takeFile(path, take);
}
