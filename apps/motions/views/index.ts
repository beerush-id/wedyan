import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, linkTarget } from '@/lib/systems/public.js';
import { motions, openMotions } from './Main.js';
import { CONTEXTS } from './prompt.js';

export { COMMANDS as commands } from './prompt.js';
export { motions };

/** What Motions opens: `motions:/Motions/Teaser/Teaser.motion`, in Direct. */
export const linkHandle: Record<string, LinkHandle> = {
  motions: (link) => void openMotions(linkTarget(link), true),
};

/** Motions' entry: launching it opens the projects, with its projects for the prompt. */
export default (({ open }) => {
  open(motions, { name: 'library', contexts: CONTEXTS });
}) satisfies AUIBoot;
