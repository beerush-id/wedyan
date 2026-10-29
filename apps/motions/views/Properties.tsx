import { $bind, $static, mutable, Snippet, setup, template } from '@airlib/react';
import {
  EmptyState,
  Slider,
  Stepper,
  StepperInput,
  Switch,
  TabButton,
  TabList,
  TabPanel,
  Tabs,
  Tooltip,
} from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import { type MotionBox, sampleSegment, type Timeline, type TimelineSegment } from '@airlib/react/timeline';
import type { FC } from 'react';
import {
  BalanceIcon,
  HeightIcon,
  OpacityIcon,
  PropertiesIcon,
  LayerIcon,
  RotateIcon,
  ScaleIcon,
  SoundIcon,
  TextIcon,
  VolumeIcon,
  WidthIcon,
  XIcon,
  YIcon,
} from './icons.js';
import type { ClipSound } from './composition.js';
import { AssigneeAvatar, type Assignee, clipAssignee } from './assignment.js';
import { type MotionsSession, pickedClip, sessionCtx } from './session.js';

/**
 * A value of a clip its keyframes can animate — of its box, or its sound: its name, its glyph, what
 * it reads as when the clip doesn't set it, and how it steps. One with a `range` is also dragged
 * along a slider across it.
 */
type BoxField = {
  key: string;
  label: string;
  icon: FC;
  fallback?: number;
  step: number;
  min?: number;
  max?: number;
  range?: [number, number];
};

/** A clip being edited: its segment, the timeline it's on, and how many edits it has taken. */
type BoxEdit = { segment: TimelineSegment; timeline: Timeline; edits: { count: number } };

/** Values of a clip laid out, and keyed, together under one name. */
type BoxGroup = { label: string; fields: BoxField[] };

/** The box's values in named groups, as the panel lays them out. */
const BOX_GROUPS: BoxGroup[] = [
  {
    label: 'Transform',
    fields: [
      { key: 'width', label: 'Width', icon: WidthIcon, step: 1, min: 0 },
      { key: 'height', label: 'Height', icon: HeightIcon, step: 1, min: 0 },
      { key: 'x', label: 'X', icon: XIcon, fallback: 0, step: 1 },
      { key: 'y', label: 'Y', icon: YIcon, fallback: 0, step: 1 },
      { key: 'scale', label: 'Scale', icon: ScaleIcon, fallback: 1, step: 0.05, min: 0, range: [0, 3] },
    ],
  },
  {
    label: 'Rotation',
    fields: [{ key: 'rotate', label: 'Rotation', icon: RotateIcon, fallback: 0, step: 1, range: [-180, 180] }],
  },
  {
    label: 'Opacity',
    fields: [{ key: 'opacity', label: 'Opacity', icon: OpacityIcon, fallback: 1, step: 0.05, min: 0, max: 1, range: [0, 1] }],
  },
];

/** A clip's sound levels, each keyed on its own: how loud, and where between the speakers. */
const SOUND_GROUPS: BoxGroup[] = [
  {
    label: 'Volume',
    fields: [{ key: 'volume', label: 'Volume', icon: VolumeIcon, fallback: 1, step: 0.05, min: 0, max: 1, range: [0, 1] }],
  },
  {
    label: 'Balance',
    fields: [{ key: 'pan', label: 'Balance', icon: BalanceIcon, fallback: 0, step: 0.05, min: -1, max: 1, range: [-1, 1] }],
  },
];

/**
 * The picked clip's properties, by kind on tabs: Layer holds its box — where it sits on the stage,
 * its size, scale, rotation and opacity — each a field showing the value at the playhead. A value
 * the clip keeps is written into the clip; one its keyframes animate is written into the keyframe
 * at the playhead. Shows how to get there while no single drawn clip is picked.
 */
