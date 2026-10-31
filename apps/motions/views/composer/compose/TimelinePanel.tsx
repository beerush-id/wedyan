import { $bind, $use, Snippet, setup } from '@airlib/react';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import { Menu, TimelineEditor, type TimelineLaneCommand, type TimelineLaneDrop } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import { AddIcon } from '../../icons.js';
import { type Composer, composerCtx } from '../context.js';
import { buffers } from '../media.js';
import { addTrack, placeBox, placeOnStage, placeShape, placeTitle, TRACK_NAMES, type TrackType } from '../placement.js';
import { AssigneeAvatar, clipAssignee } from './assignment.js';
import { ASSET_DRAG } from './Sources.js';

const TRACK_KINDS = Object.entries(TRACK_NAMES).map(([name, label]) => ({ name, label: `${label} track` }));

/** What an empty spot on a track offers, by the track's type: a new clip of its kind there. */
const LANE_COMMANDS: Record<string, { name: string; label: string }[]> = {
  title: [{ name: 'add-title', label: 'Add title here' }],
  html: [{ name: 'add-box', label: 'Add box here' }],
  svg: [{ name: 'add-shape', label: 'Add shape here' }],
};

/** What each lane command puts at its point. */
const LANE_PLACERS: Record<string, typeof placeTitle> = { 'add-title': placeTitle, 'add-box': placeBox, 'add-shape': placeShape };

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
    const asset = composer.motion?.assets.find((each) => each.id === data.getData(ASSET_DRAG));
    if (asset) placeOnStage(composer, asset, { track, frame });
  };

  const laneCommand = (event: CustomEvent<TimelineLaneCommand>) => {
    const { name, track, frame } = event.detail;
    const placer = LANE_PLACERS[name];
    const { stage, timeline } = composer;
    if (placer && stage && timeline) composer.clips = [placer(timeline, stage.composition.props, { track, frame }).id];
  };

  return () => {
    const timeline = composer.timeline as Timeline;
    return (
    <WindowPanel role="region" aria-label="Timeline" className="wedyan-compose-timeline">
      <TimelineEditor
        label={`Clips in ${composer.stage?.name}`}
        timeline={timeline}
        value={$bind(composer, 'clips')}
        multiple
        snap={$use(() => composer.snap)}
        autofocus
        progress={buffering}
        playheadLabel="Playhead"
        zoom={56}
        laneCommands={(track) => LANE_COMMANDS[track.type ?? '']}
        onlanecommand={laneCommand}
        onlanedrop={dropAsset}
      >
        {/* Who a clip is assigned to, on the clip. */}
        <TimelineEditor.Snippet for="adornment">
          {(segment: TimelineSegment) => {
            const agent = clipAssignee(composer.path, segment);
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
                  <span className="wedyan-compose-timecode" aria-label="Playhead timecode">
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
