import type { AUIBoot } from '@airlib/react-aui/desktop';
import { calendar } from './Main.js';
import { COMMANDS, CONTEXTS } from './prompt.js';

export { calendar };

/** Calendar's entry: launching it opens the calendar, with its events for the prompt. */
export default (({ open }) => {
  open(calendar, { name: 'browser', commands: COMMANDS, contexts: CONTEXTS });
}) satisfies AUIBoot;
