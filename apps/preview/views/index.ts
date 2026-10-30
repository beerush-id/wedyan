import type { AUIBoot } from '@airlib/react-aui/desktop';
import { provide } from '@/lib/systems/system.js';
import { openPreview, preview } from './Main.js';

export { preview };

// Every app previews through the system; Preview does it.
provide({ preview: openPreview });

/** Preview's entry: launched on its own, it opens a window saying what it's for. */
export default (({ open }) => {
  open(preview, { name: 'preview' });
}) satisfies AUIBoot;
