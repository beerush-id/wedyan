import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, previewTarget } from '@/lib/systems/public.js';
import { openPreview, preview } from './Main.js';

export { preview };

/** What Preview opens: `preview:/Photos/boats.still`, any document larger, in a window of its own. */
export const linkHandle: Record<string, LinkHandle> = {
  preview: (link) => openPreview(previewTarget(link)),
};

/** Preview's entry: launched on its own, it opens a window saying what it's for. */
export default (({ open }) => {
  open(preview, { name: 'preview' });
}) satisfies AUIBoot;
