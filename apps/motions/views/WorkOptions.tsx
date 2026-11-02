import { $bind, template } from '@airlib/react';
import { Select } from '@airlib/react-aui';
import { WORK_EFFORTS, WORK_MODEL_NAMES } from '@/lib/documents/generation.js';
import { EffortIcon, ModelIcon } from './icons.js';
import { animation } from './motion.js';

/** Who works on a motion, for the dock: which model, and how hard it thinks. */
export const WorkOptions = template(
  () => (
    <>
      <Select size="sm" label="Model" options={WORK_MODEL_NAMES} value={$bind(animation, 'model')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <ModelIcon /> <span>{WORK_MODEL_NAMES[value as string]}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
      <Select size="sm" label="Reasoning effort" options={WORK_EFFORTS} value={$bind(animation, 'effort')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <EffortIcon /> <span>{WORK_EFFORTS[value as string]}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
    </>
  ),
  'WorkOptions',
);
