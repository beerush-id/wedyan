import type { AUIBoot } from '@airlib/react-aui/desktop';
import { type LinkHandle, linkTarget } from '@/lib/systems/public.js';
import { mailAt } from './library.js';
import { mail, openMail } from './Main.js';
import { CONTEXTS } from './prompt.js';

export { COMMANDS as commands } from './prompt.js';
export { mail, openMail };

/** What Mail opens: `mail:/Mail/m1.eml`, the message read in place. */
export const linkHandle: Record<string, LinkHandle> = {
  mail: (link) => {
    const message = mailAt(linkTarget(link));
    if (message) openMail(message.id);
  },
};

/** Mail's entry: launching it opens the inbox, with its messages for the prompt. */
export default (({ open }) => {
  open(mail, { name: 'browser', contexts: CONTEXTS });
}) satisfies AUIBoot;