export const Properties = setup(() => {
  const session = sessionCtx.get() as MotionsSession;

  return () => (
    <WindowPanel role="region" aria-label="Properties" className="wedyan-compose-group wedyan-compose-properties">
      {/* Who the picked clip is assigned to, over what can be changed on it. */}
      <Snippet data={() => pickedAssignee(session)}>
        {(agent) =>
          agent ? (
            <div className="wedyan-compose-assignee">
              <span>Assigned to</span>
              <span className="wedyan-compose-assignee-agent">
                <AssigneeAvatar assignee={agent} size="xs" />
                <span>{agent.name}</span>
              </span>
            </div>
          ) : null
        }
      </Snippet>
      <Tabs size="xs" value="layer">
        <TabList label="Properties">
          <TabButton name="layer">
            <LayerIcon />
            <span>Layer</span>
          </TabButton>
          <TabButton name="audio">
            <SoundIcon />
            <span>Audio</span>
          </TabButton>
          <TabButton name="text">
            <TextIcon />
            <span>Text</span>
          </TabButton>
        </TabList>
        <TabPanel name="layer">
          <Snippet data={() => boxClip(session)}>
            {(segment) =>
              segment ? (
                <BoxFields key={segment.id} segment={segment} timeline={session.timeline as Timeline} groups={BOX_GROUPS} />
              ) : (
                <EmptyState size="sm" title="No clip picked" description="Pick one clip on the timeline to edit its box.">
                  <EmptyState.Snippet for="icon">{() => <PropertiesIcon />}</EmptyState.Snippet>
                </EmptyState>
              )
            }
          </Snippet>
        </TabPanel>
        <TabPanel name="audio">
          <Snippet data={() => soundClip(session)}>
            {(segment) =>
              segment ? (
                <SoundFields key={segment.id} segment={segment} timeline={session.timeline as Timeline} />
              ) : (
                <EmptyState size="sm" title="No sound picked" description="Pick one video or audio clip to set its sound.">
                  <EmptyState.Snippet for="icon">{() => <SoundIcon />}</EmptyState.Snippet>
                </EmptyState>
              )
            }
          </Snippet>
        </TabPanel>
      </Tabs>
    </WindowPanel>
  );
}, 'Properties');

/**
 * A clip's sound: whether it's heard, then its volume and its balance between the speakers, keyed
 * like the box — read at the playhead, written into its keyframe there — and heard as they change.
 */
const SoundFields = template<{ segment: TimelineSegment<ClipSound>; timeline: Timeline }>(({ segment, timeline }) => {
  const label = `wedyan-compose-mute-${segment.id}`;
  return (
    <div className="wedyan-compose-properties-fields">
      <div role="group" aria-label="Sound" className="wedyan-compose-property-group">
        <div className="wedyan-compose-property-head">
          <span className="wedyan-compose-property-label" aria-hidden="true">
            Sound
          </span>
        </div>
        <div className="wedyan-compose-property-row">
          <span id={label}>Mute</span>
          <Switch size="xs" aria-labelledby={label} checked={$bind(segment.props, 'muted')} />
        </div>
      </div>
      <BoxFields segment={segment} timeline={timeline} groups={SOUND_GROUPS} />
    </div>
  );
}, 'SoundFields');

/**
 * A clip's keyed values, a group under its name for each — transform, rotation and opacity for its
 * box; volume and balance for its sound — each group's fields on a grid of eight: the size and
 * place four to a row, and a ranged value a slider beside its number. Each field is its glyph and
 * its value at the playhead, named by a tooltip, and each group keys its values together.
 */
