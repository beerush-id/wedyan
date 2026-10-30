import { template } from '@airlib/react';
import { Checkbox, Label } from '@airlib/react-aui';

/**
 * One thing to tick in a checkbox group — a skill an agent has, a tool a skill may call — with its
 * name and what it does under the name, both in the column beside the box, so they line up. The
 * whole row ticks it.
 */
export const Choice = template<{ value: string; title: string; hint?: string }>(
  ({ value, title, hint }) => (
    <Label className="wedyan-lounge-choice">
      <Checkbox value={value} />
      <span className="wedyan-lounge-choice-text">
        <span className="wedyan-lounge-choice-title">{title}</span>
        {hint && <span className="wedyan-lounge-choice-hint">{hint}</span>}
      </span>
    </Label>
  ),
  'Choice'
);
