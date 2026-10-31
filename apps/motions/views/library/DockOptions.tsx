import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, template } from '@airlib/react';
import { Select, Stepper, Toolbar } from '@airlib/react-aui';
import { AspectRatioIcon } from '@airlib/react-aui/icons';
import { ASPECTS, MODELS } from '@/lib/documents/generation.js';
import { ModelIcon } from '../icons.js';
import { animation } from '../motion.js';

/** How a new motion is made, in the dock while the library is in front: its model, its shape, and how long it runs. */
export const LibraryDockOptions = template(
  () => (
    <Toolbar label="Motion settings" variant="text" className={AUI_CLASS.TOOLBAR_OPTIONS}>
      <Select size="sm" label="Model" options={MODELS.take} value={$bind(animation, 'model')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <ModelIcon /> <span>{MODELS.take[value as string]}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
      <Select size="sm" label="Aspect ratio" options={ASPECTS} value={$bind(animation, 'aspect')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <AspectRatioIcon /> <span>{value as string}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
      <Stepper size="sm" label="Seconds" decrementLabel="Shorter" incrementLabel="Longer" min={2} max={20} value={$bind(animation, 'seconds')} />
    </Toolbar>
  ),
  'LibraryDockOptions',
);
