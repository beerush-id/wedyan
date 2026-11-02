import type { AUIBoot } from '@airlib/react-aui/desktop';
import { lounge } from './Main.js';
import { contexts } from './prompt.js';

export { lounge };

/** Lounge's entry: launching it opens the people and agents, with them for the prompt, as they're listed. */
export default (({ open }) => {
  open(lounge, {
    name: 'browser',
    get contexts() {
      return contexts();
    },
  });
}) satisfies AUIBoot;
