import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, linkTarget } from '@/lib/systems/public.js';
import { motionComposer, openMotion } from './composer/Window.js';
import { motionLibrary, openLibrary } from './library/Window.js';

export { COMMANDS as commands } from './prompt.js';
export { motionComposer, motionLibrary };

/** What Motions opens: `motions:~/Motions/Teaser/Teaser.motion`, in Direct. */
export const linkHandle: Record<string, LinkHandle> = {
  motions: (link) => void openMotion(linkTarget(link), true),
};

/** Motions' entry: launching it opens the library. */
export default (() => {
  openLibrary();
}) satisfies AUIBoot;
