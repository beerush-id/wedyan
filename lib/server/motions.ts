import type { AIAdapter } from '@irpclib/ai-kit/worker';
import type { IRPCData } from '@irpclib/irpc';
import { list, read, write } from '@irpclib/r2-file';
import type { ImageWorkerEnv } from '@irpclib/r2-image/worker';
import { TOOLS } from '@/lib/agents/tools.js';
import { addressAt, chosenAttempt } from '@/lib/documents/generation.js';
import { newHeader, newId, parentOf } from '@/lib/documents/paths.js';
import type { FileRow } from '@/lib/documents/rows.js';
import { stageAt } from '@/lib/documents/stage.js';
import type { MotionDocument, PersonaDocument, SoundDocument, StageDocument, TakeDocument } from '@/lib/documents/types.js';
import type { SysAsk, SysHandler } from '@/lib/kernel/agent.js';
import { MOTION_PICTURE, MOTION_VOICE } from '@/lib/kernel/agent.h.js';
import { openLink } from '@/lib/share/links.js';
import type { SoundAttempt } from '@/lib/speech/speech.h.js';
import { speakAttempt } from '@/lib/speech/speech.js';
import { makeStill } from './stills.js';

/** Where projects are kept. */
const MOTIONS = '~/Motions';

/** Where people are kept. */
const PEOPLE = '~/People';

/** The model what's made here is made with, until the user picks another. */
const MODEL = 'standard';

/** How long a take runs when nothing says, and the longest a video can be asked for, in seconds. */
const TAKE_SECONDS = 5;
const MAX_TAKE_SECONDS = 10;

type CreateArgs = { name?: string; description?: string; aspect?: string; length?: number; script?: string };
type CastArgs = { project?: string; name?: string; kind?: PersonaDocument['kind']; description?: string; look?: string };
type StillArgs = { project?: string; name?: string; prompt?: string; references?: string[]; casts?: string[] };
type SceneArgs = {
  name: string;
  picture: string;
  video: string;
  seconds?: number;
  references?: string[];
  casts?: string[];
  words?: string;
  delivery?: string;
  voice?: string;
};
type StageArgs = { project?: string; name?: string; order?: number; script?: string; scenes?: SceneArgs[] };

/** What a scene left in its project: the files to hold, its take by name, what its clips play, and what went wrong. */
type MadeScene = {
  files: string[];
  take: string;
  seconds: number;
  picture?: string;
  speech?: { source: string; src: string; seconds: number };
  failed: string[];
};

/**
 * Sets up putting a Motion project together: the agents' `sys.motion.*`, which write whole documents
 * so no agent ever lays out a timeline by hand.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer, for R2 Image to size references.
 * @returns The agents' handlers, by tool name.
 */
export function setupMotions(adapter: AIAdapter, pictures: ImageWorkerEnv): Record<string, SysHandler> {
  return {
    [TOOLS.motionCreate.name]: (args) => createProject(args as CreateArgs),
    [TOOLS.motionCast.name]: (args) => addPerson(adapter, pictures, args as CastArgs),
    [TOOLS.motionStill.name]: (args) => addStill(adapter, pictures, args as StillArgs),
    [TOOLS.motionStage.name]: (args, ask) => addStage(adapter, pictures, args as StageArgs, ask),
  };
}

/**
 * Starts a project in its own folder, its script the series' bible and outline. It has no stage until one is added.
 *
 * @param args - What the agent asked.
 * @returns Where it is, and a link that opens it.
 */
async function createProject({ name, description, aspect = '16:9', length, script }: CreateArgs): Promise<IRPCData> {
  if (!name) return { error: 'sys.motion.create needs a name' };
  const id = newId();
  const folder = `${MOTIONS}/${id}`;
  const path = `${folder}/${id}.motion`;
  const motion: MotionDocument = {
    ...newHeader(path, '.motion'),
    id,
    name,
    description,
    author: { kind: 'agent' },
    type: 'motion',
    aspect,
    cover: '',
    length,
    status: 'draft',
    assets: [],
    casts: [],
  };
  if (script) motion.script = { path: await writeScript(folder, name, script) };
  await write(path, motion as never);
  return { path, open: openLink(path) };
}

/**
 * Makes someone and puts them in a project, with the face everything they're in is made from.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer.
 * @param args - What the agent asked.
 * @returns The new `.persona`, which scenes name them by.
 */
