import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { MailIcon } from './icons.js';
import { MAIL, nameOfPerson } from './library.js';

/** What a request can mention while Mail is in front: its messages, each by its subject and sender. */
export const CONTEXTS: DockSuggestion[] = MAIL.map((message) => ({
  value: message.id,
  label: message.subject,
  hint: nameOfPerson(message.from),
  icon: <MailIcon />,
}));
