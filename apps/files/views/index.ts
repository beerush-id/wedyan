import type { AUIBoot } from '@airlib/react-aui/desktop';
import { files } from './Main.js';
import { contexts } from './prompt.js';

export { COMMANDS as commands } from './prompt.js';
export { files };

/** Files' entry: launching it opens the file browser, with what it lists for the prompt. */
export default (({ open }) => {
  open(files, {
    get contexts() {
      return contexts();
    },
  });
}) satisfies AUIBoot;
