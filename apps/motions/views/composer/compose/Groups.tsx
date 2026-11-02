import { $bind, type AnyType, effect, setup, Snippet, template } from '@airlib/react';
import type { Timeline } from '@airlib/react/timeline';
import { Select, Slider, Stepper, StepperAdjuster, StepperInput, Tooltip } from '@airlib/react-aui';
import type { FC, ReactNode } from 'react';
import { type Composer, composerCtx, type Picked } from '../context.js';
import {
  clipFrame,
  createReading,
  holderOf,
  type KeyedGroup,
  keyedFrames,
  type Reading,
  setValue,
  timelineFrame,
  toggleKeyframe,
} from './keyframes.js';

/**
 * A value of a clip its keyframes can animate: its name, its glyph, what it reads as when the clip
 * doesn't set it, how it steps, and how many steps a pixel of a drag moves. One with a `range` is
 * also dragged along a slider across it.
 */
export type Field = {
  key: string;
  label: string;
  icon: FC;
  fallback?: number;
  step: number;
  rate?: number;
  min?: number;
  max?: number;
  range?: [number, number];
};

/** Values of a clip laid out, and keyed, together under one name. */
export type Group = { label: string; fields: Field[] };

/** The GSAP eases a keyframe's picker offers, by what they're called. */
const EASES = {
  none: 'Linear',
  'power2.in': 'Ease in',
  'power2.out': 'Ease out',
  'power2.inOut': 'Ease in and out',
  'expo.out': 'Expo out',
  'back.out': 'Back',
  'elastic.out': 'Elastic',
  'bounce.out': 'Bounce',
};

/** A clip's keyed values, a group under its name for each, keyed together. */
export const Groups = template<{ groups: Group[] }>(
  ({ groups }) => (
    <div className="wedyan-compose-properties-fields">
      {groups.map((group) => (
        <GroupView key={group.label} group={group} />
      ))}
    </div>
  ),
  'Groups',
);

/**
 * A group of values at the playhead. It holds their reading: what the playhead reads there, for the
 * keyframe diamond and its fields to make a fact.
 */
const GroupView = setup<{ group: Group }>((props) => {
  const reading = createReading(composerCtx.get() as Composer, () => props.group.fields);

  return ({ group }) => (
    <fieldset aria-label={group.label} className="wedyan-compose-property-group">
      <div className="wedyan-compose-property-head pi-sm">
        <span className="wedyan-compose-property-label" aria-hidden="true">
          {group.label}
        </span>
        <Keyframes group={group} reading={reading} />
      </div>
      <div className="wedyan-compose-property-body">
        {group.fields.map((field) => (
          <FieldView key={field.key} field={field} reading={reading} />
        ))}
      </div>
    </fieldset>
  );
}, 'GroupView');

/** One value on a line of its own: its name beside its input, its keyframes above that. */
export const KeyedLine = setup<{
  group: KeyedGroup & { label: string };
  children: (value: AnyType, edit: () => void) => ReactNode;
}>((props) => {
  const reading = createReading(composerCtx.get() as Composer, () => props.group.fields);

  return ({ group, children }) => (
    <fieldset aria-label={group.label} className="wedyan-compose-property-group">
      <div className="wedyan-compose-property-head">
        <Keyframes group={group} reading={reading} />
      </div>
      <div className="wedyan-compose-property-row pis-sm">
        <span>{group.label}</span>
        <KeyedValue name={group.fields[0].key} reading={reading}>
          {children}
        </KeyedValue>
      </div>
    </fieldset>
  );
}, 'KeyedLine');

/**
 * A group's keyframes at the playhead: the diamond, filled while the group has a keyframe there,
 * adds one with the reading or takes it off; either side, a step to the keyframe before or after,
 * inert while there's none; and on a keyframe, its ease.
 */
