import { derived } from '@airlib/react';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import type { Composer, Picked } from '../context.js';
import { sampleClip, toHex } from '../sampling.js';

/** A value keyframes can move: what it reads as when unset, and the step it shows to. */
export type KeyedField = { key: string; fallback?: number; step?: number };

/** A group of values keyed together: the fields it keys. */
export type KeyedGroup = { fields: KeyedField[] };

/** A group's values as the playhead reads them, by key. */
export type Reading = Record<string, number | string | undefined>;

/**
 * What the playhead reads for some values: candidates, shown until something holds them. Each is the
 * value there, to the field's own step rather than a tweened fraction.
 *
 * @param composer - The window's composer.
 * @param fields - The values.
 * @returns The reading, live as the playhead and the values move.
 */
export function createReading(composer: Composer, fields: () => KeyedField[]): Reading {
  return derived.as(() => {
    void composer.edits;
    const reading: Reading = {};
    // This runs once more as the pick clears, before the panel goes.
    const picked = composer.picked();
    if (!picked) return reading;
    // A track has no time of its own, so what it reads is what it holds.
    const clip = composer.hostClip();
    const sampled = clip ? sampleClip(clip, (composer.timeline as Timeline).state.frame, picked) : picked.props;
    for (const { key, fallback, step } of fields()) {
      reading[key] = shown(sampled[key] ?? fallback, step);
    }
    return reading;
  });
}

/** A value as a field shows it: a number to its step, a colour as `#rrggbb`. */
function shown(value: unknown, step = 1): number | string | undefined {
  if (typeof value === 'number') return Number(value.toFixed(Math.max(0, -Math.floor(Math.log10(step)))));
  if (typeof value === 'string' && value.startsWith('rgb')) return toHex(value);
  return value as string | undefined;
}

/**
 * What holds a value at a frame of the clip, to change it there: the keyframe there, or with no
 * keyframes at all, its own values. Without one that sets it, the value there is only a reading.
 *
 * @param keyed - The clip, or an element in it.
 * @param key - The value.
 * @param at - The frame, in the clip's content.
 * @returns What holds it, when something does.
 */
export function holderOf(keyed: Picked, key: string, at: number): Record<string, unknown> | undefined {
  const holder = keyed.scenes.length ? keyed.scenes.find((scene) => scene.atFrame === at)?.data : keyed.props;
  return holder && key in holder ? holder : undefined;
}

/**
 * Makes one value a fact where it belongs: with keyframes, a point at that frame for whoever reads
 * them; with none, there's no between to deal with, so it's a value of its own.
 *
 * @param clip - The clip, whose time the frame is read on; none for a track, which has no keyframes.
 * @param keyed - What holds it: the clip, an element in it, or a track.
 * @param at - The frame, in the clip's content.
 * @param key - The value.
 * @param value - What it is.
 */
export function setValue(clip: TimelineSegment | undefined, keyed: Picked, at: number, key: string, value: number | string): void {
  if (clip && keyed.scenes.length) setKeyframe(clip, keyed, at, { [key]: value });
  else keyed.props[key] = value;
}

/**
 * Keys a group of values at a frame of the clip, or unkeys it: a keyframe there that sets any of the
 * group's values gives them up, and goes once what it still sets changes nothing; otherwise the
 * reading is keyed, into the keyframe there or a new one.
 *
 * @param clip - The clip, whose time the frame is read on.
 * @param keyed - What holds the values: the clip, or an element in it.
 * @param group - The group.
 * @param at - The frame, in the clip's content.
 * @param reading - The group's values to key, by key.
 */
export function toggleKeyframe(
  clip: TimelineSegment,
  keyed: Picked,
  group: KeyedGroup,
  at: number,
  reading: Reading,
): void {
  const scene = keyed.scenes.find((each) => each.atFrame === at);
  if (scene && group.fields.some((field) => field.key in scene.data)) {
    for (const field of group.fields) delete scene.data[field.key];
    dropIfIdle(clip, keyed, scene);
    return;
  }

  const values: Record<string, number | string> = {};
  for (const { key } of group.fields) {
    const value = reading[key];
    if (value !== undefined) values[key] = value;
  }
  setKeyframe(clip, keyed, at, values);
}

