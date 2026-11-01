import type { Timeline, TimelineSegment, TimelineTrack } from '@airlib/react/timeline';
import { chosenAttempt, isGenerative } from '@/lib/documents/generation.js';
import type { FileRow } from '@/lib/documents/rows.js';
import type { GenerativeDocument } from '@/lib/documents/types.js';
import { documentAt } from '../motion.js';
import type { AudioClip, HtmlClip, ImageClip, StageProps, SvgClip, TitleClip, VideoClip } from './composition.js';
import type { Composer } from './context.js';

/** The tracks a stage can be given, by type, and what each is called. */
export const TRACK_NAMES = { video: 'Video', audio: 'Audio', title: 'Title', html: 'HTML' };

export type TrackType = keyof typeof TRACK_NAMES;

/** How a dragged asset names itself to the timeline: its path, under this type. */
export const ASSET_DRAG = 'application/x-wedyan-asset';

/** How long a clip runs when nothing says: a picture's or a title's time on screen, in seconds. */
const CLIP_SECONDS = 5;
const TEXT_SECONDS = 3;

/** Where a clip goes: on a track, if one fits, and at a frame. */
export type Placement = { track?: TimelineTrack; frame: number };

/** The stage a clip is put on: its timeline, its size, and the path of its project, beside which it lives. */
export type PlacementStage = { timeline: Timeline; size: StageProps; project: string };

/**
 * Puts a project asset on the open stage as a clip, and picks it: where it's asked, or at the
 * playhead on the top track of its kind with room for it.
 *
 * @param composer - The window's composer.
 * @param asset - The asset.
 * @param at - Where it goes.
 */
export function placeOnStage(composer: Composer, asset: FileRow, at?: Placement): void {
  const { timeline, stage } = composer;
  if (!timeline || !stage) return;
  const placement = { timeline, size: stage.composition.props, project: composer.path };
  void placeAsset(placement, asset, at ?? { frame: timeline.state.frame }).then((segment) => {
    if (segment) composer.clips = [segment.id];
  });
}

/**
 * Gives a stage's timeline a new, empty track: a picture track drawn over the others, or a sound
 * track below them, named for its kind and how many of it there are.
 *
 * @param timeline - The stage's timeline.
 * @param type - The kind of track.
 * @returns The new track.
 */
export function addTrack(timeline: Timeline, type: TrackType): TimelineTrack {
  const count = [...timeline.tracks].filter((track) => track.type === type).length;
  // The stage keeps whether a track is locked or muted in its `meta`, so every track it makes has one.
  return timeline.addTrack({ type, name: `${TRACK_NAMES[type]} ${count + 1}`, meta: {} });
}

/**
 * Puts a project's asset on a stage's timeline as a clip filling the stage: a picture or a still's
 * chosen attempt as an image, footage or a take's chosen attempt as video, sound or a generated
 * sound's chosen attempt as audio. It runs as long as its media does, or a few seconds for a
 * picture. A clip from a generated document names it in `meta.source`, by path from the stage, so
 * the prompt view finds it. It goes on the given track when that track carries its kind and is free
 * for its time, else on the top such track, else on a new one.
 *
 * @param stage - The stage it goes on.
 * @param asset - The asset.
 * @param at - Where it goes.
 * @returns The new clip, or nothing when the asset has no media to show.
 */
export async function placeAsset(stage: PlacementStage, asset: FileRow, at: Placement): Promise<TimelineSegment | undefined> {
  const { timeline, size } = stage;
  const box = { x: 0, y: 0, width: size.width, height: size.height };
  const name = asset.name;

  if (asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio') {
    if (asset.kind === 'image') {
      const props: ImageClip = { src: asset.src, fit: 'cover', ...box };
      return place(timeline, 'video', at, { type: 'image', name, duration: CLIP_SECONDS, meta: { thumbnail: asset.src } }, props);
    }
    const props: VideoClip | AudioClip = asset.kind === 'video' ? { src: asset.src, ...box } : { src: asset.src };
    const type = asset.kind === 'video' ? 'video' : 'audio';
    return place(timeline, type, at, { type, name, duration: await mediaSeconds(asset.src as string, asset.kind) }, props);
  }

  const source = documentAt(asset.path);
  if (!isGenerative(source)) return;
  const attempt = chosenAttempt(source);
  if (!attempt) return;
  const meta = { source: pathFrom(stage.project, asset.path) };

  if (source.type === 'still') {
    const props: ImageClip = { src: attempt.src, fit: 'cover', ...box };
    return place(timeline, 'video', at, { type: 'image', name, duration: CLIP_SECONDS, meta: { ...meta, thumbnail: attempt.src } }, props);
  }
  const { seconds, poster } = attempt as { seconds: number; poster?: string };
  if (source.type === 'sound') {
    const props: AudioClip = { src: attempt.src };
    return place(timeline, 'audio', at, { type: 'audio', name, duration: seconds, meta }, props);
  }
  const props: VideoClip = { src: attempt.src, ...box };
  return place(timeline, 'video', at, { type: 'video', name, duration: seconds, meta: poster ? { ...meta, thumbnail: poster } : meta }, props);
}

/**
 * Makes a generated document show another of its attempts, and its clip with it: the attempt is
 * chosen, and the clip's picture or media is the attempt's.
 *
 * @param segment - The clip made from the document.
 * @param source - The generated document.
 * @param id - The attempt to show, by id.
 */
