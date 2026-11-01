import { effect, For, mutable, Snippet, setup, template } from '@airlib/react';
import { StageClip } from '@airlib/react-aui';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import type { ReactNode } from 'react';
import {
  type AudioClip,
  type HtmlClip,
  type ImageClip,
  MOTION_KEYS,
  type PainterClip,
  type StageProps,
  type SvgClip,
  TRACK_CLIPS,
  type TitleClip,
  type VideoClip,
  type WidgetClip,
} from '../composition.js';
import { loadFont } from '../fonts.js';
import { PAINTERS } from '../painters.js';
import { WIDGETS } from '../widgets.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG attributes whose names are camel case in SVG itself; every other name is written kebab case. */
const SVG_CAMEL = new Set(['preserveAspectRatio', 'viewBox', 'gradientUnits', 'patternUnits', 'textLength']);

/** SVG elements that take a size, and so fill the clip's box unless told otherwise. */
const SVG_SIZED = new Set(['image', 'rect', 'foreignObject', 'use', 'svg']);

/** Clip values that aren't attributes of an SVG element, nor CSS of an HTML one. */
const ELEMENT_SKIP = new Set(['element', 'text', 'attrs', 'style']);

/** Clip values that aren't props a widget's keyframes move. */
const WIDGET_SKIP = new Set(['widget', 'params', 'text', 'style']);

/** A widget on a stage is a picture: the pointer goes through it to what's under it. */
const PICTURE_ONLY = { pointerEvents: 'none' } as const;

/** CSS properties a bare number is written to as it is; every other number is a length, in stage units. */
const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order']);

/**
 * Every clip a timeline holds, track by track, so clips on later tracks draw over earlier ones:
 * each track draws only the kind of clips it takes. Each is rendered once; the stage moves it frame
 * by frame from its own segment.
 */
export const Clips = template<{ timeline: Timeline }>(
  (props) => (
    <For each={() => [...props.timeline.tracks]}>
      {(track) => (
        <For each={() => [...track.segments]}>
          {(segment) =>
            TRACK_CLIPS[track.type ?? '']?.includes(segment.type ?? '')
              ? (DRAW[segment.type ?? '']?.(segment, props.timeline.props as StageProps) ?? null)
              : null
          }
        </For>
      )}
    </For>
  ),
  'Clips'
);

/** What draws each kind of clip, by its segment's type; a segment of another type isn't drawn. */
const DRAW: Record<string, (segment: TimelineSegment, stage: StageProps) => ReactNode> = {
  video: (segment) => <VideoClipView segment={segment as TimelineSegment<VideoClip>} />,
  image: (segment) => <ImageClipView segment={segment as TimelineSegment<ImageClip>} />,
  audio: (segment) => <AudioClipView segment={segment as TimelineSegment<AudioClip>} />,
  title: (segment) => <TitleClipView segment={segment as TimelineSegment<TitleClip>} />,
  html: (segment) => <HtmlClipView segment={segment as TimelineSegment<HtmlClip>} />,
  widget: (segment) => <WidgetClipView segment={segment as TimelineSegment<WidgetClip>} />,
  svg: (segment, stage) => <SvgClipView segment={segment as TimelineSegment<SvgClip>} stage={stage} />,
  ...Object.fromEntries(
    Object.keys(PAINTERS).map((name) => [name, (segment: TimelineSegment) => <PainterClipView segment={segment as TimelineSegment<PainterClip>} />])
  ),
};

/** A sound clip: it draws nothing; the stage decodes it and plays it on its clock, from where it's trimmed, unless muted. */
const AudioClipView = template<{ segment: TimelineSegment<AudioClip> }>(
  (props) => (
    <StageClip
      segment={props.segment}
      media={props.segment.props.src}
      muted={props.segment.props.muted}
      volume={props.segment.props.volume}
      pan={props.segment.props.pan}
    />
  ),
  'AudioClipView'
);

/** A video clip: its footage, decoded by the stage, drawn frame by frame into its box, and heard unless muted. */
const VideoClipView = template<{ segment: TimelineSegment<VideoClip> }>(
  (props) => (
    <StageClip
      as="canvas"
      segment={props.segment}
      media={props.segment.props.src}
      fit={props.segment.props.fit}
      muted={props.segment.props.muted}
      volume={props.segment.props.volume}
      pan={props.segment.props.pan}
    />
  ),
  'VideoClipView'
);

/** An image clip: its picture filling its box, cropped to cover it or fitted inside. */
const ImageClipView = template<{ segment: TimelineSegment<ImageClip> }>(
  (props) => (
    <StageClip
      as="img"
      segment={props.segment}
      src={props.segment.props.src}
      alt={props.segment.name ?? ''}
      // Pictures from another origin can only be drawn into a rendered frame when fetched with CORS.
      crossOrigin="anonymous"
      style={{ objectFit: props.segment.props.fit ?? 'cover' }}
    />
  ),
  'ImageClipView'
);

/** A title clip: its words in their CSS, filling its box, in a font the stage waits for. */
const TitleClipView = setup<{ segment: TimelineSegment<TitleClip> }>((props) => {
  // A paused stage draws no frame, so a font set then loads here; `draw` is what a frame waits on.
  effect.client(() => {
    void loadFont(props.segment.props.style, props.segment.props.text);
  });

  return () => (
    // React freezes the object it's given as a style: the clip's own stays the clip's to change.
    <StageClip
      segment={props.segment}
      style={{ ...props.segment.props.style }}
      draw={({ values }) => loadFont((values as TitleClip).style, (values as TitleClip).text)}
    >
      {props.segment.props.text}
    </StageClip>
  );
}, 'TitleClipView');

