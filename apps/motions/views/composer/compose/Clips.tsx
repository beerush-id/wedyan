import { effect, For, mutable, Snippet, setup, template } from '@airlib/react';
import { StageClip } from '@airlib/react-aui';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import type { CSSProperties, ReactNode } from 'react';
import {
  type AudioClip,
  type ClipNode,
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
import { type FontStyle, loadFont } from '../fonts.js';
import { PAINTERS } from '../painters.js';
import { clipValues, sampleClip } from '../sampling.js';
import { WIDGETS } from '../widgets.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG attributes whose names are camel case in SVG itself; every other name is written kebab case. */
const SVG_CAMEL = new Set(['preserveAspectRatio', 'viewBox', 'gradientUnits', 'patternUnits', 'textLength']);

/** SVG elements that take a size, and so fill the clip's box unless told otherwise. */
const SVG_SIZED = new Set(['image', 'rect', 'foreignObject', 'use', 'svg']);

/** Clip values that aren't attributes of an SVG element, nor CSS of an HTML one. */
const ELEMENT_SKIP = new Set(['element', 'text', 'attrs', 'children']);

/** What a keyframe can set that the clip itself may not have, so it's cleared once nothing sets it. */
const KEYED_CSS = ['fontSize', 'color', 'background', 'borderRadius'];

/** Clip values that aren't props a widget's keyframes move. */
const WIDGET_SKIP = new Set(['widget', 'params', 'text', 'style']);

/** A widget on a stage is a picture: the pointer goes through it to what's under it. */
const PICTURE_ONLY = { pointerEvents: 'none' } as const;

/** How a shot with no picture yet reads, in stage units: its words in the middle of a dark frame. */
const GUIDE_CSS: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  padding: 120,
  background: '#1c1b1f',
  color: '#ffffffb3',
  fontSize: 44,
  lineHeight: 1.3,
  textAlign: 'center',
};

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
      volume={clipValues(props.segment).volume as number}
      pan={clipValues(props.segment).pan as number}
    />
  ),
  'AudioClipView'
);

/** A shot with nothing to show yet: what it's meant to be, in words, so the cut can be watched before any picture exists. */
const GuideClipView = template<{ segment: TimelineSegment<VideoClip | ImageClip> }>(
  (props) => {
    const { guide, shows } = (props.segment.meta ?? {}) as { guide?: string; shows?: string };
    return (
      <StageClip segment={props.segment} style={GUIDE_CSS}>
        {guide ?? shows ?? props.segment.name}
      </StageClip>
    );
  },
  'GuideClipView'
);

/** A video clip: its footage, decoded by the stage, drawn frame by frame into its box, and heard unless muted. */
const VideoClipView = template<{ segment: TimelineSegment<VideoClip> }>(
  (props) =>
    props.segment.props.src ? (
      <StageClip
        as="canvas"
        segment={props.segment}
        media={props.segment.props.src}
        fit={props.segment.props.fit}
        muted={props.segment.props.muted}
        volume={clipValues(props.segment).volume as number}
        pan={clipValues(props.segment).pan as number}
      />
    ) : (
      <GuideClipView segment={props.segment} />
    ),
  'VideoClipView'
);

/** An image clip: its picture filling its box, cropped to cover it or fitted inside. */
const ImageClipView = template<{ segment: TimelineSegment<ImageClip> }>(
  (props) =>
    props.segment.props.src ? (
      <StageClip
        as="img"
        segment={props.segment}
        src={props.segment.props.src}
        alt={props.segment.name ?? ''}
        // Pictures from another origin can only be drawn into a rendered frame when fetched with CORS.
        crossOrigin="anonymous"
        style={{ objectFit: props.segment.props.fit ?? 'cover' }}
      />
    ) : (
      <GuideClipView segment={props.segment} />
    ),
  'ImageClipView'
);

/** A title clip: its words in their CSS, filling its box, in a font the stage waits for. */
const TitleClipView = setup<{ segment: TimelineSegment<TitleClip> }>((props) => {
  // A paused stage draws no frame, so a font set then loads here; `draw` is what a frame waits on.
  effect.client(() => {
    void loadFont(clipValues(props.segment) as TitleClip, props.segment.props.text);
  });

  return () => (
    <StageClip
      segment={props.segment}
      style={cssOf(clipValues(props.segment) as HtmlClip)}
      draw={({ element, values }) => {
        drawCss(element as HTMLElement, values as HtmlClip);
        return loadFont(values as TitleClip, (values as TitleClip).text);
      }}
    >
      {props.segment.props.text}
    </StageClip>
  );
}, 'TitleClipView');

/**
 * An HTML clip: its one element in its box, a box unless it names another, HTML or SVG, with its
 * fixed attributes, CSS and words, and the elements nested in it. Every other value is written to
 * its CSS each frame, and each frame reaches what's nested from here.
 */
