import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, effect, onCleanup, Snippet, setup } from '@airlib/react';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import { Menu, TimelineEditor, type TimelineLaneCommand, type TimelineLaneDrop } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import { AddIcon } from '../../icons.js';
import { type Composer, composerCtx, zoomWithin } from '../context.js';
import { addGenerated, isGeneratedKind } from '../generated.js';
import { buffers } from '../media.js';
import { ASSET_DRAG, addTrack, placeBox, placeOnStage, placeShape, placeTitle, TRACK_NAMES, type TrackType } from '../placement.js';
import { clipAssignee } from './assignee.js';
import { AssigneeAvatar } from './assignment.js';
import { timelineFrame } from './keyframes.js';

const TRACK_KINDS = Object.entries(TRACK_NAMES).map(([name, label]) => ({ name, label: `${label} track` }));

/** What the timeline shows beside its lanes, and the variable carrying how long it runs, in seconds. */
const CORNER = 'aui-timeline-corner';
const TIMELINE_LENGTH = '--aria-timeline-length';

/** What shows beside the timeline while a clip is picked. */
const BESIDE = 'wedyan-compose-prompt';

/** What's left clear past the end when the timeline fits, in pixels: where it leads in, and a little room. */
const FIT_MARGIN = 48;

/** What an empty spot on a track offers, by the track's type: a new clip of its kind there. */
const LANE_COMMANDS: Record<string, { name: string; label: string }[]> = {
  video: [
    { name: 'still', label: 'New still here' },
    { name: 'take', label: 'New take here' },
  ],
  audio: [{ name: 'sound', label: 'New sound here' }],
  title: [{ name: 'add-title', label: 'Add title here' }],
  html: [
    { name: 'add-box', label: 'Add box here' },
    { name: 'add-shape', label: 'Add shape here' },
  ],
};

/** What each lane command puts at its point. */
const LANE_PLACERS: Record<string, typeof placeBox> = {
  'add-title': (timeline, _, at) => placeTitle(timeline, at),
  'add-box': placeBox,
  'add-shape': placeShape,
};

/**
 * How far a clip's media is through buffering, while it is, for the timeline to show on the clip.
 *
 * @param segment - The clip's segment.
 * @returns Its progress from 0 to 1, or nothing when it isn't buffering.
 */
const buffering = (segment: TimelineSegment): number | undefined => {
  const src = (segment.props as { src?: string }).src;
  const buffer = src ? buffers[src] : undefined;
  return buffer?.status === 'buffering' ? buffer.progress : undefined;
};

/**
 * A frame as a timecode: hours, minutes, seconds and the frame within its second, two digits each.
 *
 * @param frame - The frame, from the start.
 * @param frameRate - Frames a second.
 * @returns The timecode, e.g. `00:00:01:12`.
 */
const timecode = (frame: number, frameRate: number): string => {
  const seconds = Math.floor(frame / frameRate);
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, Math.round(frame % frameRate)];
  return parts.map((part) => String(part).padStart(2, '0')).join(':');
};

