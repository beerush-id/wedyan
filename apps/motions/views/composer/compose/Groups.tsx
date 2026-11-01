import { sampleSegment } from '@airlib/aria';
import { $bind, derived, setup, Snippet, template } from '@airlib/react';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import { Slider, Stepper, StepperInput, Tooltip } from '@airlib/react-aui';
import type { FC } from 'react';
import { type Composer, composerCtx, type Picked } from '../context.js';
import { clipFrame, holderOf, keyedFrames, setKeyframe, timelineFrame, toggleKeyframe } from './keyframes.js';

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

/** A group's values as the playhead reads them, by key. */
type Reading = Record<string, number | undefined>;

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
  const composer = composerCtx.get() as Composer;

  // To each field's own step rather than a tweened fraction. This runs once more as the pick clears,
  // before the panel goes.
  const reading = derived.as(() => {
    void composer.edits;
    const values: Reading = {};
    const clip = composer.hostClip();
    if (!clip) return values;
    const sampled = sampleSegment(clip, (composer.timeline as Timeline).state.frame, composer.picked());
    for (const { key, fallback, step } of props.group.fields) {
      const value = (sampled[key] ?? fallback) as number | undefined;
      values[key] = value === undefined ? value : toStep(value, step);
    }
    return values;
  });

  return ({ group }) => (
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

/**
 * A group's keyframes at the playhead: the diamond, filled while the group has a keyframe there,
 * adds one with the reading or takes it off; either side, a step to the keyframe before or after,
 * inert while there's none.
 */
const Keyframes = setup<{ group: Group; reading: Reading }>((props) => {
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

/**
 * One value at the playhead: its number, and a slider beside it when it has a range. It manages the
 * value of the keyframe there. Until that holds it, it shows the reading, and a write to that makes
 * it a fact: the keyframe, which holds it from then on.
 */
const FieldView = setup<{ field: Field; reading: Reading }>(() => {
  const composer = composerCtx.get() as Composer;

  return ({ field: { key, label, icon: Icon, step, min, max, range }, reading }) => {
    void composer.edits;
    const clip = composer.hostClip() as TimelineSegment;
    const keyed = composer.picked() as Picked;
    const at = clipFrame(clip, (composer.timeline as Timeline).state.frame);
    const holder = holderOf(keyed, key, at);
    const value = $bind((holder ?? reading) as Record<string, number>, key);
    const edit = () => {
      if (!holder) setKeyframe(clip, keyed, at, { [key]: reading[key] as number });
      composer.edited();
    };

    return (
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
    );
  };
}, 'FieldView');

/** A value as a field shows it: to the field's own step. */
function toStep(value: number, step: number): number {
  return Number(value.toFixed(Math.max(0, -Math.floor(Math.log10(step)))));
}
