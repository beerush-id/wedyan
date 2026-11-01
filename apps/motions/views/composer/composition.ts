import type { MotionBox } from '@airlib/aria';
import type { TimelineSnapshot } from '@airlib/react/timeline';
import { PAINTERS } from './painters.js';

/**
 * A project's composition is a timeline snapshot: hydrate it and the one timeline plays every
 * clip. Each track is a host of one kind — `video`, `audio`, `title`, `html`, `painter` —
 * and takes only its own kinds of clip; a painter track's clips are named by their painter. Each segment is a clip; its `type` names what it is, its
 * `props` are its own values, and its scenes are keyframes whose `data` holds the values it has at
 * that moment, eased into the next keyframe by the scene's `meta.ease`. The snapshot's own `props`
 * are the stage's.
 */
export type Composition = TimelineSnapshot & { props: StageProps };

/** The stage a composition plays on: its size, in stage units, and the colour behind every clip. */
export type StageProps = { width: number; height: number; background?: string };

/** The clips each kind of track takes, by the segment's `type`: a painter track, the painters Wedyan has. */
export const TRACK_CLIPS: Record<string, string[]> = {
  video: ['video', 'image'],
  audio: ['audio'],
  title: ['title'],
  html: ['html', 'svg', 'widget'],
  painter: Object.keys(PAINTERS),
};

/** A picture filling its box: its address, and how it fills the box — cropped to cover it, the default, or fitted inside. */
export type ImageClip = MotionBox & { src?: string; fit?: 'cover' | 'contain' };

/** Words on a title track, set by their CSS, filling the clip's box. */
export type TitleClip = MotionBox & { text?: string; style?: Record<string, string | number> };

/**
 * One element on an HTML track, in its box: which element, HTML or SVG, its words, its fixed
 * attributes and CSS, any other value as what keyframes can move — CSS on HTML, e.g. `borderRadius`,
 * an attribute on SVG, e.g. `r` — and the elements nested inside it.
 */
export type HtmlClip = MotionBox & {
  element?: string;
  text?: string;
  attrs?: Record<string, string | number>;
  style?: Record<string, string | number>;
  children?: ClipNode[];
  [property: string]: unknown;
};

/** One keyframe of a nested element: where it sits in its host's content, how it eases, and its values. */
export type NodeKeyframe = { id: string; atFrame: number; meta?: Record<string, unknown>; data: Record<string, unknown> };

/**
 * An element nested in a clip or in another of these. It inherits from what holds it as the DOM
 * does: it moves, scales and fades with it, and its own values and keyframes adjust from there. Its
 * box, when set, is within what holds it; without one, it flows. It has no time of its own: its
 * keyframes count from its host's start, so trimming or moving the host takes it along.
 */
export type ClipNode = { id: string; name?: string; props: HtmlClip; scenes: NodeKeyframe[] };

/**
 * An AUI widget on an HTML track, in its box: which widget, its props as `params`, its words, its
 * box's fixed CSS, and any other value as a prop keyframes can move, e.g. a progress bar's `value`.
 */
export type WidgetClip = MotionBox & {
  widget?: string;
  params?: Record<string, unknown>;
  text?: string;
  style?: Record<string, string | number>;
  [prop: string]: unknown;
};

/**
 * One SVG element on an SVG track, in the stage's units: which element, its words for a text
 * element, its fixed attributes, and any other value as an attribute keyframes can move, e.g. `r`.
 * Its box, when set, is the part of the stage it covers, which its scale and rotation turn around;
 * without one, it covers the whole stage.
 */
export type SvgClip = MotionBox & {
  element: string;
  text?: string;
  attrs?: Record<string, string | number>;
  [attribute: string]: unknown;
};

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

/** A clip painted each frame by the painter its `type` names, with whatever that painter reads. */
export type PainterClip = MotionBox & { [param: string]: unknown };

/** The values a clip's box and motion take, which the stage applies itself. */
export const MOTION_KEYS = new Set(['x', 'y', 'width', 'height', 'scale', 'rotate', 'opacity']);
