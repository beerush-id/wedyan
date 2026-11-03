import { write } from '@irpclib/r2-file';
import { addressAt, attemptPicture, chosenAttempt, PICTURE_FILE } from '@/lib/documents/generation.js';
import { newId, parentOf } from '@/lib/documents/paths.js';
import { runtime, SUBTITLES, subtitleAt, trackDefaults } from '@/lib/documents/stage.js';
import type { StageDocument, TakeDocument } from '@/lib/documents/types.js';
import { pathFrom, pathTo } from '@/lib/share/paths.js';
import { changeDocument, documentOf } from './store.js';
import {
  type Clip,
  type ClipChange,
  type ClipInit,
  clipAdd,
  clipEdit,
  clipGet,
  clipRemove,
  type StageChanges,
  type StageFile,
  stageEdit,
  stageRead,
  sys,
  type Track,
  type TrackInit,
  trackAdd,
  trackEdit,
  trackGet,
  trackRemove,
} from './system.h.js';

type Composition = StageDocument['composition'];
type StoredTrack = Composition['tracks'][number];
type StoredClip = StoredTrack['segments'][number];
type Size = { width: number; height: number };

/** What each kind of track holds. */
const HOLDS: Record<string, string[]> = { video: ['video', 'image'], audio: ['audio'], title: ['title'], html: ['html', 'svg'] };

/** What a clip is called until it's named. */
const CLIP_NAMES: Record<string, string> = { video: 'Shot', image: 'Shot', audio: 'Sound', title: 'Title', html: 'Box', svg: 'Shape' };

/** The kinds of clip that show or play a file, and so are unfilled without one. */
const MEDIA_TYPES = new Set(['video', 'image', 'audio']);

/** Where a clip sits until it's told. A title reads its track; a sound draws nothing. */
const CLIP_DEFAULTS: Record<string, (size: Size) => Record<string, unknown>> = {
  video: ({ width, height }) => ({ fit: 'cover', x: 0, y: 0, width, height }),
  image: ({ width, height }) => ({ fit: 'cover', x: 0, y: 0, width, height }),
  html: ({ width, height }) => ({ element: 'div', x: 0, y: 0, width, height }),
  svg: () => ({ element: 'rect', attrs: { fill: 'none' } }),
};

/** What a file gives the clip showing it: how it's named from the stage, its address and picture, and how long a sound runs. */
type Shown = { source: string; src?: string; thumbnail?: string; seconds?: number };

/**
 * Sets up reading and changing a stage, its tracks and its clips.
 */
export function setupStages(): void {
  sys.construct(stageRead, async (path) => stageFile(path, await documentOf(path, 'stage')));
  sys.construct(stageEdit, editStage);

  sys.construct(trackGet, async (path, id) => {
    const { composition } = await documentOf(path, 'stage');
    return trackOf(trackIn(composition, id), composition.options.frameRate);
  });
  sys.construct(trackAdd, async (path, init) => {
    let added: StoredTrack | undefined;
    const stage = await changeDocument(path, 'stage', async (changed) => {
      added = await newTrack(path, changed, init);
      changed.composition.tracks.push(added);
    });
    return trackOf(added as StoredTrack, stage.composition.options.frameRate);
  });
  sys.construct(trackEdit, async (path, id, { name, props }) => {
    const stage = await changeDocument(path, 'stage', ({ composition }) => {
      const track = trackIn(composition, id);
      if (name) track.options.name = name;
      if (props) track.props = { ...track.props, ...props };
    });
    return trackOf(trackIn(stage.composition, id), stage.composition.options.frameRate);
  });
  sys.construct(trackRemove, async (path, id) => {
    await changeDocument(path, 'stage', ({ composition }) => {
      trackIn(composition, id);
      composition.tracks = composition.tracks.filter((track) => track.id !== id);
    });
    return { removed: 1 };
  });

  sys.construct(clipGet, async (path, trackId, id) => {
    const { composition } = await documentOf(path, 'stage');
    return clipOf(clipIn(trackIn(composition, trackId), id), composition.options.frameRate);
  });
  sys.construct(clipAdd, async (path, trackId, items) => {
    const ids: string[] = [];
    const stage = await changeDocument(path, 'stage', async (changed) => {
      const track = trackIn(changed.composition, trackId);
      ids.push(...(await addClips(path, changed, track, items)));
    });
    await coverFrom(path, stage);
    return clipsOf(stage.composition, ids);
  });
  sys.construct(clipEdit, async (path, trackId, items) => {
    const stage = await changeDocument(path, 'stage', (changed) => changeClips(path, changed, trackId, items));
    await coverFrom(path, stage);
    return clipsOf(stage.composition, items.map(({ clipId }) => clipId));
  });
  sys.construct(clipRemove, async (path, trackId, ids) => {
    await changeDocument(path, 'stage', ({ composition }) => {
      const track = trackIn(composition, trackId);
      for (const id of ids) clipIn(track, id);
      track.segments = track.segments.filter((segment) => !ids.includes(segment.id));
    });
    return { removed: ids.length };
  });
}

