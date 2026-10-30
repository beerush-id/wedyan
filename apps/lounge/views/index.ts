import type { AUIBoot } from '@airlib/react-aui/desktop';
import { lounge } from './Main.js';
import { CONTEXTS } from './prompt.js';

export { lounge };

/** Lounge's entry: launching it opens the people and agents, with them for the prompt. */
export default (({ open }) => {
  open(lounge, { name: 'browser', contexts: CONTEXTS });
}) satisfies AUIBoot;