/** The stage's clips laid out in time: picked, dragged and added to here. */
export const TimelinePanel = setup(() => {
  const composer = composerCtx.get() as Composer;

  // An asset dragged from Sources onto a track goes there, at the frame it's let go on.
  const dropAsset = (event: CustomEvent<TimelineLaneDrop>) => {
    const { data, track, frame } = event.detail;
    const asset = composer.assets.find((each) => each.path === data.getData(ASSET_DRAG));
    if (asset) placeOnStage(composer, asset, { track, frame });
  };

  // A picked node's keyframes, in seconds, on its host; with a clip picked, the ruler marks the clip's itself.
  const pickedKeyframes = () => {
    void composer.edits;
    if (!composer.node) return;
    const clip = composer.hostClip() as TimelineSegment;
    const rate = (composer.timeline as Timeline).frameRate;
    return composer.picked()?.scenes.map((scene) => timelineFrame(clip, scene.atFrame) / rate);
  };

  // While it fits, the stage's whole length is shared out over the width there is, again whenever
  // either changes: a longer stage makes the timeline's body wider, which is heard here too.
  let panel: HTMLElement | null = null;
  const fit = () => {
    const editor = panel?.querySelector<HTMLElement>(`.${AUI_CLASS.TIMELINE_EDITOR}`);
    const corner = editor?.querySelector<HTMLElement>(`.${CORNER}`);
    const body = corner?.parentElement;
    if (!editor || !corner || !body) return;
    const seconds = Number.parseFloat(getComputedStyle(editor).getPropertyValue(TIMELINE_LENGTH));
    const side = corner.offsetWidth + Number.parseFloat(getComputedStyle(body).columnGap);
    if (seconds > 0) composer.zoom = zoomWithin((editor.clientWidth - side - FIT_MARGIN) / seconds);
  };
  // A panel beside it opens and closes with what's picked: picking a clip must not rescale them all.
  const resized = new ResizeObserver(() => {
    if (composer.fit && !panel?.parentElement?.querySelector(`.${BESIDE}`)) fit();
  });
  const watch = (element: HTMLElement | null) => {
    resized.disconnect();
    panel = element;
    if (!element) return;
    resized.observe(element);
    const body = element.querySelector(`.${CORNER}`)?.parentElement;
    if (body) resized.observe(body);
  };
  effect(() => {
    if (composer.fit) fit();
  });
  onCleanup(() => resized.disconnect());

  const laneCommand = (event: CustomEvent<TimelineLaneCommand>) => {
    const { name, track, frame } = event.detail;
    if (isGeneratedKind(name)) {
      void addGenerated(composer, name).then((asset) => {
        if (asset) placeOnStage(composer, asset, { track, frame });
      });
      return;
    }
    const placer = LANE_PLACERS[name];
    const { stage, timeline } = composer;
    if (placer && stage && timeline) composer.clips = [placer(timeline, stage.composition.props, { track, frame }).id];
  };

  return () => {
    const timeline = composer.timeline as Timeline;
    return (
    <WindowPanel ref={watch} role="region" aria-label="Timeline" className="wedyan-compose-timeline">
      <TimelineEditor
        label={`Clips in ${composer.stage?.name}`}
        timeline={timeline}
        value={$bind(composer, 'clips')}
        track={$bind(composer, 'track')}
        multiple
        snap={$use(() => composer.snap)}
        autofocus
        progress={buffering}
        playheadLabel="Playhead"
        keyframes={pickedKeyframes}
        zoom={$use(() => composer.zoom)}
        laneCommands={(track) => LANE_COMMANDS[track.type ?? '']}
        onlanecommand={laneCommand}
        onlanedrop={dropAsset}
      >
        {/* Who a clip is assigned to, on the clip. */}
        <TimelineEditor.Snippet for="adornment">
          {(segment: TimelineSegment) => {
            const agent = clipAssignee(composer, segment);
            return agent ? <AssigneeAvatar assignee={agent} size="xs" /> : null;
          }}
        </TimelineEditor.Snippet>
        {/* Adding a track, then the playhead's timecode, beside the ruler it reads. */}
        <TimelineEditor.Snippet for="corner">
          {() => (
            <>
              <Menu label="Add track" size="xs" variant="text" items={TRACK_KINDS} oncommand={(event) => addTrack(timeline, event.detail as TrackType)}>
                <Menu.Snippet for="trigger">{() => <AddIcon />}</Menu.Snippet>
              </Menu>
              <Snippet>
                {() => (
                  <span role="timer" className="wedyan-compose-timecode" aria-label="Playhead timecode">
                    {timecode(timeline.state.frame, timeline.frameRate)}
                  </span>
                )}
              </Snippet>
            </>
          )}
        </TimelineEditor.Snippet>
      </TimelineEditor>
    </WindowPanel>
    );
  };
}, 'TimelinePanel');
