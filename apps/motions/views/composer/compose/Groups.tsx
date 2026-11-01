import { sampleSegment } from '@airlib/aria';
import { $bind, $static, setup, Snippet } from '@airlib/react';
import type { Timeline } from '@airlib/react/timeline';
import { Slider, Stepper, StepperInput, Tooltip } from '@airlib/react-aui';
import type { FC } from 'react';
import { type Composer, composerCtx } from '../context.js';
import { clipFrame, keyedFrames, timelineFrame, toggleKeyframe, writeValue } from './keyframes.js';

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
export const Groups = setup<{ groups: Group[] }>((props) => {
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
        const frames = keyedFrames(
          segment,
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
      const value =
        segment &&
        ((sampleSegment(segment, (composer.timeline as Timeline).state.frame) as Record<string, number | undefined>)[
          key
        ] ??
          fallback);
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
      {range && (
        <Slider size="xs" aria-label={label} min={range[0]} max={range[1]} step={step} value={$bind(field, 'value')} />
      )}
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
