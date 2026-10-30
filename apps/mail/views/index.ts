import type { AUIBoot } from '@airlib/react-aui/desktop';
import { mail, openMail } from './Main.js';
import { CONTEXTS } from './prompt.js';

export { mail, openMail };

/** Mail's entry: launching it opens the inbox, with its messages for the prompt. */
export default (({ open }) => {
  open(mail, { name: 'browser', contexts: CONTEXTS });
}) satisfies AUIBoot;
