import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, linkTarget } from '@/lib/systems/public.js';
import { MEMO_EXTENSION, opening } from './library.js';
import { memo } from './Main.js';
import { contexts } from './prompt.js';

export { COMMANDS as commands } from './prompt.js';
export { memo };

/** How Memo's window opens: its browser, with its memos for the prompt, as they're listed. */
const BROWSER = {
  name: 'browser',
  get contexts() {
    return contexts();
  },
};

/** What Memo opens: `memo:~/Memos/Wedy.memo`, the memo picked in its tab. */
export const linkHandle: Record<string, LinkHandle> = {
  memo: (link) => {
    opening.path = linkTarget(link);
    memo.open(undefined, BROWSER);
  },
};

/**
 * Whether Memo opens a file: a memo.
 *
 * @param path - The file's path.
 * @returns True for a `.memo`.
 */
export function opens(path: string): boolean {
  return path.endsWith(MEMO_EXTENSION);
}

/** Memo's entry: launching it opens the browser. */
export default (({ open }) => {
  open(memo, BROWSER);
}) satisfies AUIBoot;
