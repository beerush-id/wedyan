import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, linkTarget } from '@/lib/systems/public.js';
import { opening } from './library.js';
import { calendar } from './Main.js';
import { CONTEXTS } from './prompt.js';

export { COMMANDS as commands } from './prompt.js';
export { calendar };

/** What Calendar opens: `calendar:/Calendar/e00.ics`, the event in the preview beside the days. */
export const linkHandle: Record<string, LinkHandle> = {
  calendar: (link) => {
    opening.path = linkTarget(link);
    calendar.open(undefined, { name: 'browser', contexts: CONTEXTS });
  },
};

/** Calendar's entry: launching it opens the calendar, with its events for the prompt. */
export default (({ open }) => {
  open(calendar, { name: 'browser', contexts: CONTEXTS });
}) satisfies AUIBoot;