/**
 * A stage as the tools read it: its clips in seconds, and what it's still waiting for.
 *
 * @param path - The stage.
 * @param stage - Its document.
 * @returns It, whole.
 */
export async function stageFile(path: string, stage: StageDocument): Promise<StageFile> {
  const { composition, ...rest } = stage;
  const { frameRate } = composition.options;
  const tracks = composition.tracks.map((track) => trackOf(track, frameRate));
  const clips = tracks.flatMap((track) => track.clips);
  const unfilled = clips.filter(({ type, meta, props }) => MEDIA_TYPES.has(type) && !meta?.source && !props?.src).map(({ id }) => id);
  const sources = [...new Set(clips.flatMap(({ meta }) => meta?.source ?? []))];
  const shown = new Map(await Promise.all(sources.map(async (source) => [source, await shownBy(path, source).catch(() => undefined)] as const)));
  const failed = clips.flatMap(({ id, meta }) => {
    const source = meta?.source;
    if (!source) return [];
    if (!shown.get(source)) return [{ clip: id, source, why: "It isn't there" }];
    return shown.get(source)?.src ? [] : [{ clip: id, source, why: 'It has nothing to show yet' }];
  });
  return { ...rest, path, props: composition.props, seconds: runtime(composition), tracks, unfilled, failed };
}

/**
 * Gives a new stage its tracks and clips, in place of the ones it starts with.
 *
 * @param path - The stage.
 * @param stage - Its document.
 * @param tracks - What it asks for.
 * @returns When they're on it.
 */
export async function layOut(path: string, stage: StageDocument, tracks: TrackInit[]): Promise<void> {
  stage.composition.tracks = [];
  for (const init of tracks) stage.composition.tracks.push(await newTrack(path, stage, init));
}

/** Writes what's changed on a stage. */
async function editStage(path: string, { script, props, ...fields }: StageChanges): Promise<StageFile> {
  const stage = await changeDocument(path, 'stage', async (changed) => {
    Object.assign(changed, Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)));
    if (props) changed.composition.props = { ...changed.composition.props, ...props };
    if (script === undefined) return;
    changed.script ??= `${newId()}.md`;
    await write(pathFrom(path, changed.script), script as never, { metadata: { title: `${changed.name} script` } });
  });
  return stageFile(path, stage);
}

/** A track on a composition; throws when it isn't there. */
function trackIn(composition: Composition, id: string): StoredTrack {
  const track = composition.tracks.find((each) => each.id === id);
  if (!track) throw new Error(`There's no track ${id} on this stage`);
  return track;
}

/** A clip on a track; throws when it isn't there. */
function clipIn(track: StoredTrack, id: string): StoredClip {
  const clip = track.segments.find((each) => each.id === id);
  if (!clip) throw new Error(`There's no clip ${id} on ${track.options.name}`);
  return clip;
}

/** A track as the tools read it. */
function trackOf(track: StoredTrack, frameRate: number): Track {
  const { id, options, props, segments } = track;
  return { id, name: options.name ?? '', type: options.type ?? '', props, clips: segments.map((segment) => clipOf(segment, frameRate)) };
}

/** A clip as the tools read it: flat, in seconds. */
function clipOf({ id, options, props, scenes }: StoredClip, frameRate: number): Clip {
  const { type, name, speed, meta, startFrame, duration } = options;
  return {
    id,
    type: type as Clip['type'],
    name,
    at: startFrame / frameRate,
    seconds: duration,
    speed,
    props,
    meta,
    motion: scenes.map(({ options: key, data }) => ({
      at: (key.atFrame ?? 0) / frameRate,
      values: data,
      ...(key.meta?.ease ? { ease: key.meta.ease as string } : {}),
    })),
  };
}

/** Clips of a composition as the tools read them, wherever they sit now, in the order asked. */
function clipsOf(composition: Composition, ids: string[]): Clip[] {
  const all = composition.tracks.flatMap((track) => track.segments);
  return ids.flatMap((id) => {
    const clip = all.find((each) => each.id === id);
    return clip ? [clipOf(clip, composition.options.frameRate)] : [];
  });
}

