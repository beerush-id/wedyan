import { AUI_CLASS } from '@airlib/aui/utils';
import { createContext, Show, setup } from '@airlib/react';
import { Avatar, DescriptionList, List, ListItem } from '@airlib/react-aui';
import type { WedyanFileKind } from '@/components/WedyanGallery.js';
import { fullNameOf, type Mail, mailAt, nameOfPerson } from './library.js';

/** The message open beside the list: what Mail's window shares with its reader. */
export type MailSession = {
  /** The open message's path; none while nothing, or several, are picked. */
  readonly path: string | null;
};

/** The message open in Mail's window, for the reader beside the list. */
export const mailCtx = createContext<MailSession>();

const CLASS = {
  READER: 'wedyan-mail-reader',
  SUBJECT: 'wedyan-mail-subject',
  SENDER: 'wedyan-mail-sender',
  SENDER_NAME: 'wedyan-mail-sender-name',
  SENDER_ADDRESS: 'wedyan-mail-sender-address',
  BODY: 'wedyan-mail-body',
};

/** What each kind of attached file is called, in words. */
const KIND_LABELS: Partial<Record<WedyanFileKind, string>> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  document: 'Document',
  archive: 'Archive',
};

/**
 * The open message, read in place beside the list: its subject, who sent it, who it went to and
 * when, what it says, and the files that came with it.
 */
export const MailReader = setup(() => {
  const session = mailCtx.get() as MailSession;
  const message = () => (session.path ? mailAt(session.path) : undefined);

  return () => (
    <Show when={message}>
      {(mail) => (
        <article className={`${CLASS.READER} ${AUI_CLASS.GLASS_PANEL}`} aria-label={mail.subject}>
          <h3 className={CLASS.SUBJECT}>{mail.subject}</h3>
          <header className={CLASS.SENDER}>
            <Avatar alt={nameOfPerson(mail.from)} size="md" />
            <span className={CLASS.SENDER_NAME}>{nameOfPerson(mail.from)}</span>
            <span className={CLASS.SENDER_ADDRESS}>{mail.from.address}</span>
          </header>
          <DescriptionList size="sm" items={factsOf(mail)} />
          <p className={CLASS.BODY}>{mail.body}</p>
          {mail.attachments.length > 0 && (
            <List label="Attachments" size="sm">
              {mail.attachments.map((attachment) => (
                <ListItem key={attachment.name} title={attachment.name} description={KIND_LABELS[attachment.kind]} meta={attachment.size} />
              ))}
            </List>
          )}
        </article>
      )}
    </Show>
  );
}, 'MailReader');

/**
 * What the reader says about a message under its sender: who it went to, who was copied, and
 * when it was sent.
 *
 * @param mail - The message.
 * @returns Its facts, leaving out Cc when nobody was copied.
 */
function factsOf(mail: Mail): { label: string; value: string }[] {
  return [
    { label: 'To', value: mail.to.map(fullNameOf).join(', ') },
    ...(mail.cc.length ? [{ label: 'Cc', value: mail.cc.map(fullNameOf).join(', ') }] : []),
    { label: 'Date', value: new Date(mail.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) },
  ];
}
