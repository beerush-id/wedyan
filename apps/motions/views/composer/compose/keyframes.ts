import { sampleSegment } from '@airlib/aria';
import type { TimelineSegment } from '@airlib/react/timeline';

/** A group of values keyed together: the fields it keys, and what each reads as when unset. */
export type KeyedGroup = { fields: { key: string; fallback?: number }[] };

/**
 * Writes a keyed value of a clip — of its box or its sound — at a timeline frame. A value no
 * keyframe animates is the clip's own; an animated one goes into the keyframe at that frame, or a
 * new keyframe there.
 *
 * @param segment - The clip's segment.
 * @param key - The value to write.
 * @param value - What it becomes.
 * @param frame - The timeline frame it's written at, held within the clip.
 */
export function writeValue(segment: TimelineSegment, key: string, value: number, frame: number): void {
  if (!segment.scenes.some((scene) => key in scene.data)) {
    segment.props[key] = value;
    return;
  }

  const at = clipFrame(segment, frame);
  const scene = segment.scenes.find((each) => each.atFrame === at);
  if (scene) scene.data[key] = value;
  else addKeyframe(segment, at, { [key]: value });
}

/**
 * Keys a group of a clip's values at a frame of the clip, or unkeys it: a keyframe there that sets
 * any of the group's values gives them up, and goes once what it still sets changes nothing;
 * otherwise the group's values as they are there are keyed, into the keyframe there or a new one.
 *
 * @param segment - The clip's segment.
 * @param group - The group.
 * @param at - The frame, in the clip's content.
 */
export function toggleKeyframe(segment: TimelineSegment, group: KeyedGroup, at: number): void {
  const scene = segment.scenes.find((each) => each.atFrame === at);
  if (scene && group.fields.some((field) => field.key in scene.data)) {
    for (const field of group.fields) delete scene.data[field.key];
    dropIfIdle(segment, scene);
    return;
  }

  const sampled = sampleSegment(segment, timelineFrame(segment, at)) as Record<string, number | undefined>;
  const values: Record<string, number> = {};
  for (const { key, fallback } of group.fields) {
    const value = sampled[key] ?? fallback;
    if (value !== undefined) values[key] = value;
  }
  if (scene) Object.assign(scene.data, values);
  else addKeyframe(segment, at, values);
}

/**
 * Takes a keyframe off a clip when it changes nothing: when, without it, the clip already has every
 * value it sets at its frame.
 */
function dropIfIdle(segment: TimelineSegment, scene: TimelineSegment['scenes'][number]): void {
  const { atFrame, meta } = scene;
  const data = { ...scene.data };
  segment.removeScene(scene);

  const sampled = sampleSegment(segment, timelineFrame(segment, atFrame)) as Record<string, unknown>;
  const changes = Object.entries(data).some(([key, value]) =>
    typeof value === 'number' ? Math.abs(Number(sampled[key] ?? value) - value) > 1e-6 : sampled[key] !== value,
  );
  if (!changes) return;

  segment.addScene({ atFrame, meta }, data);
  segment.sortScenes();
}

/**
 * Adds a keyframe to a clip. It takes every animated value the clip has at that frame, so the values
 * it doesn't set keep their course through it, then the given ones, and the ease of the one before.
 */
function addKeyframe(segment: TimelineSegment, at: number, values: Record<string, number>): void {
  const sampled = sampleSegment(segment, timelineFrame(segment, at)) as Record<string, number>;
  const data: Record<string, number> = {};
  for (const each of segment.scenes) {
    for (const name of Object.keys(each.data)) data[name] = sampled[name];
  }
  Object.assign(data, values);

  const before = segment.scenes.findLast((each) => each.atFrame < at);
  segment.addScene({ atFrame: at, meta: before?.meta ? { ...before.meta } : undefined }, data);
  segment.sortScenes();
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
 * The frames, in a clip's content and in order, of its keyframes that set any of some values and
 * fall within the clip: a split clip's halves share their keyframes, each showing its own stretch.
 *
 * @param segment - The clip's segment.
 * @param keys - The values.
 * @returns The frames.
 */
export function keyedFrames(segment: TimelineSegment, keys: string[]): number[] {
  const first = clipFrame(segment, segment.startFrame);
  const last = clipFrame(segment, segment.endFrame);
  return segment.scenes
    .filter((scene) => scene.atFrame >= first && scene.atFrame <= last && keys.some((key) => key in scene.data))
    .map((scene) => scene.atFrame)
    .sort((a, b) => a - b);
}
