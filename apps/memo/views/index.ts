import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, linkTarget } from '@/lib/systems/public.js';
import { opening } from './library.js';
import { memo } from './Main.js';
import { CONTEXTS } from './prompt.js';

export { COMMANDS as commands } from './prompt.js';
export { memo };

/** What Memo opens: `memo:/Memos/Wedy.memo`, the memo picked in its tab. */
export const linkHandle: Record<string, LinkHandle> = {
  memo: (link) => {
    opening.path = linkTarget(link);
    memo.open(undefined, { name: 'browser', contexts: CONTEXTS });
  },
};

/** Memo's entry: launching it opens the browser, with its memos for the prompt. */
export default (({ open }) => {
  open(memo, { name: 'browser', contexts: CONTEXTS });
}) satisfies AUIBoot;