const HtmlClipView = template<{ segment: TimelineSegment<HtmlClip> }>((props) => {
  const { element, attrs, text, children } = props.segment.props;
  const image = element === 'img';
  return (
    <StageClip
      as={(element ?? 'div') as 'div'}
      segment={props.segment}
      {...attrs}
      crossOrigin={image ? 'anonymous' : undefined}
      style={cssOf(clipValues(props.segment) as HtmlClip)}
      draw={({ element: node, values, frame }) => {
        drawCss(node as HTMLElement, values as HtmlClip);
        drawNodes(node, props.segment, (values as HtmlClip).children, frame);
        return Promise.all(fontsOf([{ props: values as HtmlClip }]));
      }}
    >
      {image ? undefined : (
        <>
          {text}
          <For each={() => [...(children ?? [])]}>{(node) => <ClipNodeView node={node} />}</For>
        </>
      )}
    </StageClip>
  );
}, 'HtmlClipView');

/**
 * An element nested in a clip, and what's nested in it. It's drawn once from what it is, in its own
 * box, as a paused stage draws no frame for what was just added; its motion reaches its element each
 * frame from its host's `draw`, never through a render.
 */
const ClipNodeView = setup<{ node: ClipNode }>((props) => {
  // As a title's: a paused stage draws no frame, so a font set then loads here.
  effect.client(() => {
    const { text } = props.node.props;
    if (text !== undefined) void loadFont(props.node.props, text);
  });

  return () => {
    const { element, attrs, text, children, x, y, width, height } = props.node.props;
    const style = cssOf(props.node.props);
    const Element = (element ?? 'div') as 'div';
    const placed = x !== undefined || y !== undefined;
    const box = { ...(placed ? { position: 'absolute', left: x ?? 0, top: y ?? 0 } : {}), width, height } as CSSProperties;
    const id = props.node.id;
    if (element === 'img') return <img alt="" {...attrs} data-node={id} crossOrigin="anonymous" style={{ ...style, ...box }} />;
    return (
      <Element {...attrs} data-node={id} style={{ ...style, ...box }}>
        {text}
        <For each={() => [...(children ?? [])]}>{(node) => <ClipNodeView node={node} />}</For>
      </Element>
    );
  };
}, 'ClipNodeView');

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
  drawValues(node, clip);
  for (const key of KEYED_CSS) {
    if (clip[key] === undefined) (node.style as unknown as Record<string, string>)[key] = '';
  }
}

/**
 * What of a clip's values React sets as its CSS when it renders, before its first frame: everything
 * but what it is, what it holds, and the box the stage places.
 *
 * @param clip - The clip's values.
 * @returns Its CSS, a new object, as React freezes the one it's given.
 */
function cssOf(clip: HtmlClip): CSSProperties {
  return Object.fromEntries(Object.entries(clip).filter(([key]) => !MOTION_KEYS.has(key) && !ELEMENT_SKIP.has(key)));
}

/**
 * The fonts some elements' words are set in, for a frame to wait on: each in the font it inherits, as
 * CSS gives it, from its track down through what holds it, so a family set once on a track loads for
 * every element that shows it.
 *
 * @param nodes - The elements: a clip's own values, or its nested elements.
 * @param inherited - The font what holds them is set in.
 * @returns What's loading.
 */
function fontsOf(nodes: { props: HtmlClip }[] | undefined, inherited: FontStyle = {}): unknown[] {
  return (nodes ?? []).flatMap(({ props }) => {
    const font: FontStyle = {
      fontFamily: props.fontFamily ?? inherited.fontFamily,
      fontWeight: props.fontWeight ?? inherited.fontWeight,
      fontStyle: props.fontStyle ?? inherited.fontStyle,
    };
    return [...(props.text === undefined ? [] : [loadFont(font, props.text)]), ...fontsOf(props.children, font)];
  });
}

/**
 * Draws what's nested in an element for a frame: each node's values at the frame, on the element
 * that shows it. A node inherits the rest from what holds it, as the DOM does.
 *
 * @param parent - The element they're nested in.
 * @param host - The clip they're under, whose time they keep.
 * @param nodes - The nodes.
 * @param frame - The timeline frame.
 */
function drawNodes(parent: Element, host: TimelineSegment, nodes: ClipNode[] | undefined, frame: number): void {
  nodes?.forEach((node) => {
    // By id, not place: a frame can land between a reorder and its render.
    const element = parent.querySelector<HTMLElement | SVGElement>(`:scope > [data-node="${node.id}"]`);
    if (!element) return;
    const values = sampleClip(host, frame, node) as HtmlClip;
    const { x, y, width, height, scale = 1, rotate = 0, opacity = 1 } = values;

    element.style.transform = `rotate(${rotate}deg) scale(${scale})`;
    element.style.opacity = String(opacity);
    if (element instanceof SVGElement) {
      element.style.transformBox = 'fill-box';
      element.style.transformOrigin = 'center';
      for (const [key, value] of Object.entries(values)) {
        if (ELEMENT_SKIP.has(key) || ['scale', 'rotate', 'opacity'].includes(key) || value === undefined) continue;
        const name = SVG_CAMEL.has(key) ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value));
      }
    } else {
      if (x !== undefined || y !== undefined) {
        element.style.position = 'absolute';
        element.style.left = `${x ?? 0}px`;
        element.style.top = `${y ?? 0}px`;
      }
      if (width !== undefined) element.style.width = `${width}px`;
      if (height !== undefined) element.style.height = `${height}px`;
      drawCss(element, values);
    }

    drawNodes(element, host, values.children, frame);
  });
}

/** Writes an element's CSS for a frame: every value beyond its box and motion. */
function drawValues(node: HTMLElement, clip: HtmlClip): void {
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
