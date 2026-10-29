import type { Timeline, TimelineSegment, TimelineTrack } from '@airlib/react/timeline';
import { follow } from '@/lib/documents/store.js';
import type { MotionAsset, StillDocument, TakeDocument } from '@/lib/documents/types.js';
import type { AudioClip, HtmlClip, StageProps, SvgClip, VideoClip } from './composition.js';

/** The tracks a stage can be given, by type, and what each is called. */
export const TRACK_NAMES = { video: 'Video', audio: 'Audio', text: 'Text' };

export type TrackType = keyof typeof TRACK_NAMES;

/** How long a clip runs when nothing says: a picture's or a title's time on screen, in seconds. */
const CLIP_SECONDS = 5;
const TEXT_SECONDS = 3;

/** Where a clip goes: on a track, if one fits, and at a frame. */
export type Placement = { track?: TimelineTrack; frame: number };

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
  return timeline.addTrack({ type, name: `${TRACK_NAMES[type]} ${count + 1}` });
}

/**
 * Puts a project's asset on a stage's timeline as a clip filling the stage: a picture or a still's
 * chosen attempt as an image, footage or a take's chosen attempt as video, sound as audio. It runs
 * as long as its media does, or a few seconds for a picture. It goes on the given track when that
 * track carries its kind and is free for its time, else on the top such track, else on a new one.
 *
 * @param timeline - The stage's timeline.
 * @param from - The project's path, which the asset's address is from.
 * @param asset - The asset.
 * @param stage - The stage's size.
 * @param at - Where it goes.
 * @returns The new clip, or nothing when the asset has no media to show.
 */
export async function placeAsset(
  timeline: Timeline,
  from: string,
  asset: MotionAsset,
  stage: StageProps,
  at: Placement
): Promise<TimelineSegment | undefined> {
  const box = { x: 0, y: 0, width: stage.width, height: stage.height };
  const name = asset.name;

  if (asset.kind === 'image' || asset.kind === 'still') {
    const href = asset.kind === 'image' ? asset.src : chosenStill(from, asset);
    if (!href) return;
    const props: SvgClip = { element: 'image', href, ...box, preserveAspectRatio: 'xMidYMid slice' };
    return place(timeline, 'video', at, { type: 'svg', name, duration: CLIP_SECONDS, meta: { thumbnail: href } }, props);
  }

  if (asset.kind === 'audio') {
    const props: AudioClip = { src: asset.src };
    return place(timeline, 'audio', at, { type: 'audio', name, duration: await mediaSeconds(asset.src, 'audio') }, props);
  }

  const take = asset.kind === 'take' ? chosenTake(from, asset) : undefined;
  const src = take?.src ?? (asset.kind === 'video' ? asset.src : undefined);
  if (!src) return;
  const props: VideoClip = { src, ...box };
  const duration = take?.seconds ?? (await mediaSeconds(src, 'video'));
  return place(timeline, 'video', at, { type: 'video', name, duration, meta: take?.poster ? { thumbnail: take.poster } : undefined }, props);
}

/**
 * Puts a title on a text track: words centred across the stage's middle, in white, for a few seconds.
 *
 * @param timeline - The stage's timeline.
 * @param stage - The stage's size.
 * @param at - Where it goes.
 * @returns The new clip.
 */
export function placeText(timeline: Timeline, stage: StageProps, at: Placement): TimelineSegment {
  const props: HtmlClip = {
    text: 'Title',
    x: Math.round(stage.width * 0.1),
    y: Math.round(stage.height * 0.4),
    width: Math.round(stage.width * 0.8),
    height: Math.round(stage.height * 0.2),
    style: {
      display: 'grid',
      placeItems: 'center',
      textAlign: 'center',
      color: '#ffffff',
      font: `700 ${Math.round(stage.height * 0.08)}px/1.1 system-ui, sans-serif`,
    },
  };
  return place(timeline, 'text', at, { type: 'html', name: 'Title', duration: TEXT_SECONDS }, props);
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
 * A still's chosen attempt, by address.
 *
 * @param from - The project's path.
 * @param asset - The still's asset.
 * @returns Its address, if the still and its attempt are there.
 */
function chosenStill(from: string, asset: MotionAsset): string | undefined {
  const still = follow<'still'>(from, asset.src).document as StillDocument | undefined;
  return still?.attempts.find((attempt) => attempt.id === still.chosen)?.src;
}

/**
 * A take's chosen attempt.
 *
 * @param from - The project's path.
 * @param asset - The take's asset.
 * @returns The attempt, if the take and its attempt are there.
 */
function chosenTake(from: string, asset: MotionAsset): TakeDocument['attempts'][number] | undefined {
  const take = follow<'take'>(from, asset.src).document as TakeDocument | undefined;
  return take?.attempts.find((attempt) => attempt.id === take.chosen);
}

/**
 * How long a sound or footage runs, read off its metadata; a picture's few seconds when it can't be read.
 *
 * @param src - Its address.
 * @param kind - Whether it's sound or footage.
 * @returns Its length, in seconds.
 */
function mediaSeconds(src: string, kind: 'audio' | 'video'): Promise<number> {
  return new Promise((resolve) => {
    const media = document.createElement(kind);
    media.preload = 'metadata';
    media.onloadedmetadata = () => resolve(Number.isFinite(media.duration) ? media.duration : CLIP_SECONDS);
    media.onerror = () => resolve(CLIP_SECONDS);
    media.src = src;
  });
}