/** A new track, with the clips it's made with. */
async function newTrack(path: string, stage: StageDocument, { name, type, props, clips = [] }: TrackInit): Promise<StoredTrack> {
  const size = stage.composition.props;
  const defaults = name === SUBTITLES && type === 'title' ? subtitleAt(size) : trackDefaults(type, size);
  const track = { id: crypto.randomUUID(), options: { type, name, meta: {} }, props: { ...defaults, ...props }, segments: [] } as unknown as StoredTrack;
  await addClips(path, stage, track, clips);
  return track;
}

/**
 * Puts clips on a track, each showing what its source shows.
 *
 * @param path - The stage.
 * @param stage - Its document.
 * @param track - The track.
 * @param items - What's asked for.
 * @returns The new clips, by id; throws before changing anything when one doesn't fit.
 */
async function addClips(path: string, stage: StageDocument, track: StoredTrack, items: ClipInit[]): Promise<string[]> {
  const made = await Promise.all(items.map((item) => newClip(path, stage.composition, track, item)));
  refuseOverlaps({ ...track, segments: [...track.segments, ...made] }, stage.composition.options.frameRate);
  track.segments.push(...made);
  return made.map(({ id }) => id);
}

/** A clip as a stage keeps it. */
async function newClip(path: string, composition: Composition, track: StoredTrack, init: ClipInit): Promise<StoredClip> {
  const { type, at, seconds, name, speed = 1, props, meta, motion } = init;
  refuseKind(track, type);
  const { frameRate } = composition.options;
  const size = composition.props;
  const shown = meta?.source ? await shownBy(path, meta.source) : undefined;
  const duration = seconds ?? shown?.seconds;
  if (duration === undefined) throw new Error(`${name ?? type} needs seconds: only a spoken sound has a length of its own`);
  return {
    id: crypto.randomUUID(),
    options: {
      speed,
      duration,
      type,
      name: name ?? CLIP_NAMES[type],
      meta: { ...meta, ...sourceMeta(shown) },
      startFrame: Math.round(at * frameRate),
    },
    props: framed({ ...CLIP_DEFAULTS[type]?.(size), ...props, ...(shown?.src ? { src: shown.src } : {}) }, size),
    scenes: keyframes(motion, frameRate),
  } as unknown as StoredClip;
}

/**
 * Changes clips: only what's named, so timing stays when a file is attached and a file stays when
 * timing moves. All of it is checked before anything's written.
 *
 * @param path - The stage.
 * @param stage - Its document.
 * @param trackId - The track they're on.
 * @param items - What changes.
 * @returns When it's done.
 */
async function changeClips(path: string, stage: StageDocument, trackId: string, items: ClipChange[]): Promise<void> {
  const { composition } = stage;
  const { frameRate } = composition.options;
  const size = composition.props;
  const from = trackIn(composition, trackId);
  for (const { clipId, trackId: to, type, at, seconds, name, speed, props, meta, motion } of items) {
    const clip = clipIn(from, clipId);
    const { options } = clip;
    const shown = meta?.source ? await shownBy(path, meta.source) : undefined;
    if (type) options.type = type;
    if (at !== undefined) options.startFrame = Math.round(at * frameRate);
    if (seconds !== undefined) options.duration = seconds;
    if (name !== undefined) options.name = name;
    if (speed !== undefined) options.speed = speed;
    if (meta) options.meta = { ...options.meta, ...meta, ...sourceMeta(shown) };
    if (props || shown?.src) clip.props = framed({ ...clip.props, ...props, ...(shown?.src ? { src: shown.src } : {}) }, size);
    if (motion) clip.scenes = keyframes(motion, frameRate) as never;
    if (to && to !== trackId) {
      const target = trackIn(composition, to);
      from.segments.splice(from.segments.indexOf(clip), 1);
      target.segments.push(clip);
    }
  }
  for (const track of composition.tracks) {
    for (const clip of track.segments) refuseKind(track, clip.options.type as string);
    refuseOverlaps(track, frameRate);
  }
}

/** Refuses a clip its track can't hold. */
function refuseKind(track: StoredTrack, type: string): void {
  const { name, type: kind = '' } = track.options;
  if (!HOLDS[kind]?.includes(type)) throw new Error(`${name} is a ${kind} track: it can't hold a ${type} clip`);
}

