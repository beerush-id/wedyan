import { subscribe } from '@airlib/react';
import type { TimelineSegment } from '@airlib/react/timeline';
import gsap from 'gsap';
import type { Picked } from './context.js';

/** One value GSAP tweens. Each is its own object, so no value's name can mean anything to GSAP. */
type Slot = { value: number | string };

/** What GSAP can read as a colour. A named one isn't told apart from any other word. */
const COLOR = /^(#|rgb|hsl)/;

/** A point of a value that switches: where it's placed, and what it becomes there. */
type Switch = { atFrame: number; value: unknown };

/**
 * The values of something keyed, read from its keyframes: numbers and colours tweened on a paused
 * GSAP timeline seeked to a frame in its content, anything else switched at its points.
 */
type Playback = { timeline: gsap.core.Timeline; slots: Record<string, Slot>; switches: Record<string, Switch[]> };

/** What's been read, by what holds the keyframes, until some keyframes change. */
let playbacks = new WeakMap<object, Playback>();

/**
 * Reads keyframes again as they change, on a composition open for editing, for as long as the caller
 * lives. A composition that doesn't change, like one being rendered, needs none of this.
 *
 * @param composition - The composition: the timeline's storage, clips and elements alike.
 */
export function watchKeyframes(composition: object): void {
  subscribe(composition, (_, event) => {
    if (event.keys.includes('scenes')) playbacks = new WeakMap();
  });
}

/**
 * A clip's values with its track's under them: its own where it has one, its track's where it
 * doesn't. Nothing is written to the clip, so a change to the track shows in every clip that follows it.
 *
 * @param clip - The clip.
 * @returns What it reads.
 */
export function clipValues(clip: TimelineSegment): Record<string, unknown> {
  return { ...clip.track.props, ...clip.props };
}

/**
 * Reads values at a timeline frame. Every value follows its own points: it holds the first until
 * then, eases between each pair by the earlier one's `meta.ease`, any GSAP ease, and holds the last
 * from there. A
 * value no keyframe sets is what `props` says, or for a clip, what its track says. Keyframes stay
 * data; this is who deals with what's between them.
 *
 * @param clip - The clip, whose time the frame is read on.
 * @param frame - The frame on the timeline.
 * @param keyed - What holds the values and keyframes: the clip, or an element in it.
 * @returns The values to draw it with.
 */
export function sampleClip<P extends Record<string, unknown>>(
  clip: TimelineSegment<P>,
  frame: number,
  keyed: Picked = clip as never,
): P {
  const { timeline, slots, switches } = playbackOf(keyed);
  // Keyframes are placed in its content, which starts at its offset.
  const at = frame - clip.startFrame + clip.offsetFrame;
  timeline.seek(at, false);

  const values: Record<string, unknown> = keyed === (clip as never) ? clipValues(clip) : { ...keyed.props };
  for (const key of Object.keys(slots)) values[key] = slots[key].value;
  for (const key of Object.keys(switches)) {
    const points = switches[key];
    values[key] = (points.findLast((point) => point.atFrame <= at) ?? points[0]).value;
  }
  return values as P;
}

/** What's read for something keyed, laid out once until keyframes change. */
function playbackOf(keyed: Picked): Playback {
  const kept = playbacks.get(keyed);
  if (kept) return kept;

  const playback = play(keyed.scenes);
  playbacks.set(keyed, playback);
  return playback;
}

/** Lays keyframes out for reading: each value's points, in order, by whether it tweens or switches. */
function play(scenes: Picked['scenes']): Playback {
  const points = new Map<string, Picked['scenes']>();
  for (const scene of scenes) {
    for (const key of Object.keys(scene.data)) points.set(key, [...(points.get(key) ?? []), scene]);
  }

  // Off GSAP's own clock: nothing plays it, and a clip that's gone shouldn't be kept by it.
  const timeline = gsap.timeline({ paused: true });
  gsap.globalTimeline.remove(timeline);
  const playback: Playback = { timeline, slots: {}, switches: {} };

  for (const [key, scenes] of points) {
    if (!tweens(scenes.map((scene) => scene.data[key]))) {
      playback.switches[key] = scenes.map((scene) => ({ atFrame: scene.atFrame, value: scene.data[key] }));
      continue;
    }

    const slot = { value: scenes[0].data[key] as Slot['value'] };
    playback.slots[key] = slot;
    scenes.slice(0, -1).forEach((from, index) => {
      const to = scenes[index + 1];
      if (to.atFrame <= from.atFrame) return;
      timeline.fromTo(
        slot,
        { value: from.data[key] as Slot['value'] },
        {
          value: to.data[key] as Slot['value'],
          duration: to.atFrame - from.atFrame,
          ease: (from.meta?.ease as string) ?? 'none',
          immediateRender: false,
          lazy: false,
        },
        from.atFrame,
      );
    });
  }
  return playback;
}

/** Whether a value's points can have a between: all numbers, or all colours. */
function tweens(points: unknown[]): boolean {
  return (
    points.every((point) => typeof point === 'number') ||
    points.every((point) => typeof point === 'string' && COLOR.test(point))
  );
}

/**
 * A colour as a colour input takes it: GSAP gives one between points in `rgba()`.
 *
 * @param color - The colour.
 * @returns It as `#rrggbb`.
 */
export function toHex(color: string): string {
  const [red, green, blue] = gsap.utils.splitColor(color) as number[];
  return `#${[red, green, blue].map((part) => Math.round(part).toString(16).padStart(2, '0')).join('')}`;
}
