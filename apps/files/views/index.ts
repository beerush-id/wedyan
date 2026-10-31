import type { AUIBoot } from '@airlib/react-aui/desktop';
import { files } from './Main.js';
import { CONTEXTS } from './prompt.js';

export { COMMANDS as commands } from './prompt.js';
export { files };

/** Files' entry: launching it opens the file browser, with its files for the prompt. */
export default (({ open }) => {
  open(files, { contexts: CONTEXTS });
}) satisfies AUIBoot;