/** Refuses clips that cover each other on a track, naming them. */
function refuseOverlaps(track: StoredTrack, frameRate: number): void {
  const framesOf = ({ options }: StoredClip) => Math.round(options.duration * frameRate);
  const clips = [...track.segments].sort((a, b) => a.options.startFrame - b.options.startFrame);
  for (const [index, clip] of clips.entries()) {
    const next = clips[index + 1];
    if (!next || clip.options.startFrame + framesOf(clip) <= next.options.startFrame) continue;
    const seconds = (frames: number) => `${(frames / frameRate).toFixed(2)}s`;
    const ends = clip.options.startFrame + framesOf(clip);
    throw new Error(
      `${clip.options.name} runs to ${seconds(ends)} but ${next.options.name} starts at ${seconds(next.options.startFrame)} on ${track.options.name}: pick other times or another track`,
    );
  }
}

/** Keyframes as a stage keeps them. */
function keyframes(motion: ClipInit['motion'], frameRate: number) {
  return (motion ?? []).map(({ at, ease, values }) => ({
    id: crypto.randomUUID(),
    options: { atFrame: Math.round(at * frameRate), ...(ease ? { meta: { ease } } : {}) },
    data: values,
  }));
}

/** What a shown file writes in a clip's `meta`. */
function sourceMeta(shown?: Shown): Record<string, string> {
  if (!shown) return {};
  return { source: shown.source, ...(shown.thumbnail ? { thumbnail: shown.thumbnail } : {}) };
}

/**
 * A clip's box for the part of its picture it frames: the picture enlarged past the stage's edges,
 * so one still can act as several shots with nothing but the clip changing.
 *
 * @param props - The clip's values, and `crop` if it asks for one.
 * @param size - The stage's size.
 * @returns Its values, the crop turned into its box.
 */
function framed({ crop, ...props }: Record<string, unknown>, { width, height }: Size): Record<string, unknown> {
  if (!crop) return props;
  const { x, y, width: wide, height: tall } = crop as { x: number; y: number; width: number; height: number };
  const shownWidth = width / wide;
  const shownHeight = height / tall;
  return { ...props, x: Math.round(-x * shownWidth), y: Math.round(-y * shownHeight), width: Math.round(shownWidth), height: Math.round(shownHeight) };
}

/**
 * What a file shows a clip: a still's chosen picture, a take's chosen attempt or, with none yet, the
 * first picture among its references, a sound's chosen attempt, or a media file itself.
 *
 * @param path - The stage.
 * @param written - The file, by path from the stage or the home.
 * @returns What the clip takes from it; throws when a document isn't there.
 */
async function shownBy(path: string, written: string): Promise<Shown> {
  const file = pathFrom(path, written);
  const source = pathTo(path, file);
  if (file.endsWith('.sound')) {
    const sound = await documentOf(file, 'sound');
    const chosen = chosenAttempt(sound);
    return { source, src: chosen && addressAt(file, chosen.src), seconds: chosen?.seconds };
  }
  if (file.endsWith('.take')) {
    const take = await documentOf(file, 'take');
    const chosen = chosenAttempt(take);
    if (chosen) return { source, src: addressAt(file, chosen.src), thumbnail: attemptPicture(file, take, chosen) };
    const picture = await referencedPicture(file, take);
    return { source, src: picture, thumbnail: picture };
  }
  if (file.endsWith('.still')) {
    const picture = await stillPicture(file);
    return { source, src: picture, thumbnail: picture };
  }
  const address = `/${file}`;
  return { source, src: address, ...(PICTURE_FILE.test(file) ? { thumbnail: address } : {}) };
}

/** A still's chosen picture, if it has one. */
async function stillPicture(path: string): Promise<string | undefined> {
  const still = await documentOf(path, 'still');
  const chosen = chosenAttempt(still);
  return chosen && addressAt(path, chosen.src);
}

/** The first picture among what a take is made from. */
async function referencedPicture(path: string, take: TakeDocument): Promise<string | undefined> {
  for (const reference of take.references) {
    const file = pathFrom(path, reference);
    if (PICTURE_FILE.test(file)) return `/${file}`;
    const picture = file.endsWith('.still') ? await stillPicture(file).catch(() => undefined) : undefined;
    if (picture) return picture;
  }
}

/** Makes the first picture a project's stages show its cover, when it has none. */
async function coverFrom(path: string, { projectId, composition }: StageDocument): Promise<void> {
  const clips = composition.tracks.flatMap((track) => track.segments);
  const thumbnail = clips.map(({ options }) => options.meta?.thumbnail).find((picture) => typeof picture === 'string');
  if (!thumbnail) return;
  const project = `${parentOf(path)}/${projectId}.motion`;
  const motion = await documentOf(project, 'motion').catch(() => undefined);
  if (motion && !motion.cover) await changeDocument(project, 'motion', (changed) => void (changed.cover ||= thumbnail as string));
}