export function showAttempt(segment: TimelineSegment, source: GenerativeDocument, id: string): void {
  const attempt = source.attempts.find((each) => each.id === id);
  if (!attempt) return;
  source.chosen = id;
  const thumbnail = source.type === 'still' ? attempt.src : (attempt as { poster?: string }).poster;
  (segment.props as { src?: string }).src = attempt.src;
  if (thumbnail) segment.meta = { ...segment.meta, thumbnail };
  if (segment.timeline.status !== 'playing') void segment.timeline.scrub(segment.timeline.frame);
}

/**
 * Puts a title on a title track: words centred across the stage's middle, in white, for a few seconds.
 *
 * @param timeline - The stage's timeline.
 * @param stage - The stage's size.
 * @param at - Where it goes.
 * @returns The new clip.
 */
export function placeTitle(timeline: Timeline, stage: StageProps, at: Placement): TimelineSegment {
  const props: TitleClip = {
    text: 'Title',
    x: Math.round(stage.width * 0.1),
    y: Math.round(stage.height * 0.4),
    width: Math.round(stage.width * 0.8),
    height: Math.round(stage.height * 0.2),
    style: {
      display: 'grid',
      alignItems: 'center',
      textAlign: 'center',
      color: '#ffffff',
      fontSize: Math.round(stage.height * 0.08),
      fontWeight: 'bold',
      lineHeight: 1.1,
    },
  };
  return place(timeline, 'title', at, { type: 'title', name: 'Title', duration: TEXT_SECONDS }, props);
}

/**
 * Puts a box on an HTML track: a rounded panel low on the stage, for a few seconds, to style and key.
 *
 * @param timeline - The stage's timeline.
 * @param stage - The stage's size.
 * @param at - Where it goes.
 * @returns The new clip.
 */
export function placeBox(timeline: Timeline, stage: StageProps, at: Placement): TimelineSegment {
  const props: HtmlClip = {
    element: 'div',
    x: Math.round(stage.width * 0.06),
    y: Math.round(stage.height * 0.72),
    width: Math.round(stage.width * 0.4),
    height: Math.round(stage.height * 0.12),
    style: { background: '#ffffff' },
    borderRadius: Math.round(stage.height * 0.02),
  };
  return place(timeline, 'html', at, { type: 'html', name: 'Box', duration: TEXT_SECONDS }, props);
}

/**
 * Puts a shape on an SVG track: a white ring in the stage's middle, for a few seconds, to style and key.
 *
 * @param timeline - The stage's timeline.
 * @param stage - The stage's size.
 * @param at - Where it goes.
 * @returns The new clip.
 */
export function placeShape(timeline: Timeline, stage: StageProps, at: Placement): TimelineSegment {
  const r = Math.round(Math.min(stage.width, stage.height) * 0.2);
  const props: SvgClip = {
    element: 'circle',
    cx: Math.round(stage.width / 2),
    cy: Math.round(stage.height / 2),
    r,
    attrs: { fill: 'none', stroke: '#ffffff' },
    strokeWidth: Math.max(2, Math.round(r * 0.04)),
  };
  return place(timeline, 'html', at, { type: 'svg', name: 'Shape', duration: TEXT_SECONDS }, props);
}

/**
 * Adds a clip to a track of a kind that's free for its time — the given one when it is, else the
 * top one that is, else a new one, so it never covers another clip — and draws the paused stage
 * again with it.
 *
 * @param timeline - The stage's timeline.
 * @param type - The kind of track the clip goes on.
 * @param at - Where it goes.
 * @param options - The clip's segment options, but where it starts.
 * @param props - The clip's own values.
 * @returns The new clip.
 */
function place(
  timeline: Timeline,
  type: TrackType,
  at: Placement,
  options: { type: string; name: string; duration: number; meta?: Record<string, unknown> },
  props: object
): TimelineSegment {
  const end = at.frame + Math.round(options.duration * timeline.frameRate);
  const free = (track: TimelineTrack) =>
    [...track.segments].every((segment) => segment.endFrame < at.frame || segment.startFrame >= end);
  // Top track first: pictures stack, so the top is the last; sound doesn't, so it's the first.
  const kin = [...timeline.tracks].filter((track) => track.type === type);
  if (type !== 'audio') kin.reverse();
  const track = [at.track, ...kin].find((each) => each?.type === type && free(each)) ?? addTrack(timeline, type);
  const segment = track.addSegment({ ...options, startFrame: at.frame }, props as Record<string, unknown>);
  if (timeline.status !== 'playing') void timeline.scrub(timeline.frame);
  return segment;
}

/**
 * A drive path as written in a document at another path: from that document's folder.
 *
 * @param from - The path of the document it's written in.
 * @param to - The path it leads to, from the drive's root.
 * @returns The path as written, e.g. `Hero.still` or `../Shared/Hero.still`.
 */
function pathFrom(from: string, to: string): string {
  const base = from.split('/').slice(0, -1);
  const target = to.split('/');
  let shared = 0;
  while (shared < base.length && base[shared] === target[shared]) shared++;
  return [...base.slice(shared).map(() => '..'), ...target.slice(shared)].join('/');
}

/**
 * How long a sound or footage runs, read off its metadata; a picture's few seconds when it can't be read.
 *
 * @param src - Its address.
 * @param kind - Whether it's sound or footage.
 * @returns Its length, in seconds.
 */
export function mediaSeconds(src: string, kind: 'audio' | 'video'): Promise<number> {
  return new Promise((resolve) => {
    const media = document.createElement(kind);
    media.preload = 'metadata';
    media.onloadedmetadata = () => resolve(Number.isFinite(media.duration) ? media.duration : CLIP_SECONDS);
    media.onerror = () => resolve(CLIP_SECONDS);
    media.src = src;
  });
}