async function addPerson(adapter: AIAdapter, pictures: ImageWorkerEnv, args: CastArgs): Promise<IRPCData> {
  const { project, name, kind = 'character', description, look } = args;
  if (!project || !name || !look) return { error: 'sys.motion.cast needs project, name and look' };
  const id = newId();
  const path = `${PEOPLE}/${id}.persona`;
  const head = `${id}/Head.still`;
  const request = { prompt: look, settings: { model: MODEL, aspect: '1:1', batch: 1 }, references: [], casts: [] };
  const still = await makeStill(adapter, pictures, `${PEOPLE}/${head}`, `${name} face`, request);
  const persona: PersonaDocument = {
    ...newHeader(path, '.persona'),
    name,
    description,
    author: { kind: 'agent' },
    type: 'persona',
    kind,
    head: { main: head },
  };
  await write(path, persona as never);
  await changeMotion(project, (motion) => (motion.casts = [...(motion.casts ?? []), path]));
  return { path, ...(still.attempts.length ? {} : { failed: 'No picture came back for their face' }) };
}

/**
 * Makes a still a project holds: a location, a prop, anything its scenes are made from.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer.
 * @param args - What the agent asked.
 * @returns The new `.still`, which scenes name as a reference.
 */
async function addStill(adapter: AIAdapter, pictures: ImageWorkerEnv, args: StillArgs): Promise<IRPCData> {
  const { project, name, prompt, references = [], casts = [] } = args;
  if (!project || !name || !prompt) return { error: 'sys.motion.still needs project, name and prompt' };
  const motion = await motionAt(project);
  if (!motion) return { error: `There's no project at ${project}` };
  const id = newId();
  const path = `${parentOf(project)}/${id}.still`;
  const settings = { model: MODEL, aspect: motion.aspect, batch: 1 };
  const still = await makeStill(adapter, pictures, path, name, { prompt, settings, references, casts });
  await changeMotion(project, (held) => held.assets.push(`${id}.still`));
  return { path, ...(still.attempts.length ? {} : { failed: 'No picture came back' }) };
}

/**
 * Adds a stage to a project, its scenes one after another: each a take holding a still as its first
 * attempt, so the stage plays before any video is made, with its words spoken over it and timed from
 * their real length. Scenes are made one at a time, so stages can be made side by side.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer.
 * @param args - What the agent asked.
 * @param ask - The ask it's made in, which shows each scene being made.
 * @returns The new stage, how long it runs, and what went wrong in it.
 */
async function addStage(adapter: AIAdapter, pictures: ImageWorkerEnv, args: StageArgs, ask: SysAsk): Promise<IRPCData> {
  const { project, name, order = 1, script, scenes = [] } = args;
  if (!project || !name || !scenes.length) return { error: 'sys.motion.stage needs project, name and scenes' };
  const motion = await motionAt(project);
  if (!motion) return { error: `There's no project at ${project}` };

  const folder = parentOf(project);
  // A model can ask for what it just made: that would pay for every picture again, and show it twice.
  const { entries } = await list(folder);
  const made = (entries as unknown as FileRow[]).find((entry) => entry.kind === 'stage' && entry.position === order - 1);
  if (made) return { path: made.path, seconds: made.duration, note: 'This stage is already made, so nothing was made again.' };

  const id = newId();
  const path = `${folder}/${id}.stage`;
  const stage: StageDocument = { ...stageAt(id, folder, name, motion, order - 1), author: { kind: 'agent' } };
  if (script) stage.script = await writeScript(folder, name, script);

  const { props, options, tracks } = stage.composition;
  const trackOf = (type: string) => tracks.find((track) => track.options.type === type)!;
  const box = { fit: 'cover', x: 0, y: 0, width: props.width, height: props.height };
  const files: string[] = [];
  const failed: string[] = [];
  let cover = '';
  let startFrame = 0;
  for (const scene of scenes) {
    const made = await makeScene(adapter, pictures, folder, motion, scene, ask);
    const meta = { source: made.take, ...(made.picture ? { thumbnail: made.picture } : {}) };
    trackOf('video').segments.push(segment('video', scene.name, made.seconds, startFrame, meta, { src: made.picture, ...box }));
    if (made.speech) {
      const { source, src, seconds } = made.speech;
      trackOf('audio').segments.push(segment('audio', scene.name, seconds, startFrame, { source }, { src }));
    }
    startFrame += Math.round(made.seconds * options.frameRate);
    files.push(...made.files);
    failed.push(...made.failed.map((reason) => `${scene.name}: ${reason}`));
    cover ||= made.picture ?? '';
  }

  await write(path, stage as never);
  await changeMotion(project, (changed) => {
    changed.assets.push(...files);
    changed.cover ||= cover;
  });
  return { path, seconds: startFrame / options.frameRate, ...(failed.length ? { failed } : {}) };
}

/**
 * Makes one scene's files: its still, its take, and its sound when it has words.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer.
 * @param folder - The project's folder.
 * @param motion - The project.
 * @param scene - What the agent asked of it.
 * @param ask - The ask it's made in, which shows its picture and its voice being made.
 * @returns What it left in the project.
 */
