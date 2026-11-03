import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, linkTarget } from '@/lib/systems/public.js';
import { opening } from './library.js';
import { lounge } from './Main.js';
import { contexts } from './prompt.js';

export { opensFile as opens } from './library.js';
export { lounge };

/** How Lounge's window opens: the people and agents, with them for the prompt, as they're listed. */
const BROWSER = {
  name: 'browser',
  get contexts() {
    return contexts();
  },
};

/** What Lounge opens: `lounge:~/People/Ayla.persona` or `lounge:~/Agents/Story.agent`, picked in its group. */
export const linkHandle: Record<string, LinkHandle> = {
  lounge: (link) => {
    opening.path = linkTarget(link);
    lounge.open(undefined, BROWSER);
  },
};

/** Lounge's entry: launching it opens the people and agents. */
export default (({ open }) => {
  open(lounge, BROWSER);
}) satisfies AUIBoot;
