import { For, template } from '@airlib/react';
import { StageClip } from '@airlib/react-aui';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import type { ReactNode } from 'react';
import { type AudioClip, type CanvasClip, type HtmlClip, MOTION_KEYS, type SvgClip, type VideoClip } from './composition.js';
import { PAINTERS } from './painters.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG attributes whose names are camel case in SVG itself; every other name is written kebab case. */
const SVG_CAMEL = new Set(['preserveAspectRatio', 'viewBox', 'gradientUnits', 'patternUnits', 'textLength']);

/** SVG elements that take a size, and so fill the clip's box unless told otherwise. */
const SVG_SIZED = new Set(['image', 'rect', 'foreignObject', 'use', 'svg']);

/** Clip values that aren't attributes of the SVG element. */
const SVG_SKIP = new Set(['element', 'text', 'attrs']);

/**
 * Every clip a timeline holds, as stage clips track by track, so clips on later tracks draw over
 * earlier ones. Each is rendered once; the stage moves it frame by frame from its own segment.
 */
export const Clips = template<{ timeline: Timeline }>(
  (props) => (
    <For each={() => [...props.timeline.tracks]}>
      {(track) => <For each={() => [...track.segments]}>{(segment) => DRAW[segment.type ?? '']?.(segment) ?? null}</For>}
    </For>
  ),
  'Clips'
);

/** What draws each kind of clip, by its segment's type; a segment of another type isn't drawn. */
const DRAW: Record<string, (segment: TimelineSegment) => ReactNode> = {
  svg: (segment) => <SvgClipView segment={segment as TimelineSegment<SvgClip>} />,
  html: (segment) => <HtmlClipView segment={segment as TimelineSegment<HtmlClip>} />,
  canvas: (segment) => <CanvasClipView segment={segment as TimelineSegment<CanvasClip>} />,
  video: (segment) => <VideoClipView segment={segment as TimelineSegment<VideoClip>} />,
  // Sound draws nothing: the stage decodes it and plays it on its clock, from where the clip is trimmed.
  audio: (segment) => <StageClip segment={segment} media={(segment as TimelineSegment<AudioClip>).props.src} />,
};

/** A video clip: its footage, decoded by the stage, drawn frame by frame into its box, and heard unless muted. */
const VideoClipView = template<{ segment: TimelineSegment<VideoClip> }>(
  (props) => (
    <StageClip
      as="canvas"
      segment={props.segment}
      media={props.segment.props.src}
      fit={props.segment.props.fit}
      muted={props.segment.props.muted}
    />
  ),
  'VideoClipView'
);

/**
 * An SVG clip: an `<svg>` filling the clip's box, holding its one element, whose attributes —
 * keyframed ones included — are written each frame.
 */
const SvgClipView = template<{ segment: TimelineSegment<SvgClip> }>(
  (props) => (
    <StageClip
      as="svg"
      segment={props.segment}
      viewBox={`0 0 ${props.segment.props.width ?? 0} ${props.segment.props.height ?? 0}`}
      draw={({ element, values }) => drawSvg(element, values as SvgClip)}
    />
  ),
  'SvgClipView'
);

/** An HTML clip: its words in its CSS, filling its box. */
const HtmlClipView = template<{ segment: TimelineSegment<HtmlClip> }>(
  (props) => (
    <StageClip segment={props.segment} style={props.segment.props.style}>
      {props.segment.props.text}
    </StageClip>
  ),
  'HtmlClipView'
);

/** A canvas clip: its painter repaints it at every frame. */
const CanvasClipView = template<{ segment: TimelineSegment<CanvasClip> }>(
  (props) => (
    <StageClip
      as="canvas"
      segment={props.segment}
      width={props.segment.props.width}
      height={props.segment.props.height}
      draw={({ element, values, time }) => {
        const context = (element as HTMLCanvasElement).getContext('2d');
        const clip = values as CanvasClip;
        if (context) PAINTERS[clip.painter]?.(context, clip, time);
      }}
    />
  ),
  'CanvasClipView'
);

/**
 * Writes an SVG clip's element for a frame: creates it the first time, then sets its fixed
 * attributes, every other value the clip has beyond its box and motion, and its words.
 *
 * @param root - The clip's `<svg>`.
 * @param clip - The clip's values at the frame.
 */
function drawSvg(root: Element, clip: SvgClip): void {
  let node = root.firstElementChild;
  if (!node || node.localName !== clip.element) {
    node?.remove();
    node = document.createElementNS(SVG_NS, clip.element);
    root.append(node);
  }

  const attributes: Record<string, unknown> = SVG_SIZED.has(clip.element) ? { width: '100%', height: '100%' } : {};
  // Pictures from another origin can only be drawn into a rendered frame when fetched with CORS.
  if (clip.element === 'image') attributes.crossorigin = 'anonymous';
  Object.assign(attributes, clip.attrs);
  for (const [key, value] of Object.entries(clip)) {
    if (!MOTION_KEYS.has(key) && !SVG_SKIP.has(key)) attributes[key] = value;
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    const name = SVG_CAMEL.has(key) ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const text = String(value);
    if (node.getAttribute(name) !== text) node.setAttribute(name, text);
  }
  if (clip.text !== undefined && node.textContent !== clip.text) node.textContent = clip.text;
}
