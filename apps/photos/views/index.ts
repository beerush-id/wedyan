import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, linkTarget } from '@/lib/systems/public.js';
import { openStill, photos } from './Main.js';
import { CONTEXTS } from './prompt.js';

export { COMMANDS as commands } from './prompt.js';
export { photos };

/** What Photos opens: `photos:/Photos/boats.still`, in a window of its own. */
export const linkHandle: Record<string, LinkHandle> = {
  photos: (link) => void openStill(linkTarget(link)),
};

/** Photos' entry: launching it opens the browser, with its photos for the prompt. */
export default (({ open }) => {
  open(photos, { name: 'browser', contexts: CONTEXTS });
}) satisfies AUIBoot;
