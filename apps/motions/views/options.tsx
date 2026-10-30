import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $static, mutable, Snippet, setup, template } from '@airlib/react';
import { Button, Divider, Select, Stepper, Toggle, Toolbar, Tooltip } from '@airlib/react-aui';
import type { WindowRenderProps } from '@airlib/react-aui/desktop';
import {
  AspectRatioIcon,
  AudioFileIcon,
  AutoAwesomeIcon,
  CodeIcon,
  DraftIcon,
  MovieIcon,
  ShapesIcon,
  TitleIcon,
} from '@airlib/react-aui/icons';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import type { FC, ReactNode } from 'react';
import {
  EffortIcon,
  GenerativeIcon,
  LoopIcon,
  ModelIcon,
  PauseIcon,
  PlayIcon,
  SnapIcon,
  SplitIcon,
  ToEndIcon,
  ToStartIcon,
} from './icons.js';
import { ASPECTS, chosenAttempt, MODELS, settingsOf, WRITING_MODELS } from '@/lib/documents/generation.js';
import {
  type GenerativeSource,
  generate,
  generativeClip,
  generativePick,
  type MotionsSession,
  pickedClip,
  sessionOf,
  splitPicked,
  writingPicked,
} from './session.js';

const MOTION_MODELS = MODELS.take;

/** How Motions animates a new motion: set from the dock while no stage is open, read when a prompt is sent. */
export const animation = mutable({ model: 'standard', aspect: '16:9', seconds: 6 });


const EFFORTS = { low: 'Low effort', medium: 'Medium effort', high: 'High effort' };

/**
 * How the picked writing — the script, or a memo — is written: set from the dock while it's picked,
 * read when a prompt is sent. The models are placeholders until the kernel names its own.
 */
export const writing = mutable({ model: 'balanced', effort: 'medium' });

/**
 * Motions' options in the dock, following its window and what's picked in it, and only when they
 * have something to offer. In the library, how a new motion is made. In Compose, the transport —
 * to the start, a frame back, play or pause, a frame on, to the end — then snapping and splitting,
 * led, when the picked clip was generated, by how it is made again. In Direct, how the picked row
 * is made again, when it's a generated image or video, or written, when it's the script or a memo.
 * Anywhere else, none.
 */
export const MotionsDockOptions = setup<WindowRenderProps>((props) => {
  const session = sessionOf($static(() => props.instance.id));

  return () => {
    const view = session.route?.view ?? 'library';
    const timeline = session.timeline;
    const generated = timeline ? generativeClip(session) : generativePick(session);
    const written = !timeline && writingPicked(session);
    const shelf = view === 'library';
    if (!shelf && !timeline && !generated && !written) return null;

    return (
      <Toolbar label="Motion settings" variant="text" className={AUI_CLASS.TOOLBAR_OPTIONS}>
        {shelf && <NewMotionOptions />}
        {written && <WritingOptions />}
        {generated && <RegenerateOptions generated={generated} session={session} />}
        {generated && timeline && <Divider orientation="vertical" size="sm" className="wedyan-motions-options-divider" />}
        {timeline && <Transport timeline={timeline} />}
        {timeline && <Divider orientation="vertical" size="sm" className="wedyan-motions-options-divider" />}
        {timeline && <EditTools session={session} />}
      </Toolbar>
    );
  };
}, 'MotionsDockOptions');

/**
 * What Motions' dock options act on, beside them in the dock, to show what they're for — not to
 * press: the picked clip in Compose, as what it was generated from when it was, or the generated
 * image or video picked in Direct. Nothing while nothing is picked.
 */
export const MotionsDockSubject = setup<WindowRenderProps>((props) => {
  const session = sessionOf($static(() => props.instance.id));

  return () => {
    const timeline = session.timeline;
    const generated = timeline ? generativeClip(session) : generativePick(session);
    if (generated) return <SourceSubject generated={generated} />;
    const picked = timeline ? pickedClip(session) : undefined;
    return picked ? <ClipSubject segment={picked} /> : null;
  };
}, 'MotionsDockSubject');

/** A generated image, video or sound, as the picture it shows now; a sound has none. */
const SourceSubject = template<{ generated: GenerativeSource }>((props) => {
  const { source } = props.generated;
  const chosen = chosenAttempt(source);
  const picture = source.type === 'take' ? (chosen as { poster?: string })?.poster : source.type === 'still' ? chosen?.src : undefined;
  return <SubjectTile name={source.name} picture={picture} />;
}, 'SourceSubject');

/** A lane's glyph, by its track's type, for a clip without a picture of its own. */
const LANE_GLYPHS: Record<string, FC> = {
  video: MovieIcon,
  audio: AudioFileIcon,
  title: TitleIcon,
  html: CodeIcon,
  svg: ShapesIcon,
  painter: AutoAwesomeIcon,
};

/** A picked clip, as its picture, or its lane's glyph without one. */
const ClipSubject = template<{ segment: TimelineSegment }>(({ segment }) => (
  <SubjectTile
    name={segment.name ?? 'Clip'}
    picture={segment.meta?.thumbnail as string | undefined}
    glyph={LANE_GLYPHS[segment.track.type ?? ''] ?? DraftIcon}
  />
), 'ClipSubject');

