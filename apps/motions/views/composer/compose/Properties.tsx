import { $bind, $static, Show, Snippet, setup } from '@airlib/react';
import { sampleSegment, type Timeline, type TimelineSegment } from '@airlib/react/timeline';
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
  TextInput,
  Toggle,
  ToggleGroup,
  Tooltip,
} from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import {
  FormatAlignCenterIcon,
  FormatAlignLeftIcon,
  FormatAlignRightIcon,
  FormatBoldIcon,
  FormatItalicIcon,
  FormatUnderlinedIcon,
  TitleIcon,
} from '@airlib/react-aui/icons';
import type { ChangeEvent, FC } from 'react';
import {
  BalanceIcon,
  HeightIcon,
  LayerIcon,
  OpacityIcon,
  PropertiesIcon,
  RotateIcon,
  ScaleIcon,
  SoundIcon,
  TextIcon,
  VolumeIcon,
  WidthIcon,
  XIcon,
  YIcon,
} from '../../icons.js';
import type { ClipSound, TitleClip } from '../composition.js';
import { type Composer, composerCtx } from '../context.js';
import { clipAssignee } from './assignee.js';
import { AssigneeAvatar } from './assignment.js';
import { clipFrame, keyedFrames, timelineFrame, toggleKeyframe, writeValue } from './keyframes.js';

/**
 * A value of a clip its keyframes can animate: its name, its glyph, what it reads as when the clip
 * doesn't set it, and how it steps. One with a `range` is also dragged along a slider across it.
 */
type Field = { key: string; label: string; icon: FC; fallback?: number; step: number; min?: number; max?: number; range?: [number, number] };

/** Values of a clip laid out, and keyed, together under one name. */
type Group = { label: string; fields: Field[] };

/** The box's values in named groups, as the panel lays them out. */
const BOX_GROUPS: Group[] = [
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
  { label: 'Rotation', fields: [{ key: 'rotate', label: 'Rotation', icon: RotateIcon, fallback: 0, step: 1, range: [-180, 180] }] },
  { label: 'Opacity', fields: [{ key: 'opacity', label: 'Opacity', icon: OpacityIcon, fallback: 1, step: 0.05, min: 0, max: 1, range: [0, 1] }] },
];

/** A clip's sound levels, each keyed on its own: how loud, and where between the speakers. */
const SOUND_GROUPS: Group[] = [
  { label: 'Volume', fields: [{ key: 'volume', label: 'Volume', icon: VolumeIcon, fallback: 1, step: 0.05, min: 0, max: 1, range: [0, 1] }] },
  { label: 'Balance', fields: [{ key: 'pan', label: 'Balance', icon: BalanceIcon, fallback: 0, step: 0.05, min: -1, max: 1, range: [-1, 1] }] },
];

/** A clip with a box: a sound has none. */
const hasBox = (segment?: TimelineSegment) => !!segment && segment.type !== 'audio';

/** A clip with sound: footage, or a sound. */
const hasSound = (segment?: TimelineSegment) => segment?.type === 'video' || segment?.type === 'audio';

/** The picked clip when it has words: a title. */
const titleOf = (segment?: TimelineSegment) => (segment?.type === 'title' ? (segment as TimelineSegment<TitleClip>) : undefined);

/** A title's `font` when it hasn't one, and its parts: italic, weight, size in stage units, and the rest. */
const DEFAULT_FONT = '500 48px/1.2 system-ui, sans-serif';
const FONT_PARTS = /^(italic )?(\d+) ([\d.]+)px(.*)$/;

/** The weights a title is set in. */
const WEIGHT = { REGULAR: 500, BOLD: 700 };

/** Where each alignment puts a title's line in its box, as well as its words. */
const ALIGNMENTS = { left: 'start', center: 'center', right: 'end' };

type Alignment = keyof typeof ALIGNMENTS;

/**
 * The picked clip's properties, by kind on tabs: Layer holds its box, Audio its sound, each value
 * shown at the playhead, and Text a title's words and how they're set. Everything here reads the
 * picked clip from the composer, so picking another just shows it.
 */
export const Properties = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <WindowPanel role="region" aria-label="Properties" className="wedyan-compose-group wedyan-compose-properties">
      <Assigned />
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
          <Show
            when={() => hasBox(composer.pickedClip())}
            fallback={() => (
              <EmptyState size="sm" title="No clip picked" description="Pick one clip on the timeline to edit its box.">
                <EmptyState.Snippet for="icon">{() => <PropertiesIcon />}</EmptyState.Snippet>
              </EmptyState>
            )}
          >
            {() => <Groups groups={BOX_GROUPS} />}
          </Show>
        </TabPanel>
        <TabPanel name="audio">
          <Show
            when={() => hasSound(composer.pickedClip())}
            fallback={() => (
              <EmptyState size="sm" title="No sound picked" description="Pick one video or audio clip to set its sound.">
                <EmptyState.Snippet for="icon">{() => <SoundIcon />}</EmptyState.Snippet>
              </EmptyState>
            )}
          >
            {() => <Sound />}
          </Show>
        </TabPanel>
        <TabPanel name="text">
          <Show
            when={() => titleOf(composer.pickedClip())}
            fallback={() => (
              <EmptyState size="sm" title="No text picked" description="Pick one title clip to edit its words.">
                <EmptyState.Snippet for="icon">{() => <TextIcon />}</EmptyState.Snippet>
              </EmptyState>
            )}
          >
            {(clip) => <TitleText key={clip.id} clip={clip} />}
          </Show>
        </TabPanel>
      </Tabs>
    </WindowPanel>
  );
}, 'Properties');

