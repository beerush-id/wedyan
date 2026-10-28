import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $static, mutable, Show, Snippet, setup, template } from '@airlib/react';
import { Button, Divider, Select, Stepper, Toolbar, Tooltip } from '@airlib/react-aui';
import type { WindowRenderProps } from '@airlib/react-aui/desktop';
import { AspectRatioIcon, AutoAwesomeIcon } from '@airlib/react-aui/icons';
import type { Timeline } from '@airlib/react/timeline';
import type { ReactNode } from 'react';
import { EffortIcon, FrameBackIcon, FrameForwardIcon, PauseIcon, PlayIcon, ToEndIcon, ToStartIcon } from './icons.js';
import { type GenerativeSource, generativeClip, generativePick, sessionOf, writingPicked } from './session.js';

const MODELS = { standard: 'Standard', cinematic: 'Cinematic' };
const IMAGE_MODELS = { standard: 'Standard', detailed: 'Detailed' };
const ASPECTS = { '16:9': '16:9', '9:16': '9:16', '1:1': '1:1' };

/** How Motions animates a new motion: set from the dock while no stage is open, read when a prompt is sent. */
export const animation = mutable({ model: 'standard', aspect: '16:9', seconds: 6 });

/**
 * How the picked generative clip is made again: set from the dock while it's picked, read when a
 * prompt is sent — attempts for a generated image, seconds for a generated video.
 */
export const regeneration = mutable({ model: 'standard', attempts: 2, seconds: 4 });

const WRITING_MODELS = { fast: 'Fast', balanced: 'Balanced', best: 'Best' };
const EFFORTS = { low: 'Low effort', medium: 'Medium effort', high: 'High effort' };

/**
 * How the picked writing — the script, or a memo — is written: set from the dock while it's picked,
 * read when a prompt is sent. The models are placeholders until the kernel names its own.
 */
export const writing = mutable({ model: 'balanced', effort: 'medium' });

/**
 * Motions' options in the dock, following its window and what's picked in it, and only when they
 * have something to offer. In the library, how a new motion is made. In Compose, the transport —
 * to the start, a frame back, play or pause, a frame on, to the end — led, when the picked clip was
 * generated, by how it is made again. In Direct, how the picked row is made again, when it's a
 * generated image or video, or written, when it's the script or a memo. Anywhere else, none.
 */
export const MotionsDockOptions = setup<WindowRenderProps>((props) => {
  const session = sessionOf($static(() => props.instance.id));

  return () => {
    const view = session.route?.view ?? 'library';
    const timeline = session.timeline;
    const generated = timeline ? generativeClip(session) : generativePick(session);
    const written = !timeline && writingPicked(session);
    const shelf = view === 'library' || view === 'album';
    if (!shelf && !timeline && !generated && !written) return null;

    return (
      <Toolbar label="Motion settings" variant="text" className={AUI_CLASS.TOOLBAR_OPTIONS}>
        {shelf && <NewMotionOptions />}
        {written && <WritingOptions />}
        {generated && <RegenerateOptions generated={generated} open={session.open} />}
        {generated && timeline && <Divider orientation="vertical" size="sm" className="wedyan-motions-options-end" />}
        {timeline && <Transport timeline={timeline} />}
      </Toolbar>
    );
  };
}, 'MotionsDockOptions');

/** How a new motion is made: its model, its shape, and how long it runs. */
const NewMotionOptions = template(
  () => (
    <>
      <Select size="sm" label="Model" options={MODELS} value={$bind(animation, 'model')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <AutoAwesomeIcon /> <span>{MODELS[value as keyof typeof MODELS]}</span>
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
              <AutoAwesomeIcon /> <span>{WRITING_MODELS[value as keyof typeof WRITING_MODELS]}</span>
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
 * picture it shows now, larger in its tooltip,
 * which opens the image or video it was generated as; then the model, and how many attempts for an
 * image or how long for a video.
 */
const RegenerateOptions = template<{ generated: GenerativeSource; open?: (path: string) => void }>((props) => {
  const { source } = props.generated;
  const chosen = source.attempts.find((attempt) => attempt.id === source.chosen) ?? source.attempts[0];
  const picture = source.type === 'take' ? ((chosen as { poster?: string })?.poster ?? '') : (chosen?.src ?? '');
  const models = source.type === 'take' ? MODELS : IMAGE_MODELS;

  return (
    <>
      <Button
        size="sm"
        variant="text"
        aria-label={`Open ${source.name}`}
        className="wedyan-motions-source"
        onClick={() => props.open?.(props.generated.path)}
      >
        <img src={picture} alt="" />
        {/* The tooltip shows the picture larger, above it, with its name. */}
        <Tooltip yDir="above">
          <span className="wedyan-motions-source-tip">
            <img src={picture} alt="" />
            <span>{source.name}</span>
          </span>
        </Tooltip>
      </Button>
      <Select size="sm" label="Model" options={models} value={$bind(regeneration, 'model')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <AutoAwesomeIcon /> <span>{models[value as keyof typeof models]}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
      <Show
        when={() => source.type === 'take'}
        fallback={() => (
          <Stepper
            size="sm"
            label="Attempts"
            decrementLabel="Fewer attempts"
            incrementLabel="More attempts"
            min={1}
            max={4}
            value={$bind(regeneration, 'attempts')}
          />
        )}
      >
        {() => (
          <Stepper
            size="sm"
            label="Seconds"
            decrementLabel="Shorter"
            incrementLabel="Longer"
            min={2}
            max={10}
            value={$bind(regeneration, 'seconds')}
          />
        )}
      </Show>
    </>
  );
}, 'RegenerateOptions');

/** The open stage's transport: to the start, a frame back, play or pause, a frame on, to the end. */
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
      {action('To the start', <ToStartIcon />, () => timeline.scrub(timeline.startFrame ?? 0))}
      {action('A frame back', <FrameBackIcon />, () => timeline.step(-1))}
      <Snippet>
        {() =>
          timeline.state.status === 'playing'
            ? action('Pause', <PauseIcon />, () => timeline.pause())
            : action('Play', <PlayIcon />, () => timeline.play())
        }
      </Snippet>
      {action('A frame on', <FrameForwardIcon />, () => timeline.step(1))}
      {action('To the end', <ToEndIcon />, () => timeline.scrub(timeline.totalFrames))}
    </>
  );
}, 'Transport');
