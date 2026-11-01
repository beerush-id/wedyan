import { splitSegment } from '@airlib/aria';
import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, setup, Show, Snippet, template } from '@airlib/react';
import type { Timeline } from '@airlib/react/timeline';
import { Button, Divider, Toggle, Toolbar, Tooltip } from '@airlib/react-aui';
import {
  AudioFileIcon,
  AutoAwesomeIcon,
  CodeIcon,
  DraftIcon,
  MovieIcon,
  TitleIcon,
} from '@airlib/react-aui/icons';
import type { FC, ReactNode } from 'react';
import { LoopIcon, PauseIcon, PlayIcon, RedoIcon, SnapIcon, SplitIcon, ToEndIcon, ToStartIcon, UndoIcon } from '../../icons.js';
import { type Composer, composerCtx } from '../context.js';
import { GeneratedTile, RegenerateOptions, SubjectTile } from '../dock/Regenerate.js';

/** A lane's glyph, by its track's type, for a clip without a picture of its own. */
const LANE_GLYPHS: Record<string, FC> = {
  video: MovieIcon,
  audio: AudioFileIcon,
  title: TitleIcon,
  html: CodeIcon,
  painter: AutoAwesomeIcon,
};

/** Compose's options in the dock: how a picked generated clip is made again, the transport, snapping and splitting. */
export const ComposeDock = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => {
    const { timeline } = composer;
    if (!timeline) return null;
    return (
      <Toolbar label="Motion settings" variant="text" className={AUI_CLASS.TOOLBAR_OPTIONS}>
        <Snippet data={() => composer.generativeClip()}>
          {(generated) => (generated ? <RegenerateOptions generated={generated} /> : null)}
        </Snippet>
        <Show when={() => composer.generativeClip()}>
          {() => <Divider orientation="vertical" size="sm" className="wedyan-motions-options-divider" />}
        </Show>
        <Transport timeline={timeline} />
        <Divider orientation="vertical" size="sm" className="wedyan-motions-options-divider" />
        <UndoRedo />
        <Toggle aria-label="Snap" size="sm" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(composer, 'snap')}>
          <SnapIcon />
          <Tooltip>Snap</Tooltip>
        </Toggle>
        <Button
          aria-label="Split"
          size="sm"
          variant="text"
          className={AUI_CLASS.CONTROL_ICON}
          onClick={() => splitPicked(composer)}
        >
          <SplitIcon />
          <Tooltip>Split at the playhead (⌘B)</Tooltip>
        </Button>
      </Toolbar>
    );
  };
}, 'ComposeDock');

/** What Compose's options act on: the picked clip, as what it was generated from when it was. */
export const ComposeSubject = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => {
    const generated = composer.generativeClip();
    if (generated) return <GeneratedTile source={generated.source} />;
    const segment = composer.hostClip();
    if (!segment) return null;
    return (
      <SubjectTile
        name={composer.picked()?.name ?? 'Clip'}
        picture={segment.meta?.thumbnail as string | undefined}
        glyph={LANE_GLYPHS[segment.track.type ?? ''] ?? DraftIcon}
      />
    );
  };
}, 'ComposeSubject');

/** The stage's transport: to the clip before, play or pause, to the clip after, and whether it repeats. */
const Transport = template<{ timeline: Timeline }>(({ timeline }) => {
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
      <Toggle
        aria-label="Loop"
        size="sm"
        className={AUI_CLASS.CONTROL_ICON}
        pressed={$bind(timeline as { repeat?: boolean }, 'repeat')}
      >
        <LoopIcon />
        <Tooltip>Loop</Tooltip>
      </Toggle>
    </>
  );
}, 'Transport');

/** Taking back what was done to the stage, and putting it back, each inert with nothing to do. */
const UndoRedo = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <>
      <Button
        aria-label="Undo"
        size="sm"
        variant="text"
        className={AUI_CLASS.CONTROL_ICON}
        disabled={!composer.stageHistory?.canBackward}
        onClick={composer.undo}
      >
        <UndoIcon />
        <Tooltip>Undo (⌘Z)</Tooltip>
      </Button>
      <Button
        aria-label="Redo"
        size="sm"
        variant="text"
        className={AUI_CLASS.CONTROL_ICON}
        disabled={!composer.stageHistory?.canForward}
        onClick={composer.redo}
      >
        <RedoIcon />
        <Tooltip>Redo (⇧⌘Z)</Tooltip>
      </Button>
    </>
  );
}, 'UndoRedo');

/**
 * Moves the playhead to where a clip starts, on any track: the nearest start before it, or after it.
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

/**
 * Cuts the picked clips in two at the playhead, as Cmd or Ctrl and B does on the timeline: each one
 * the playhead is inside of, unless its track is locked.
 *
 * @param composer - The window's composer.
 */
function splitPicked({ timeline, clips }: Composer): void {
  if (!timeline) return;
  const frame = timeline.state.frame;
  for (const track of timeline.tracks) {
    if (track.meta?.locked) continue;
    for (const segment of [...track.segments]) if (clips.includes(segment.id)) splitSegment(segment, frame);
  }
}
