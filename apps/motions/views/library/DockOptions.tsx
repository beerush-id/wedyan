import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, template } from '@airlib/react';
import { Select, Toolbar } from '@airlib/react-aui';
import { AspectRatioIcon } from '@airlib/react-aui/icons';
import { ASPECTS } from '@/lib/documents/generation.js';
import { animation } from '../motion.js';
import { WorkOptions } from '../WorkOptions.js';

/** How a new motion is made, in the dock while the library is in front: who works on it, how hard, and its shape. */
export const LibraryDockOptions = template(
  () => (
    <Toolbar label="Motion settings" variant="text" className={AUI_CLASS.TOOLBAR_OPTIONS}>
      <WorkOptions />
      <Select size="sm" label="Aspect ratio" options={ASPECTS} value={$bind(animation, 'aspect')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <AspectRatioIcon /> <span>{value as string}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
    </Toolbar>
  ),
  'LibraryDockOptions',
);