const Keyframes = setup<{ group: KeyedGroup & { label: string }; reading: Reading }>((props) => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <Snippet>
      {() => {
        void composer.edits;
        const clip = composer.hostClip();
        const timeline = composer.timeline as Timeline;
        if (!clip) return null;
        const keyed = composer.picked() as Picked;
        const { group } = props;
        const at = clipFrame(clip, timeline.state.frame);
        const frames = keyedFrames(
          clip,
          keyed,
          group.fields.map((field) => field.key),
        );
        const before = frames.findLast((frame) => frame < at);
        const after = frames.find((frame) => frame > at);
        const point = frames.includes(at) ? keyed.scenes.find((scene) => scene.atFrame === at) : undefined;
        return (
          <span className="wedyan-compose-keyframes">
            {point && <EasePicker key={point.id} scene={point} label={`${group.label}: ease`} />}
            <button
              type="button"
              className="wedyan-compose-keyframe-step"
              data-dir="before"
              aria-label={`${group.label}: previous keyframe`}
              disabled={before === undefined}
              onClick={() => before !== undefined && void timeline.scrub(timelineFrame(clip, before))}
            />
            <button
              type="button"
              className="wedyan-compose-keyframe"
              aria-label={`${group.label}: keyframe`}
              aria-pressed={frames.includes(at)}
              onClick={() => {
                toggleKeyframe(clip, keyed, group, at, props.reading);
                composer.edited();
              }}
            />
            <button
              type="button"
              className="wedyan-compose-keyframe-step"
              data-dir="after"
              aria-label={`${group.label}: next keyframe`}
              disabled={after === undefined}
              onClick={() => after !== undefined && void timeline.scrub(timelineFrame(clip, after))}
            />
          </span>
        );
      }}
    </Snippet>
  );
}, 'Keyframes');

/** The ease of the point at the playhead: how its values leave it for their next points. */
const EasePicker = setup<{ scene: Picked['scenes'][number]; label: string }>((props) => {
  const composer = composerCtx.get() as Composer;

  // It's a point's ease to manage, and a point needn't have any `meta` yet.
  effect(() => {
    if (!props.scene.meta) {
      props.scene.meta = {};
    }
  });

  return ({ scene, label }) => (
    <Select
      size="xs"
      variant="text"
      label={label}
      options={EASES}
      value={$bind(scene.meta as Record<string, AnyType>, 'ease')}
      onchange={composer.edited}
    >
      <Select.Snippet for="trigger">{(ease) => EASES[(ease ?? 'none') as keyof typeof EASES] ?? ease}</Select.Snippet>
    </Select>
  );
}, 'EasePicker');

/** One value at the playhead: its number, and a slider beside it when it has a range. */
const FieldView = template<{ field: Field; reading: Reading }>(
  ({ field: { key, label, icon: Icon, step, rate, min, max, range }, reading }) => (
    <KeyedValue name={key} reading={reading}>
      {(value, edit) => (
        <>
          {range && (
            <Slider size="xs" aria-label={label} min={range[0]} max={range[1]} step={step} value={value} onInput={edit} />
          )}
          <Stepper size="xs" label={label} step={step} min={min} max={max} value={value} onInput={edit}>
            <StepperAdjuster rate={rate}>
              <Icon />
            </StepperAdjuster>
            <StepperInput aria-label={label} />
            <Tooltip>{label}</Tooltip>
          </Stepper>
        </>
      )}
    </KeyedValue>
  ),
  'FieldView',
);

/**
 * Hands an input a value at the playhead: bound to what holds it there, and what to call as it's
 * written. Until something holds it, that's the reading, and a write to that makes it a fact, held
 * from then on. One write is one value; keying a group is the diamond's. An input's job doesn't
 * change with what it is.
 */
export const KeyedValue = setup<{
  name: string;
  reading: Reading;
  children: (value: AnyType, edit: () => void) => ReactNode;
}>(() => {
  const composer = composerCtx.get() as Composer;

  return ({ name, reading, children }) => {
    void composer.edits;
    // A picked track holds values with no time of its own: its clip is none, and its frame is any.
    const clip = composer.hostClip();
    const keyed = composer.picked() as Picked;
    const at = clip ? clipFrame(clip, (composer.timeline as Timeline).state.frame) : 0;
    const holder = holderOf(keyed, name, at);
    const edit = () => {
      if (!holder) setValue(clip, keyed, at, name, reading[name] as number | string);
      composer.edited();
    };

    return children($bind((holder ?? reading) as Record<string, AnyType>, name), edit);
  };
}, 'KeyedValue');
