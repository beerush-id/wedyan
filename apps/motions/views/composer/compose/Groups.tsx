import { $bind, type AnyType, setup, Snippet, template } from '@airlib/react';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import { Slider, Stepper, StepperInput, Tooltip } from '@airlib/react-aui';
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
 * doesn't set it, and how it steps. One with a `range` is also dragged along a slider across it.
 */
export type Field = {
  key: string;
  label: string;
  icon: FC;
  fallback?: number;
  step: number;
  min?: number;
  max?: number;
  range?: [number, number];
};

/** Values of a clip laid out, and keyed, together under one name. */
export type Group = { label: string; fields: Field[] };

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

  return ({ group }) =>
    group.fields.length === 1 ? (
      <ValueRow group={group} reading={reading}>
        <FieldView field={group.fields[0]} reading={reading} />
      </ValueRow>
    ) : (
      <fieldset aria-label={group.label} className="wedyan-compose-property-group">
        <div className="wedyan-compose-property-head">
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

/** A group of one value on one line: its name, what edits it, and its keyframes beside that. */
export const ValueRow = template<{ group: KeyedGroup & { label: string }; reading: Reading; children: ReactNode }>(
  ({ group, reading, children }) => (
    <fieldset aria-label={group.label} className="wedyan-compose-property-value">
      <span className="wedyan-compose-property-label" aria-hidden="true">
        {group.label}
      </span>
      {children}
      <Keyframes group={group} reading={reading} />
    </fieldset>
  ),
  'ValueRow',
);

/**
 * A group's keyframes at the playhead: the diamond, filled while the group has a keyframe there,
 * adds one with the reading or takes it off; either side, a step to the keyframe before or after,
 * inert while there's none.
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
        return (
          <span className="wedyan-compose-keyframes">
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

/** One value at the playhead: its number, and a slider beside it when it has a range. */
const FieldView = template<{ field: Field; reading: Reading }>(
  ({ field: { key, label, icon: Icon, step, min, max, range }, reading }) => (
    <KeyedValue name={key} reading={reading}>
      {(value, edit) => (
        <>
          {range && (
            <Slider size="xs" aria-label={label} min={range[0]} max={range[1]} step={step} value={value} onInput={edit} />
          )}
          <Stepper size="xs" label={label} step={step} min={min} max={max} value={value} onInput={edit}>
            <Icon />
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
  /** Where the value lives with no keyframes, when it isn't what's picked's `props`. */
  own?: Record<string, unknown>;
  children: (value: AnyType, edit: () => void) => ReactNode;
}>(() => {
  const composer = composerCtx.get() as Composer;

  return ({ name, reading, own, children }) => {
    void composer.edits;
    const clip = composer.hostClip() as TimelineSegment;
    const keyed = composer.picked() as Picked;
    const at = clipFrame(clip, (composer.timeline as Timeline).state.frame);
    const holder = holderOf(keyed, name, at, own);
    const edit = () => {
      if (!holder) setValue(clip, keyed, at, name, reading[name] as number | string, own);
      composer.edited();
    };

    return children($bind((holder ?? reading) as Record<string, AnyType>, name), edit);
  };
}, 'KeyedValue');