/**
 * An HTML clip: its one element in its box — an image when it names `img`, else a box — with its
 * fixed CSS and words, and every other value written to its CSS each frame.
 */
const HtmlClipView = template<{ segment: TimelineSegment<HtmlClip> }>((props) => {
  const { element, attrs, style, text } = props.segment.props;
  const image = element === 'img';
  return (
    <StageClip
      as={image ? 'img' : 'div'}
      segment={props.segment}
      src={image ? String(attrs?.src ?? '') : undefined}
      crossOrigin={image ? 'anonymous' : undefined}
      style={style}
      draw={({ element: node, values }) => drawCss(node as HTMLElement, values as HtmlClip)}
    >
      {image ? undefined : text}
    </StageClip>
  );
}, 'HtmlClipView');

/**
 * A widget clip: the AUI widget it names in its box, with its props and words. Each frame its
 * keyframed values go onto a live copy of its props, so only the widget redraws.
 */
const WidgetClipView = setup<{ segment: TimelineSegment<WidgetClip> }>((props) => {
  const shown = mutable<Record<string, unknown>>({});

  const draw = ({ values }: { values: Record<string, unknown> }) => {
    for (const [key, value] of Object.entries(values)) {
      if (!MOTION_KEYS.has(key) && !WIDGET_SKIP.has(key) && shown[key] !== value) shown[key] = value;
    }
  };

  return () => {
    const { widget, params, text, style } = props.segment.props;
    const Widget = WIDGETS[widget ?? ''];
    return Widget ? (
      <StageClip segment={props.segment} style={{ ...PICTURE_ONLY, ...style }} draw={draw}>
        <Snippet data={() => ({ ...params, ...shown })}>{(values) => <Widget {...values}>{text}</Widget>}</Snippet>
      </StageClip>
    ) : null;
  };
}, 'WidgetClipView');

/**
 * An SVG clip: its one element in the stage's units. Drawn over its box when it has one, so its
 * scale and rotation turn around it, or over the whole stage when it doesn't.
 */
const SvgClipView = template<{ segment: TimelineSegment<SvgClip>; stage: StageProps }>((props) => {
  const { x = 0, y = 0, width, height } = props.segment.props;
  const boxed = width !== undefined && height !== undefined;
  return (
    <StageClip
      as="svg"
      segment={props.segment}
      viewBox={boxed ? `${x} ${y} ${width} ${height}` : `0 0 ${props.stage.width} ${props.stage.height}`}
      style={boxed ? undefined : { width: props.stage.width, height: props.stage.height }}
      draw={({ element, values }) => drawSvg(element, values as SvgClip)}
    />
  );
}, 'SvgClipView');

/** A painter clip: the painter its type names repaints it at every frame. */
const PainterClipView = template<{ segment: TimelineSegment<PainterClip> }>(
  (props) => (
    <StageClip
      as="canvas"
      segment={props.segment}
      width={props.segment.props.width}
      height={props.segment.props.height}
      draw={({ element, values, time }) => {
        const context = (element as HTMLCanvasElement).getContext('2d');
        if (context) PAINTERS[props.segment.type ?? '']?.(context, values as PainterClip, time);
      }}
    />
  ),
  'PainterClipView'
);

/**
 * Writes an HTML clip's keyframed values for a frame into its CSS: every value beyond its box and
 * motion, a bare number as a length in stage units unless the property takes it as it is.
 *
 * @param node - The clip's element.
 * @param clip - The clip's values at the frame.
 */
function drawCss(node: HTMLElement, clip: HtmlClip): void {
  for (const [key, value] of Object.entries(clip)) {
    if (MOTION_KEYS.has(key) || ELEMENT_SKIP.has(key) || value === undefined) continue;
    const text = typeof value === 'number' && !UNITLESS.has(key) ? `${value}px` : String(value);
    const style = node.style as unknown as Record<string, string>;
    if (style[key] !== text) style[key] = text;
  }
}

/**
 * Writes an SVG clip's element for a frame: creates it the first time, then sets its fixed
 * attributes, every other value the clip has beyond its box and motion, and its words. A sized
 * element takes its box, in the stage's units, unless its attributes say otherwise.
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

  const attributes: Record<string, unknown> = SVG_SIZED.has(clip.element)
    ? { x: clip.x ?? 0, y: clip.y ?? 0, width: clip.width ?? '100%', height: clip.height ?? '100%' }
    : {};
  // Pictures from another origin can only be drawn into a rendered frame when fetched with CORS.
  if (clip.element === 'image') attributes.crossorigin = 'anonymous';
  Object.assign(attributes, clip.attrs);
  for (const [key, value] of Object.entries(clip)) {
    if (!MOTION_KEYS.has(key) && !ELEMENT_SKIP.has(key)) attributes[key] = value;
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    const name = SVG_CAMEL.has(key) ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const text = String(value);
    if (node.getAttribute(name) !== text) node.setAttribute(name, text);
  }
  if (clip.text !== undefined && node.textContent !== clip.text) node.textContent = clip.text;
}