/** The subject's square tile: a picture, or a glyph without one, named for screen readers. */
const SubjectTile = template<{ name: string; picture?: string; glyph?: FC }>(({ name, picture, glyph: Glyph }) => (
  <span role="img" aria-label={name} className="wedyan-motions-subject">
    {picture ? <img src={picture} alt="" /> : Glyph && <Glyph />}
  </span>
), 'SubjectTile');

/** How a new motion is made: its model, its shape, and how long it runs. */
const NewMotionOptions = template(
  () => (
    <>
      <Select size="sm" label="Model" options={MOTION_MODELS} value={$bind(animation, 'model')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <ModelIcon /> <span>{MOTION_MODELS[value as string]}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
      <Select size="sm" label="Aspect ratio" options={ASPECTS} value={$bind(animation, 'aspect')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <AspectRatioIcon /> <span>{value as string}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
      <Stepper
        size="sm"
        label="Seconds"
        decrementLabel="Shorter"
        incrementLabel="Longer"
        min={2}
        max={20}
        value={$bind(animation, 'seconds')}
      />
    </>
  ),
  'NewMotionOptions'
);

/** How the picked writing is written: which model writes it, and how hard it thinks. */
const WritingOptions = template(
  () => (
    <>
      <Select size="sm" label="Model" options={WRITING_MODELS} value={$bind(writing, 'model')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <ModelIcon /> <span>{WRITING_MODELS[value as keyof typeof WRITING_MODELS]}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
      <Select size="sm" label="Reasoning effort" options={EFFORTS} value={$bind(writing, 'effort')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <EffortIcon /> <span>{EFFORTS[value as keyof typeof EFFORTS]}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
    </>
  ),
  'WritingOptions'
);

/**
 * How a picked generated image or video — a clip's source, or a row in Direct — is made again: the
 * model, how long a video runs, and Generate. The picture itself sits beside the options, as the
 * dock's subject.
 */
const RegenerateOptions = template<{ generated: GenerativeSource; session: MotionsSession }>((props) => {
  const { generated, session } = props;
  const { source } = generated;
  const models = MODELS[source.type];
  const settings = settingsOf(source);

  return (
    <>
      <Select size="sm" label="Model" options={models} value={$bind(settings, 'model')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <ModelIcon /> <span>{models[value as string]}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
      {source.type !== 'still' && (
        <Stepper
          size="sm"
          label="Seconds"
          decrementLabel="Shorter"
          incrementLabel="Longer"
          min={2}
          max={10}
          value={$bind(settings, 'seconds')}
        />
      )}
      <Button size="sm" variant="filled" onClick={() => generate(session, generated)}>
        <GenerativeIcon />
        <span>Generate</span>
      </Button>
    </>
  );
}, 'RegenerateOptions');

/** The open stage's editing: whether dragging snaps, and cutting the picked clips at the playhead. */
const EditTools = template<{ session: MotionsSession }>(({ session }) => (
  <>
    <Toggle aria-label="Snap" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(session, 'snap')}>
      <SnapIcon />
      <Tooltip>Snap</Tooltip>
    </Toggle>
    <Button aria-label="Split" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={() => splitPicked(session)}>
      <SplitIcon />
      <Tooltip>Split at the playhead (⌘B)</Tooltip>
    </Button>
  </>
), 'EditTools');

/**
 * The open stage's transport: to where the clip before the playhead starts, play or pause, to where
 * the next one starts, and whether its timeline repeats — the stage's own setting, from its start
 * each time it ends.
 */
const Transport = template<{ timeline: Timeline }>((props) => {
  const { timeline } = props;
  const action = (label: string, icon: ReactNode, run: () => void) => (
    <Button aria-label={label} size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={run}>
      {icon}
      <Tooltip>{label}</Tooltip>
    </Button>
  );

  return (
    <>
      {action('Previous clip', <ToStartIcon />, () => jumpToClip(timeline, -1))}
      <Snippet>
        {() =>
          timeline.state.status === 'playing'
            ? action('Pause', <PauseIcon />, () => timeline.pause())
            : action('Play', <PlayIcon />, () => timeline.play())
        }
      </Snippet>
      {action('Next clip', <ToEndIcon />, () => jumpToClip(timeline, 1))}
      <Toggle aria-label="Loop" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(timeline as { repeat?: boolean }, 'repeat')}>
        <LoopIcon />
        <Tooltip>Loop</Tooltip>
      </Toggle>
    </>
  );
}, 'Transport');

/**
 * Moves the playhead to where a clip starts, on any track: the nearest start before it, or after it.
 * It stays put when there's none that way.
 *
 * @param timeline - The stage's timeline.
 * @param direction - -1 for the clip before the playhead, 1 for the one after.
 */
function jumpToClip(timeline: Timeline, direction: -1 | 1): void {
  const frame = timeline.state.frame;
  const starts = [...timeline.tracks].flatMap((track) => [...track.segments].map((segment) => segment.startFrame));
  const ahead = direction === 1 ? starts.filter((start) => start > frame) : starts.filter((start) => start < frame);
  if (!ahead.length) return;
  void timeline.scrub(direction === 1 ? Math.min(...ahead) : Math.max(...ahead));
}
