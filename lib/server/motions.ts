import type { AIAdapter } from '@irpclib/ai-kit/worker';
import type { IRPCData } from '@irpclib/irpc';
import { list, read, write } from '@irpclib/r2-file';
import type { ImageWorkerEnv } from '@irpclib/r2-image/worker';
import { TOOLS } from '@/lib/agents/tools.js';
import { addressAt, chosenAttempt } from '@/lib/documents/generation.js';
import { newHeader, newId, parentOf } from '@/lib/documents/paths.js';
import type { FileRow } from '@/lib/documents/rows.js';
import { runtime, stageAt, TRACK_NAMES, type TrackType, trackDefaults } from '@/lib/documents/stage.js';
import type { MotionDocument, PersonaDocument, SoundDocument, StageDocument, StillDocument, TakeDocument } from '@/lib/documents/types.js';
import type { SysAsk, SysHandler } from '@/lib/kernel/agent.js';
import { MOTION_FACE, MOTION_FIGURE, MOTION_OUTFIT, MOTION_PICTURE, MOTION_VOICE } from '@/lib/kernel/agent.h.js';
import { openLink } from '@/lib/share/links.js';
import { pathFrom } from '@/lib/share/paths.js';
import { addAttempts } from '@/lib/share/stills.js';
import type { SoundAttempt } from '@/lib/speech/speech.h.js';
import { speakAttempt } from '@/lib/speech/speech.js';
import { makeAttempts, makeStill } from './stills.js';

/** Where projects are kept. */
const MOTIONS = '~/Motions';

/** Where people are kept. */
const PEOPLE = '~/People';

/** The model what's made here is made with, until the user picks another. */
const MODEL = 'standard';

/** How long a scene runs when neither it nor its words say, and the shortest and longest a video can be asked for, in seconds. */
const SCENE_SECONDS = 5;
const MIN_VIDEO_SECONDS = 1;
const MAX_VIDEO_SECONDS = 10;

/** One keyframe of a clip: where in the clip, how it eases into the next, and what it sets. */
type KeyArgs = { at: number; ease?: string; values: Record<string, unknown> };

/** Something over a scene: where in it and for how long, what it shows, and how it moves. */
type LayerArgs = {
  kind: 'title' | 'html' | 'svg';
  name?: string;
  at?: number;
  seconds?: number;
  props?: Record<string, unknown>;
  motion?: KeyArgs[];
};

type CreateArgs = { name?: string; description?: string; aspect?: string; length?: number; script?: string };
type CastArgs = {
  project?: string;
  name?: string;
  kind?: PersonaDocument['kind'];
  description?: string;
  look?: string;
  figure?: string;
  outfit?: string;
};
type StillArgs = { project?: string; name?: string; prompt?: string; references?: string[]; casts?: string[] };
type SceneArgs = {
  name: string;
  picture?: string;
  video?: string;
  still?: string;
  seconds?: number;
  references?: string[];
  casts?: string[];
  words?: string;
  delivery?: string;
  voice?: string;
  subtitle?: string;
  motion?: KeyArgs[];
  layers?: LayerArgs[];
};
type StageArgs = { project?: string; name?: string; order?: number; script?: string; scenes?: unknown };

/** A stage's size. */
type StageSize = { width: number; height: number };

/** A clip ready for a track, and the frames it covers. */
type ClipSnapshot = { startFrame: number; frames: number; snapshot: object };

