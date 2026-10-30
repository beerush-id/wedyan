import type { AUIBoot } from '@airlib/react-aui/desktop';
import { photos } from './Main.js';
import { COMMANDS, CONTEXTS } from './prompt.js';

export { photos };

/** Photos' entry: launching it opens the browser, with its command and photos for the prompt. */
export default (({ open }) => {
  open(photos, { name: 'browser', commands: COMMANDS, contexts: CONTEXTS });
}) satisfies AUIBoot;
