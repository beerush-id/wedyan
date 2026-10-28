import type { AUIBoot } from '@airlib/react-aui/desktop';
import { motions } from './Main.js';
import { COMMANDS, CONTEXTS } from './prompt.js';

export { motions };

/** Motions' entry: launching it opens the projects, with its command and projects for the prompt. */
export default (({ open }) => {
  open(motions, { commands: COMMANDS, contexts: CONTEXTS });
}) satisfies AUIBoot;
