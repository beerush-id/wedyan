import type { AUIBoot } from '@airlib/react-aui/desktop';
import { files } from './Main.js';
import { COMMANDS, CONTEXTS } from './prompt.js';

export { files };

/** Files' entry: launching it opens the file browser, with its commands and files for the prompt. */
export default (({ open }) => {
  open(files, { commands: COMMANDS, contexts: CONTEXTS });
}) satisfies AUIBoot;