/** Who the picked clip is assigned to, over what can be changed on it. */
const Assigned = setup(() => {
  const composer = composerCtx.get() as Composer;
  const agent = () => {
    const segment = composer.pickedClip();
    return segment && clipAssignee(composer, segment);
  };

  return () => (
    <Snippet data={agent}>
      {(assignee) =>
        assignee ? (
          <div className="wedyan-compose-assignee">
            <span>Assigned to</span>
            <span className="wedyan-compose-assignee-agent">
              <AssigneeAvatar assignee={assignee} size="xs" />
              <span>{assignee.name}</span>
            </span>
          </div>
        ) : null
      }
    </Snippet>
  );
}, 'Assigned');

/** The picked clip's sound: whether it's heard, then its volume and balance, keyed like its box. */
const Sound = setup(() => {
  const composer = composerCtx.get() as Composer;
  const muted = {
    get value() {
      return (composer.pickedClip() as TimelineSegment<ClipSound> | undefined)?.props.muted;
    },
    set value(value: boolean | undefined) {
      const clip = composer.pickedClip() as TimelineSegment<ClipSound> | undefined;
      if (clip) clip.props.muted = value;
    },
  };

  return () => (
    <div className="wedyan-compose-properties-fields">
      <fieldset aria-label="Sound" className="wedyan-compose-property-group">
        <div className="wedyan-compose-property-head">
          <span className="wedyan-compose-property-label" aria-hidden="true">
            Sound
          </span>
        </div>
        <div className="wedyan-compose-property-row">
          <span id="wedyan-compose-mute">Mute</span>
          <Switch size="xs" aria-labelledby="wedyan-compose-mute" checked={$bind(muted, 'value')} />
        </div>
      </fieldset>
      <Groups groups={SOUND_GROUPS} />
    </div>
  );
}, 'Sound');

/** A title's words and how they're set, each read and written on the clip itself. */
const TitleText = setup<{ clip: TimelineSegment<TitleClip> }>((props) => {
  const clip = $static(() => props.clip);
  const style = () => {
    clip.props.style ??= {};
    return clip.props.style;
  };
  const font = () => (FONT_PARTS.exec(String(clip.props.style?.font)) ?? FONT_PARTS.exec(DEFAULT_FONT)) as RegExpExecArray;
  const setFont = (italic: unknown, weight: number | string, size: number | string) => {
    style().font = `${italic ? 'italic ' : ''}${weight} ${size}px${font()[4]}`;
  };
  const setColor = (event: ChangeEvent<HTMLInputElement>) => {
    style().color = event.currentTarget.value;
  };

  const look = {
    get size() {
      return Number(font()[3]);
    },
    set size(size: number | undefined) {
      if (size) setFont(font()[1], font()[2], size);
    },
    get bold() {
      return Number(font()[2]) >= WEIGHT.BOLD;
    },
    set bold(bold: boolean | undefined) {
      setFont(font()[1], bold ? WEIGHT.BOLD : WEIGHT.REGULAR, font()[3]);
    },
    get italic() {
      return Boolean(font()[1]);
    },
    set italic(italic: boolean | undefined) {
      setFont(italic, font()[2], font()[3]);
    },
    get underline() {
      return clip.props.style?.textDecoration === 'underline';
    },
    set underline(underline: boolean | undefined) {
      style().textDecoration = underline ? 'underline' : 'none';
    },
    get align() {
      return (clip.props.style?.textAlign ?? 'center') as Alignment;
    },
    set align(align: Alignment) {
      Object.assign(style(), { textAlign: align, placeItems: `center ${ALIGNMENTS[align]}` });
    },
  };

  return () => (
    <div className="wedyan-compose-properties-fields">
      <TextInput size="sm" label="Words" multiline rows={3} value={$bind(clip.props, 'text')} />
      <fieldset aria-label="Font" className="wedyan-compose-property-group">
        <div className="wedyan-compose-property-head">
          <span className="wedyan-compose-property-label" aria-hidden="true">
            Font
          </span>
        </div>
        <div className="wedyan-compose-property-row">
          <Stepper size="xs" label="Size" step={1} min={1} value={$bind(look, 'size')}>
            <TitleIcon />
            <StepperInput aria-label="Size" />
            <Tooltip>Size</Tooltip>
          </Stepper>
          <ToggleGroup aria-label="Format" size="xs" multiple>
            <Toggle aria-label="Bold" pressed={$bind(look, 'bold')}>
              <FormatBoldIcon />
              <Tooltip>Bold</Tooltip>
            </Toggle>
            <Toggle aria-label="Italic" pressed={$bind(look, 'italic')}>
              <FormatItalicIcon />
              <Tooltip>Italic</Tooltip>
            </Toggle>
            <Toggle aria-label="Underline" pressed={$bind(look, 'underline')}>
              <FormatUnderlinedIcon />
              <Tooltip>Underline</Tooltip>
            </Toggle>
          </ToggleGroup>
        </div>
        <div className="wedyan-compose-property-row">
          <span>Align</span>
          <ToggleGroup aria-label="Align" size="xs" value={$bind(look, 'align')} required>
            <Toggle value="left" aria-label="Left">
              <FormatAlignLeftIcon />
              <Tooltip>Left</Tooltip>
            </Toggle>
            <Toggle value="center" aria-label="Center">
              <FormatAlignCenterIcon />
              <Tooltip>Center</Tooltip>
            </Toggle>
            <Toggle value="right" aria-label="Right">
              <FormatAlignRightIcon />
              <Tooltip>Right</Tooltip>
            </Toggle>
          </ToggleGroup>
        </div>
        <div className="wedyan-compose-property-row">
          <span>Color</span>
          <Snippet data={() => String(clip.props.style?.color ?? '#ffffff')}>
            {(color) => <input type="color" aria-label="Color" className="wedyan-compose-color" value={color} onChange={setColor} />}
          </Snippet>
        </div>
      </fieldset>
    </div>
  );
}, 'TitleText');