/**
 * Makes values a fact at a frame of the clip: into the keyframe there, or a new one.
 *
 * @param clip - The clip, whose time the frame is read on.
 * @param keyed - What holds them: the clip, or an element in it.
 * @param at - The frame, in the clip's content.
 * @param values - The values, by key.
 */
function setKeyframe(clip: TimelineSegment, keyed: Picked, at: number, values: Record<string, number | string>): void {
  const scene = keyed.scenes.find((each) => each.atFrame === at);
  if (scene) Object.assign(scene.data, values);
  else addKeyframe(clip, keyed, at, values);
}

/**
 * Takes a keyframe off when it changes nothing: when, without it, every value it sets is already
 * that at its frame.
 */
function dropIfIdle(clip: TimelineSegment, keyed: Picked, scene: Picked['scenes'][number]): void {
  const { atFrame, meta } = scene;
  const data = { ...scene.data };
  removeScene(clip, keyed, scene);

  const sampled = sampleClip(clip, timelineFrame(clip, atFrame), keyed) as Record<string, unknown>;
  const changes = Object.entries(data).some(([key, value]) =>
    typeof value === 'number' ? Math.abs(Number(sampled[key] ?? value) - value) > 1e-6 : sampled[key] !== value,
  );
  if (changes) insertScene(clip, keyed, atFrame, meta, data);
}

/** Adds a keyframe with the given values and the ease of the one before. */
function addKeyframe(clip: TimelineSegment, keyed: Picked, at: number, values: Record<string, number | string>): void {
  const before = keyed.scenes.findLast((each) => each.atFrame < at);
  insertScene(clip, keyed, at, before?.meta ? { ...before.meta } : undefined, values);
}

/** Puts a keyframe in its place: a clip's through its timeline, an element's straight into its list. */
function insertScene(
  clip: TimelineSegment,
  keyed: Picked,
  atFrame: number,
  meta: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
): void {
  if (keyed === clip) {
    clip.addScene({ atFrame, meta }, data);
    clip.sortScenes();
    return;
  }

  const { scenes } = keyed;
  scenes.splice(scenes.findLastIndex((each) => each.atFrame < atFrame) + 1, 0, { id: crypto.randomUUID(), atFrame, meta, data });
}

/** Takes a keyframe out: a clip's through its timeline, an element's straight out of its list. */
function removeScene(clip: TimelineSegment, keyed: Picked, scene: Picked['scenes'][number]): void {
  if (keyed === clip) clip.removeScene(scene as never);
  else keyed.scenes.splice(keyed.scenes.indexOf(scene), 1);
}

/**
 * Where a timeline frame falls in a clip's content, held within the clip: the frame its keyframes
 * are placed by, which starts at its offset and runs at its speed.
 *
 * @param segment - The clip's segment.
 * @param frame - The timeline frame.
 * @returns The frame in the clip's content.
 */
export function clipFrame(segment: TimelineSegment, frame: number): number {
  const within = Math.min(Math.max(frame - segment.startFrame, 0), segment.endFrame - segment.startFrame);
  return segment.offsetFrame + Math.round(within * segment.speed);
}

/**
 * The timeline frame a frame of a clip's content shows at: `clipFrame` the other way.
 *
 * @param segment - The clip's segment.
 * @param at - The frame in the clip's content.
 * @returns The timeline frame.
 */
export function timelineFrame(segment: TimelineSegment, at: number): number {
  return segment.startFrame + Math.round((at - segment.offsetFrame) / segment.speed);
}

/**
 * The frames, in a clip's content and in order, of the keyframes that set any of some values and
 * fall within the clip: a split clip's halves share their keyframes, each showing its own stretch.
 *
 * @param clip - The clip.
 * @param keyed - What holds the keyframes: the clip, or an element in it.
 * @param keys - The values.
 * @returns The frames.
 */
export function keyedFrames(clip: TimelineSegment, keyed: Picked, keys: string[]): number[] {
  const first = clipFrame(clip, clip.startFrame);
  const last = clipFrame(clip, clip.endFrame);
  return keyed.scenes
    .filter((scene) => scene.atFrame >= first && scene.atFrame <= last && keys.some((key) => key in scene.data))
    .map((scene) => scene.atFrame)
    .sort((a, b) => a - b);
}