const BoxFields = setup<{ segment: TimelineSegment; timeline: Timeline; groups: BoxGroup[] }>((props) => {
  // Keyframes aren't observed, so what reads them follows the clip's edits by this count.
  const box: BoxEdit = { segment: $static(() => props.segment), timeline: $static(() => props.timeline), edits: mutable({ count: 0 }) };
  const groups = $static(() => props.groups);

  return () => (
    <div className="wedyan-compose-properties-fields">
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="wedyan-compose-property-group">
          <div className="wedyan-compose-property-head">
            <span className="wedyan-compose-property-label" aria-hidden="true">
              {group.label}
            </span>
            <Keyframes box={box} group={group} />
          </div>
          <div className="wedyan-compose-property-body">
            {group.fields.map((field) => (
              <BoxFieldView key={field.key} box={box} field={field} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}, 'BoxFields');

/**
 * A group's keyframes at the playhead: the diamond, filled while the group has a keyframe there,
 * adds one with the values it has now or takes it off; either side, a step to the group's keyframe
 * before or after, inert while there's none.
 */
const Keyframes = template<{ box: BoxEdit; group: BoxGroup }>(
  ({ box, group }) => {
    const { segment, timeline, edits } = box;
    const keys = group.fields.map((field) => field.key);
    return (
      <Snippet>
        {() => {
          void edits.count;
          const at = clipFrame(segment, timeline.state.frame);
          const frames = keyedFrames(segment, keys);
          const before = frames.findLast((frame) => frame < at);
          const after = frames.find((frame) => frame > at);
          return (
            <span className="wedyan-compose-keyframes">
              <button
                type="button"
                className="wedyan-compose-keyframe-step"
                data-dir="before"
                aria-label={`${group.label}: previous keyframe`}
                disabled={before === undefined}
                onClick={() => before !== undefined && void timeline.scrub(timelineFrame(segment, before))}
              />
              <button
                type="button"
                className="wedyan-compose-keyframe"
                aria-label={`${group.label}: keyframe`}
                aria-pressed={frames.includes(at)}
                onClick={() => {
                  toggleKeyframe(segment, group, at);
                  edited(box);
                }}
              />
              <button
                type="button"
                className="wedyan-compose-keyframe-step"
                data-dir="after"
                aria-label={`${group.label}: next keyframe`}
                disabled={after === undefined}
                onClick={() => after !== undefined && void timeline.scrub(timelineFrame(segment, after))}
              />
            </span>
          );
        }}
      </Snippet>
    );
  },
  'Keyframes'
);

/** One field of a box: its number, and a slider beside it when the value has a range. */
const BoxFieldView = template<{ box: BoxEdit; field: BoxField }>(
  ({ box, field }) => {
    const { label, icon: Icon, step, min, max, range } = field;
    const value = boxValue(box, field);
    return (
      <>
        {range && <Slider size="xs" aria-label={label} min={range[0]} max={range[1]} step={step} value={$bind(value, 'value')} />}
        <Stepper
          size="xs"
          label={label}
          step={step}
          min={min}
          max={max}
          value={$bind(value, 'value')}
        >
          <Icon />
          <StepperInput aria-label={label} />
          <Tooltip>{label}</Tooltip>
        </Stepper>
      </>
    );
  },
  'BoxFieldView'
);

/**
 * One value of a clip's box as a bindable value: read at the playhead, to the field's own step
 * rather than a tweened fraction, and written there.
 *
 * @param box - The box being edited.
 * @param field - The value.
 * @returns The value to bind a field to.
 */
function boxValue(box: BoxEdit, field: BoxField): { value: number | undefined } {
  const { segment, timeline, edits } = box;
  const { key, fallback, step } = field;
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  return {
    get value() {
      void edits.count;
      const value = sampleSegment(segment, timeline.state.frame)[key] ?? fallback;
      return value === undefined ? value : Number(value.toFixed(digits));
    },
    set value(value: number | undefined) {
      if (value === undefined) return;
      writeBox(segment, key, value, timeline.state.frame);
      edited(box);
    },
  };
}

/**
 * Shows an edit to a box: on what reads its keyframes, and on the stage, which draws a frame only
 * as the timeline reaches it, so while paused it draws the frame again.
 *
 * @param box - The box edited.
 */
function edited(box: BoxEdit): void {
  box.edits.count++;
  if (box.timeline.status !== 'playing') void box.timeline.scrub(box.timeline.frame);
}

/**
 * Writes a keyed value of a clip — of its box or its sound — at a timeline frame. A value no
 * keyframe animates is the clip's own; an animated one goes into the keyframe at that frame, or a
 * new keyframe there.
 *
 * @param segment - The clip's segment.
 * @param key - The value to write.
 * @param value - What it becomes.
 * @param frame - The timeline frame it's written at, held within the clip.
 */
function writeBox(segment: TimelineSegment,key: BoxField['key'], value: number, frame: number): void {
  if (!animated(segment, key)) {
    segment.props[key] = value;
    return;
  }

  const at = clipFrame(segment, frame);
  const scene = segment.scenes.find((each) => each.atFrame === at);
  if (scene) scene.data[key] = value;
  else addKeyframe(segment, at, { [key]: value });
}

/**
 * Keys a group of a clip's box at a frame of the clip, or unkeys it: a keyframe there that sets
 * any of the group's values gives them up, and goes once what it still sets changes nothing;
 * otherwise the group's values as they are there are keyed, into the keyframe there or a new one.
 *
 * @param segment - The clip's segment.
 * @param group - The group.
 * @param at - The frame, in the clip's content.
 */
function toggleKeyframe(segment: TimelineSegment,group: BoxGroup, at: number): void {
  const scene = segment.scenes.find((each) => each.atFrame === at);
  if (scene && group.fields.some((field) => field.key in scene.data)) {
    for (const field of group.fields) delete scene.data[field.key];
    dropIfIdle(segment, scene);
    return;
  }

  const sampled = sampleSegment(segment, timelineFrame(segment, at));
  const values: Record<string, number> = {};
  for (const { key, fallback } of group.fields) {
    const value = sampled[key] ?? fallback;
    if (value !== undefined) values[key] = value;
  }
  if (scene) Object.assign(scene.data, values);
  else addKeyframe(segment, at, values);
}

/**
 * Takes a keyframe off a clip when it changes nothing: when, without it, the clip already has
 * every value it sets at its frame — as a keyframe keyed for one value, holding the others only to
 * keep their course, does once that value is unkeyed.
 *
 * @param segment - The clip's segment.
 * @param scene - The keyframe.
 */
function dropIfIdle(segment: TimelineSegment,scene: TimelineSegment['scenes'][number]): void {
  const { atFrame, meta } = scene;
  const data = { ...scene.data };
  segment.removeScene(scene);

  const sampled = sampleSegment(segment, timelineFrame(segment, atFrame)) as Record<string, unknown>;
  const changes = Object.entries(data).some(([key, value]) =>
    typeof value === 'number' ? Math.abs(Number(sampled[key] ?? value) - value) > 1e-6 : sampled[key] !== value
  );
  if (!changes) return;

  segment.addScene({ atFrame, meta }, data);
  segment.sortScenes();
}

/**
 * Adds a keyframe to a clip. It takes every animated value the clip has at that frame, so the
 * values it doesn't set keep their course through it, then the given ones, and the ease of the
 * keyframe before it.
 *
 * @param segment - The clip's segment.
 * @param at - Where, in the clip's content.
 * @param values - The values it sets.
 */
function addKeyframe(segment: TimelineSegment,at: number, values: Record<string, number>): void {
  const sampled = sampleSegment(segment, timelineFrame(segment, at));
  const data: Record<string, number> = {};
  for (const each of segment.scenes) {
    for (const name of Object.keys(each.data)) data[name] = sampled[name as BoxField['key']] as number;
  }
  Object.assign(data, values);

  const before = segment.scenes.findLast((each) => each.atFrame < at);
  segment.addScene({ atFrame: at, meta: before?.meta ? { ...before.meta } : undefined }, data);
  segment.sortScenes();
}

/**
 * Where a timeline frame falls in a clip's content, held within the clip: the frame its keyframes
 * are placed by, which starts at its offset — past what a trim or a split cut off — and runs at its
 * speed.
 *
 * @param segment - The clip's segment.
 * @param frame - The timeline frame.
 * @returns The frame in the clip's content.
 */
function clipFrame(segment: TimelineSegment,frame: number): number {
  const within = Math.min(Math.max(frame - segment.startFrame, 0), segment.endFrame - segment.startFrame);
  return segment.offsetFrame + Math.round(within * segment.speed);
}

/**
 * The timeline frame a frame of a clip's content shows at: `clipFrame` the other way.
 *
 * @param segment - The clip's segment.
 * @param at - The frame in the clip's content.
 * @returns The timeline frame.
 */
function timelineFrame(segment: TimelineSegment,at: number): number {
  return segment.startFrame + Math.round((at - segment.offsetFrame) / segment.speed);
}

/**
 * The frames, in a clip's content and in order, of its keyframes that set any of some values and
 * fall within the clip: a split clip's halves share their keyframes, each showing its own stretch.
 *
 * @param segment - The clip's segment.
 * @param keys - The values.
 * @returns The frames.
 */
function keyedFrames(segment: TimelineSegment,keys: BoxField['key'][]): number[] {
  const first = clipFrame(segment, segment.startFrame);
  const last = clipFrame(segment, segment.endFrame);
  return segment.scenes
    .filter((scene) => scene.atFrame >= first && scene.atFrame <= last && keys.some((key) => key in scene.data))
    .map((scene) => scene.atFrame)
    .sort((a, b) => a - b);
}

/**
 * Whether a clip's keyframes animate one of its box's values.
 *
 * @param segment - The clip's segment.
 * @param key - The value.
 * @returns Whether any keyframe sets it.
 */
function animated(segment: TimelineSegment,key: BoxField['key']): boolean {
  return segment.scenes.some((scene) => key in scene.data);
}

/**
 * The agent the clip picked in a session is assigned to.
 *
 * @param session - The window's session.
 * @returns The agent, or nothing unless one clip, alone, is picked and it's assigned.
 */
function pickedAssignee(session: MotionsSession): Assignee | undefined {
  const segment = pickedClip(session);
  return segment && clipAssignee(session.stage, segment);
}

/**
 * The clip picked in a session, when it is the only one and is drawn: a sound has no box.
 *
 * @param session - The window's session.
 * @returns The clip's segment, or nothing unless one drawn clip, alone, is picked.
 */
function boxClip(session: MotionsSession): TimelineSegment<MotionBox> | undefined {
  const segment = pickedClip(session);
  return segment && segment.type !== 'audio' ? (segment as TimelineSegment<MotionBox>) : undefined;
}

/**
 * The clip picked in a session, when it is the only one and carries sound: footage, or a sound.
 *
 * @param session - The window's session.
 * @returns The clip's segment, or nothing unless one such clip, alone, is picked.
 */
function soundClip(session: MotionsSession): TimelineSegment<ClipSound> | undefined {
  const segment = pickedClip(session);
  return segment && (segment.type === 'video' || segment.type === 'audio') ? (segment as TimelineSegment<ClipSound>) : undefined;
}