/** A clip's keyed values, a group under its name for each, keyed together. */
const Groups = setup<{ groups: Group[] }>((props) => {
  return () => (
    <div className="wedyan-compose-properties-fields">
      {props.groups.map((group) => (
        <fieldset key={group.label} aria-label={group.label} className="wedyan-compose-property-group">
          <div className="wedyan-compose-property-head">
            <span className="wedyan-compose-property-label" aria-hidden="true">
              {group.label}
            </span>
            <Keyframes group={group} />
          </div>
          <div className="wedyan-compose-property-body">
            {group.fields.map((field) => (
              <FieldView key={field.key} field={field} />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}, 'Groups');

/**
 * A group's keyframes at the playhead: the diamond, filled while the group has a keyframe there,
 * adds one with the values it has now or takes it off; either side, a step to the keyframe before
 * or after, inert while there's none.
 */
const Keyframes = setup<{ group: Group }>((props) => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <Snippet>
      {() => {
        void composer.edits;
        const segment = composer.pickedClip();
        const timeline = composer.timeline as Timeline;
        if (!segment) return null;
        const { group } = props;
        const at = clipFrame(segment, timeline.state.frame);
        const frames = keyedFrames(segment, group.fields.map((field) => field.key));
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
                edited(composer);
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
}, 'Keyframes');

/** One value of the picked clip: its number, and a slider beside it when it has a range. */
const FieldView = setup<{ field: Field }>((props) => {
  const composer = composerCtx.get() as Composer;
  // A field is the panel's own constant, never data.
  const { key, fallback, step, label, icon: Icon, min, max, range } = $static(() => props.field);
  const digits = Math.max(0, -Math.floor(Math.log10(step)));

  // Read at the playhead, to the field's own step rather than a tweened fraction, and written there.
  const field = {
    get value() {
      void composer.edits;
      const segment = composer.pickedClip();
      const value = segment && ((sampleSegment(segment, (composer.timeline as Timeline).state.frame) as Record<string, number | undefined>)[key] ?? fallback);
      return value === undefined ? value : Number(value.toFixed(digits));
    },
    set value(value: number | undefined) {
      const segment = composer.pickedClip();
      if (value === undefined || !segment) return;
      writeValue(segment, key, value, (composer.timeline as Timeline).state.frame);
      edited(composer);
    },
  };

  return () => (
    <>
      {range && <Slider size="xs" aria-label={label} min={range[0]} max={range[1]} step={step} value={$bind(field, 'value')} />}
      <Stepper size="xs" label={label} step={step} min={min} max={max} value={$bind(field, 'value')}>
        <Icon />
        <StepperInput aria-label={label} />
        <Tooltip>{label}</Tooltip>
      </Stepper>
    </>
  );
}, 'FieldView');

/**
 * Shows an edit to a clip: on what reads its keyframes, and on the stage, which draws a frame only
 * as the timeline reaches it, so while paused it draws the frame again.
 *
 * @param composer - The window's composer.
 */
function edited(composer: Composer): void {
  composer.edits += 1;
  const { timeline } = composer;
  if (timeline && timeline.status !== 'playing') void timeline.scrub(timeline.frame);
}
