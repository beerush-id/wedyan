import type { MotionBox, TimelineSnapshot } from '@airlib/react/timeline';

/**
 * A project's composition is a timeline snapshot: hydrate it and the one timeline plays every
 * clip. Each segment is a clip; its `type` names what draws it (`svg`, `html`, `canvas`, `video`,
 * or `audio`, which the stage plays rather than draws), its `props` are the clip's own values, and its scenes
 * are keyframes whose `data` holds the values the clip has at that moment, eased into the next
 * keyframe by the scene's `meta.ease`. The snapshot's own `props` are the stage's.
 */
export type Composition = TimelineSnapshot & { props: StageProps };

/** The stage a composition plays on: its size, in stage units, and the colour behind every clip. */
export type StageProps = { width: number; height: number; background?: string };

/**
 * A clip drawn as one SVG element in an `<svg>` filling the clip's box, in the box's own units:
 * which element, its words for a text element, its fixed attributes in `attrs` (including any
 * named like the box, e.g. a text's `x`), and any other value as an attribute that keyframes can
 * move, e.g. `letterSpacing`. A sized element such as an image fills the box unless `attrs` says.
 */
export type SvgClip = MotionBox & {
  element: string;
  text?: string;
  attrs?: Record<string, string | number>;
  [attribute: string]: unknown;
};

/** A clip drawn as HTML filling its box: its words and its CSS. */
export type HtmlClip = MotionBox & { text?: string; style?: Record<string, string | number> };

/**
 * How a clip's sound is heard: muted or not, how loud — 1 its own level — and where between the
 * speakers, -1 left to 1 right.
 */
export type ClipSound = { muted?: boolean; volume?: number; pan?: number };

/** A clip heard rather than drawn: its sound, by address, decoded and played on the stage's clock. */
export type AudioClip = ClipSound & { src?: string };

/**
 * Footage filling the clip's box, decoded and drawn frame by frame: its address, how it fills the
 * box — cropped to cover it, the default, or fitted inside — and how its own sound is heard.
 */
export type VideoClip = MotionBox & ClipSound & { src?: string; fit?: 'cover' | 'contain' };

/** A clip drawn on a canvas filling its box, by the painter it names, with whatever else that painter reads. */
export type CanvasClip = MotionBox & { painter: string; [param: string]: unknown };

/** The values a clip's box and motion take, which the stage applies itself. */
export const MOTION_KEYS = new Set(['x', 'y', 'width', 'height', 'scale', 'rotate', 'opacity']);

/**
 * How long a composition runs: to the end of its last clip.
 *
 * @param composition - The composition.
 * @returns Its length, in seconds.
 */
export const runtime = (composition: Composition): number =>
  Math.max(
    0,
    ...composition.tracks.flatMap((track) =>
      track.segments.map((segment) => segment.options.startFrame / composition.options.frameRate + segment.options.duration)
    )
  );