/** What a scene left in its project: the files to hold, what its picture clip plays, how long it runs, and what went wrong. */
type MadeScene = {
  files: string[];
  picture?: { type: 'video' | 'image'; src?: string; source?: string };
  seconds: number;
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
    [TOOLS.motionCast.name]: (args, ask) => addPerson(adapter, pictures, args as CastArgs, ask),
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
 * @param ask - The ask they're made in, which shows each of their pictures being made.
 * @returns The new `.persona`, which scenes name them by.
 */
async function addPerson(adapter: AIAdapter, pictures: ImageWorkerEnv, args: CastArgs, ask: SysAsk): Promise<IRPCData> {
  const { project, name, kind = 'character', description, look, figure, outfit } = args;
  if (!project || !name || !look) return { error: 'sys.motion.cast needs project, name and look' };
  const id = newId();
  const path = `${PEOPLE}/${id}.persona`;
  const head = `${id}/Head.still`;
  const settings = { model: MODEL, aspect: '1:1', batch: 1 };
  const face = await ask.activity(MOTION_FACE, name, () =>
    makeStill(adapter, pictures, `${PEOPLE}/${head}`, `${name} face`, { prompt: look, settings, references: [], casts: [] }),
  );
  // Each is drawn from what's made before it, so it's the same person.
  const part = (activity: string, file: string, label: string, prompt: string | undefined, references: string[]) =>
    prompt && face.attempts.length
      ? ask.activity(activity, name, () =>
          makeStill(adapter, pictures, `${PEOPLE}/${file}`, `${name} ${label}`, {
            prompt,
            settings: { ...settings, aspect: '3:4' },
            references,
            casts: [],
          }),
        )
      : undefined;
  const shape = `${id}/Figure.still`;
  const body = await part(MOTION_FIGURE, shape, 'figure', figure, [`${PEOPLE}/${head}`]);
  const worn = `${id}/Outfit.still`;
  const wardrobe = await part(MOTION_OUTFIT, worn, 'outfit', outfit, [`${PEOPLE}/${head}`, ...(body?.attempts.length ? [`${PEOPLE}/${shape}`] : [])]);
  const persona: PersonaDocument = {
    ...newHeader(path, '.persona'),
    name,
    description,
    author: { kind: 'agent' },
    type: 'persona',
    kind,
    head: { main: head },
    // Their figure and outfit are theirs: what they're cast in takes them along with their face.
    ...(body?.attempts.length ? { body: { main: shape } } : {}),
    ...(wardrobe?.attempts.length ? { wardrobe: { main: worn } } : {}),
    ...(body?.attempts.length || wardrobe?.attempts.length ? { attachDefault: true } : {}),
  };
  await write(path, persona as never);
  await changeMotion(project, (motion) => (motion.casts = [...(motion.casts ?? []), path]));
  const failed = [
    !face.attempts.length && 'their face',
    figure && !body?.attempts.length && 'their figure',
    outfit && !wardrobe?.attempts.length && 'their outfit',
  ].filter(Boolean);
  return { path, ...(failed.length ? { failed: `No picture came back for ${failed.join(' or ')}` } : {}) };
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
 * Adds a stage to a project, its scenes one after another: each a take holding a picture as its first
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
  const { project, name, order = 1, script } = args;
  const scenes = scenesOf(args.scenes);
  if (!project || !name || !scenes) return { error: 'sys.motion.stage needs project, name and scenes: a list, each with a name' };
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

  const { composition } = stage;
  const { props, options } = composition;
  const framesOf = (seconds: number) => Math.round(seconds * options.frameRate);
  const box = { x: 0, y: 0, width: props.width, height: props.height };
  const files: string[] = [];
  const failed: string[] = [];
  const timed: { name: string; seconds: number; spoken?: number }[] = [];
  let cover = '';
  let startFrame = 0;
  for (const scene of scenes) {
    const made = await makeScene(adapter, pictures, folder, motion, scene, ask);
    const { picture, seconds } = made;
    const keyed = keyframes(scene.motion, framesOf);
    if (picture) {
      const thumbnail = picture.src ? { thumbnail: picture.src } : {};
      const clip = { src: picture.src, fit: 'cover', ...box };
      const meta = { ...(picture.source ? { source: picture.source } : {}), ...thumbnail };
      addClip(composition, 'video', segment(picture.type, scene.name, seconds, startFrame, framesOf(seconds), meta, clip, keyed));
    }
    if (made.speech) {
      const { source, src, seconds: spoken } = made.speech;
      addClip(composition, 'audio', segment('audio', scene.name, spoken, startFrame, framesOf(spoken), { source }, { src }));
    }
    if (scene.subtitle) {
      const shown = made.speech?.seconds ?? seconds;
      addClip(composition, SUBTITLES, segment('title', 'Subtitle', shown, startFrame, framesOf(shown), {}, { text: scene.subtitle }));
    }
    for (const layer of scene.layers ?? []) {
      const at = layer.at ?? 0;
      const shown = layer.seconds ?? Math.max(seconds - at, 0.1);
      const clip = { ...LAYER_DEFAULTS[layer.kind]?.(props), ...layer.props };
      const name = layer.name ?? LAYER_NAMES[layer.kind];
      const type = layer.kind === 'title' ? 'title' : 'html';
      const start = startFrame + framesOf(at);
      addClip(composition, type, segment(layer.kind, name, shown, start, framesOf(shown), {}, clip, keyframes(layer.motion, framesOf)));
    }
    startFrame += Math.max(framesOf(seconds), 1);
    files.push(...made.files);
    failed.push(...made.failed.map((reason) => `${scene.name}: ${reason}`));
    timed.push({ name: scene.name, seconds, ...(made.speech ? { spoken: made.speech.seconds } : {}) });
    cover ||= picture?.src ?? '';
  }

  await write(path, stage as never);
  await changeMotion(project, (changed) => {
    changed.assets.push(...files);
    changed.cover ||= cover;
  });
  return { path, seconds: runtime(composition), scenes: timed, ...(failed.length ? { failed } : {}) } as IRPCData;
}

/**
 * A stage's scenes as a list. A model can send a long list as JSON text rather than as a list.
 *
 * @param value - What the agent sent.
 * @returns The scenes, or nothing when that isn't a list of named scenes.
 */
function scenesOf(value: unknown): SceneArgs[] | undefined {
  let scenes = value;
  if (typeof value === 'string') {
    try {
      scenes = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(scenes) || !scenes.length || !scenes.every((scene) => typeof scene?.name === 'string')) return undefined;
  return scenes;
}

/**
 * Makes what one scene plays: a take, whose first attempt is its picture and whose references are
 * what that's made from; or a still or a picture that's already there; or nothing, for a scene made
 * of its layers alone. Its words are spoken as a sound when it has any. It runs as long as it says,
 * or else as its words do, and words longer than it run on past it.
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
  const { name, picture, video = '', still, references = [], casts = [], words, delivery = '', voice } = scene;
  const id = newId();
  const settings = { model: MODEL, aspect: motion.aspect, batch: 1 };
  const failed: string[] = [];

  const takePath = `${folder}/${id}.take`;
  const request = { prompt: picture ?? '', settings, references, casts };
  const attempts = picture
    ? await ask.activity(MOTION_PICTURE, name, () => makeAttempts(adapter, pictures, takePath, request).catch(() => []))
    : [];
  if (picture && !attempts.length) failed.push('no picture came back');

  const soundPath = `${folder}/${id}.sound`;
  const spoken = words
    ? await ask.activity(MOTION_VOICE, name, () => speak(soundPath, name, words, delivery, voice, failed))
    : undefined;
  const seconds = scene.seconds ?? spoken?.seconds ?? SCENE_SECONDS;

  const speech = spoken && { source: `${id}.sound`, src: addressAt(soundPath, spoken.src), seconds: spoken.seconds };
  const files = words ? [`${id}.sound`] : [];
  if (!picture) return { files, picture: still ? await shown(folder, still, failed) : undefined, seconds, speech, failed };

  const take: TakeDocument = {
    ...newHeader(takePath, '.take'),
    name,
    author: { kind: 'agent' },
    type: 'take',
    prompt: video,
    settings: {
      mode: 'image',
      model: MODEL,
      aspect: motion.aspect,
      seconds: Math.min(Math.max(Math.ceil(seconds), MIN_VIDEO_SECONDS), MAX_VIDEO_SECONDS),
    },
    references,
    casts,
    attempts: [],
    chosen: '',
  };
  addAttempts(take as never, attempts.map((attempt) => ({ ...attempt, seconds })));
  await write(takePath, take as never);

  const src = attempts[0] && addressAt(takePath, attempts[0].src);
  return { files: [`${id}.take`, ...files], picture: { type: 'video', src, source: `${id}.take` }, seconds, speech, failed };
}

/**
 * What a scene shows of something already made: a still's chosen picture, or a picture itself.
 *
 * @param folder - The project's folder.
 * @param path - The still or the picture, by path.
 * @param failed - Where to say it has no picture.
 * @returns Its picture clip.
 */
async function shown(folder: string, path: string, failed: string[]): Promise<MadeScene['picture']> {
  const project = `${folder}/.`;
  if (!path.endsWith('.still')) return { type: 'image', src: addressAt(project, path) };
  const home = pathFrom(project, path);
  const still = await read<StillDocument>(home, { encoding: 'json' }).catch(() => undefined);
  const chosen = still && chosenAttempt(still);
  if (!chosen) failed.push(`${path} has no picture`);
  return { type: 'image', src: chosen && addressAt(home, chosen.src), source: path };
}

/** A clip's keyframes as a stage keeps them. */
function keyframes(motion: KeyArgs[] | undefined, framesOf: (seconds: number) => number) {
  return (motion ?? []).map(({ at, ease, values }) => ({
    id: crypto.randomUUID(),
    options: { atFrame: framesOf(at), ...(ease ? { meta: { ease } } : {}) },
    data: values,
  }));
}

/** What each kind of layer is called until it's named, and where it sits until it's told. */
const LAYER_NAMES = { title: 'Title', html: 'Box', svg: 'Shape' };

const LAYER_DEFAULTS: Partial<Record<LayerArgs['kind'], (size: StageSize) => Record<string, unknown>>> = {
  html: ({ width, height }) => ({ element: 'div', x: 0, y: 0, width, height }),
  svg: () => ({ element: 'rect', attrs: { fill: 'none' } }),
};

/** The track subtitles sit on: its clips hold only their words, so restyling it restyles them all. */
const SUBTITLES = 'Subtitles';

/** A subtitle: words low on the stage, on a dim band that keeps them readable over any picture. */
function subtitleAt({ width, height }: StageSize): Record<string, unknown> {
  const fontSize = Math.round(Math.min(width, height) * 0.04);
  return {
    x: Math.round(width * 0.08),
    y: Math.round(height * 0.8),
    width: Math.round(width * 0.84),
    height: Math.round(fontSize * 3.2),
    display: 'grid',
    alignItems: 'center',
    textAlign: 'center',
    color: '#ffffff',
    fontSize,
    lineHeight: 1.25,
    background: 'rgba(0, 0, 0, 0.45)',
    borderRadius: Math.round(fontSize * 0.4),
  };
}

/**
 * Puts a clip on a track of its kind that's free for its time, or on a new one, so nothing covers
 * what's already there: words can run on past their picture, and layers can overlap.
 *
 * @param composition - The stage's composition.
 * @param type - The kind of track, or `SUBTITLES` for that one title track.
 * @param clip - The clip.
 */
function addClip(composition: StageDocument['composition'], type: TrackType | typeof SUBTITLES, clip: ClipSnapshot): void {
  const { startFrame, frames } = clip;
  const { frameRate = 30 } = composition.options;
  const size = composition.props;
  if (type === SUBTITLES) {
    let subtitles = composition.tracks.find((track) => track.options.name === SUBTITLES);
    if (!subtitles) {
      subtitles = { id: crypto.randomUUID(), options: { type: 'title', name: SUBTITLES, meta: {} }, props: subtitleAt(size), segments: [] };
      composition.tracks.push(subtitles);
    }
    subtitles.segments.push(clip.snapshot as never);
    return;
  }
  const free = (track: StageDocument['composition']['tracks'][number]) =>
    track.segments.every(({ options }) => {
      const start = options.startFrame ?? 0;
      return start + Math.round((options.duration ?? 0) * frameRate) <= startFrame || start >= startFrame + frames;
    });
  const kin = composition.tracks.filter((track) => track.options.type === type && track.options.name !== SUBTITLES);
  const name = `${TRACK_NAMES[type]} ${kin.length + 1}`;
  const track = kin.find(free) ?? { id: crypto.randomUUID(), options: { type, name, meta: {} }, props: trackDefaults(type, size), segments: [] };
  if (!composition.tracks.includes(track)) composition.tracks.push(track);
  track.segments.push(clip.snapshot as never);
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
    settings: { model: MODEL, seconds: Math.ceil(attempt?.seconds ?? SCENE_SECONDS) },
    attempts: attempt ? [attempt] : [],
    chosen: attempt?.id ?? '',
  };
  await write(path, sound as never);
  return attempt;
}

/** A clip as a stage keeps it, and the frames it covers. */
function segment(
  type: string,
  name: string,
  duration: number,
  startFrame: number,
  frames: number,
  meta: object,
  props: object,
  scenes: object[] = [],
): ClipSnapshot {
  return {
    startFrame,
    frames,
    snapshot: { id: crypto.randomUUID(), options: { speed: 1, duration, type, name, meta, startFrame }, props, scenes },
  };
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