async function makeScene(
  adapter: AIAdapter,
  pictures: ImageWorkerEnv,
  folder: string,
  motion: MotionDocument,
  scene: SceneArgs,
  ask: SysAsk,
): Promise<MadeScene> {
  const { name, picture, video, references = [], casts = [], words, delivery = '', voice } = scene;
  const id = newId();
  const settings = { model: MODEL, aspect: motion.aspect, batch: 1 };
  const failed: string[] = [];

  const stillPath = `${folder}/${id}.still`;
  const request = { prompt: picture, settings, references, casts };
  const still = await ask.activity(MOTION_PICTURE, name, () => makeStill(adapter, pictures, stillPath, name, request));
  const drawn = chosenAttempt(still);
  if (!drawn) failed.push('no picture came back');

  const soundPath = `${folder}/${id}.sound`;
  const spoken = words
    ? await ask.activity(MOTION_VOICE, name, () => speak(soundPath, name, words, delivery, voice, failed))
    : undefined;

  // The words set how long it runs when they need longer: they're what everything is timed against.
  const seconds = Math.max(Math.min(scene.seconds ?? TAKE_SECONDS, MAX_TAKE_SECONDS), spoken?.seconds ?? 0);
  const takePath = `${folder}/${id}.take`;
  const take: TakeDocument = {
    ...newHeader(takePath, '.take'),
    name,
    author: { kind: 'agent' },
    type: 'take',
    prompt: video,
    settings: { mode: 'image', model: MODEL, aspect: motion.aspect, seconds: Math.min(Math.ceil(seconds), MAX_TAKE_SECONDS) },
    references: [`${id}.still`],
    casts,
    attempts: drawn ? [{ ...drawn, seconds }] : [],
    chosen: drawn?.id ?? '',
  };
  await write(takePath, take as never);

  return {
    files: [`${id}.still`, `${id}.take`, ...(words ? [`${id}.sound`] : [])],
    take: `${id}.take`,
    seconds,
    picture: drawn && addressAt(takePath, drawn.src),
    speech: spoken && { source: `${id}.sound`, src: addressAt(soundPath, spoken.src), seconds: spoken.seconds },
    failed,
  };
}

/**
 * Writes a speech `.sound`, spoken when the voice model answers, so its words are there to speak again when it doesn't.
 *
 * @param path - Where it goes.
 * @param name - What it's called.
 * @param text - Its words.
 * @param prompt - How they're said.
 * @param voice - Who says them, by `.persona`.
 * @param failed - Where to say it couldn't be spoken.
 * @returns The attempt, when there is one.
 */
async function speak(
  path: string,
  name: string,
  text: string,
  prompt: string,
  voice: string | undefined,
  failed: string[],
): Promise<SoundAttempt | undefined> {
  const attempt = await speakAttempt(path, text).catch(() => undefined);
  if (!attempt) failed.push('its words could not be spoken');
  const sound: SoundDocument = {
    ...newHeader(path, '.sound'),
    name,
    author: { kind: 'agent' },
    type: 'sound',
    kind: 'speech',
    prompt,
    text,
    voice,
    settings: { model: MODEL, seconds: Math.ceil(attempt?.seconds ?? TAKE_SECONDS) },
    attempts: attempt ? [attempt] : [],
    chosen: attempt?.id ?? '',
  };
  await write(path, sound as never);
  return attempt;
}

/** One clip on a track, as a stage keeps it. */
function segment(type: string, name: string, duration: number, startFrame: number, meta: object, props: object) {
  return { id: crypto.randomUUID(), options: { speed: 1, duration, type, name, meta, startFrame }, props, scenes: [] } as never;
}

/** Writes a script, a Markdown file in its project's folder, and names it. */
async function writeScript(folder: string, name: string, script: string): Promise<string> {
  const file = `${newId()}.md`;
  await write(`${folder}/${file}`, script as never, { metadata: { title: `${name} script` } });
  return file;
}

/** The project at a path, if there's one. */
function motionAt(path: string): Promise<MotionDocument | undefined> {
  return read<MotionDocument>(path, { encoding: 'json' }).catch(() => undefined);
}

/** The change to each project last in line: what an agent adds side by side is added one after another. */
const changes = new Map<string, Promise<unknown>>();

/**
 * Changes a project, after any change already going on it, so what's added side by side isn't lost.
 *
 * @param path - The project.
 * @param change - What changes.
 * @returns When it's written.
 */
function changeMotion(path: string, change: (motion: MotionDocument) => void): Promise<void> {
  const turn = (changes.get(path) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const motion = await motionAt(path);
      if (!motion) throw new Error(`There's no project at ${path}`);
      change(motion);
      motion.updated = new Date().toISOString();
      await write(path, motion as never);
    })
    .finally(() => {
      if (changes.get(path) === turn) changes.delete(path);
    });
  changes.set(path, turn);
  return turn;
}
