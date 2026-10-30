import type { AUIBoot } from '@airlib/react-aui/desktop';
import { memo } from './Main.js';
import { COMMANDS, CONTEXTS } from './prompt.js';

export { memo };

/** Memo's entry: launching it opens the browser, with its command and memos for the prompt. */
export default (({ open }) => {
  open(memo, { name: 'browser', commands: COMMANDS, contexts: CONTEXTS });
}) satisfies AUIBoot;
