import type { DockSuggestion } from '@airlib/react-aui/desktop';
import type { Commands } from '@/lib/systems/public.js';
import { MailIcon } from './icons.js';
import { listing, MAIL, markRead, nameOfPerson } from './library.js';

/** What Mail can do, at `system.mail.name`: nothing `/` offers yet. */
export const COMMANDS: Commands = {
  /** Marks every unread message read. */
  markAllRead: async ({ ack, widgetId }) => {
    const unread = listing({ unread: true, keep: [] });
    for (const message of unread) markRead(message.path);
    if (widgetId) await ack?.(widgetId, { marked: unread.length });
    return <p>Marked {unread.length} as read.</p>;
  },
};

/** What a request can mention while Mail is in front: its messages, each by its subject and sender. */
export const CONTEXTS: DockSuggestion[] = MAIL.map((message) => ({
  value: message.id,
  label: message.subject,
  hint: nameOfPerson(message.from),
  icon: <MailIcon />,
}));
