import { mutable } from '@airlib/react';
import type { WedyanFileKind } from '@/components/WedyanGallery.js';
import { nameOf } from '@/lib/documents/store.js';
import LISTING from '../data/mail.json';

/** Where Mail reads from: the inbox at the drive's root, where outside services write what arrives. */
export const ROOT = '/Mail';

/** The tag of a message kept flagged, to come back to. */
export const FLAGGED = 'flagged';

/** The labels: each a tag that the messages under it carry, and its name. */
export const LABELS: { tag: string; label: string }[] = LISTING.labels;

/** Someone a message is from or to: their name when the message gives one, and their address. */
export type Person = { name?: string; address: string };

/** A file that came with a message: its name, size, and what kind of file it is. */
export type Attachment = { name: string; size: string; kind: WedyanFileKind };

/**
 * A message in the inbox, as its `.eml` gives it — who it's from and to, its subject, when it was
 * sent, its plain-text body and what came with it — and what Mail keeps about it: whether it was
 * read, and its tags. Its id is its file's name, which `app.mail.open` names it by.
 */
export type Mail = {
  id: string;
  path: string;
  messageId: string;
  from: Person;
  to: Person[];
  cc: Person[];
  subject: string;
  /** When it was sent, as an ISO date with its offset. */
  date: string;
  body: string;
  attachments: Attachment[];
  read: boolean;
  tags: string[];
};

/** What a listing is asked for: the inbox's contents, every message carrying a tag, or the unread ones. */
export type ListingRequest = { folder: string } | { tag: string } | { unread: true; keep: string[] };

/** Every message in the inbox, read and tagged as it's used. A mock listing, until the drive serves one. */
export const MAIL: Mail[] = mutable(
  (LISTING.messages as Omit<Mail, 'id'>[]).map((message) => ({ ...message, id: nameOf(message.path).replace(/\.eml$/, '') }))
);

/** What changes as Mail is used, for this session: the messages deleted, by path. */
export const library = mutable({ deleted: [] as string[] });

/**
 * Lists the inbox as asked, newest first: a folder's messages, every message carrying a tag, or
 * the unread ones — with those read since Unread was opened, so reading one doesn't take it away.
 * A mock of the drive's listing request, answered from the messages at hand.
 *
 * @param request - A folder, a tag, or the unread ones with those to keep.
 * @returns The messages, newest first.
 */
export function listing(request: ListingRequest): Mail[] {
  const listed = kept().filter((message) => {
    if ('tag' in request) return message.tags.includes(request.tag);
    if ('unread' in request) return !message.read || request.keep.includes(message.path);
    return message.path.startsWith(`${request.folder}/`);
  });
  return listed.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

/**
 * Whether a message holds what's searched for: in its subject, who it's from, or its body,
 * ignoring case. A mock of the drive's content index, which searches what a message says.
 *
 * @param message - The message.
 * @param query - What's searched for; everything matches while it's empty.
 * @returns Whether it matches.
 */
export function matches(message: Mail, query: string): boolean {
  const words = query.trim().toLowerCase();
  if (!words) return true;
  return [message.subject, message.from.name ?? '', message.from.address, message.body].some((text) =>
    text.toLowerCase().includes(words)
  );
}

/**
 * The message with an id, unless it was deleted.
 *
 * @param id - Its id: its file's name, e.g. `m1`.
 * @returns The message, or none.
 */
export function mailById(id: string): Mail | undefined {
  return kept().find((message) => message.id === id);
}

/**
 * The message at a path, unless it was deleted.
 *
 * @param path - Its file, e.g. `/Mail/m1.eml`.
 * @returns The message, or none.
 */
export function mailAt(path: string): Mail | undefined {
  return kept().find((message) => message.path === path);
}

/**
 * Marks a message read, as picking or opening it does.
 *
 * @param path - Its file.
 */
export function markRead(path: string): void {
  const message = mailAt(path);
  if (message) message.read = true;
}

/**
 * Whether every one of these messages was read.
 *
 * @param paths - The messages.
 * @returns Whether all of them were.
 */
export function allRead(paths: string[]): boolean {
  return paths.every((path) => mailAt(path)?.read);
}

/**
 * Marks these messages read, or unread when every one was read already.
 *
 * @param paths - The messages.
 */
export function toggleRead(paths: string[]): void {
  const read = !allRead(paths);
  for (const path of paths) {
    const message = mailAt(path);
    if (message) message.read = read;
  }
}

/**
 * Whether every one of these messages carries a tag.
 *
 * @param paths - The messages.
 * @param tag - The tag.
 * @returns Whether all of them carry it.
 */
export function allTagged(paths: string[], tag: string): boolean {
  return paths.every((path) => mailAt(path)?.tags.includes(tag));
}

/**
 * Tags these messages, or takes the tag off when every one carries it already.
 *
 * @param paths - The messages.
 * @param tag - The tag.
 */
export function toggleTag(paths: string[], tag: string): void {
  const all = allTagged(paths, tag);
  for (const path of paths) {
    const tags = mailAt(path)?.tags;
    if (!tags) continue;
    const at = tags.indexOf(tag);
    if (all && at > -1) tags.splice(at, 1);
    else if (!all && at < 0) tags.push(tag);
  }
}

/**
 * Who someone is, in words: their name, or their address when the message gives no name.
 *
 * @param person - Who.
 * @returns E.g. `Ana Putri`, or `me@example.com`.
 */
export function nameOfPerson(person: Person): string {
  return person.name || person.address;
}

/**
 * Who someone is, in full: their name and address, or the address alone.
 *
 * @param person - Who.
 * @returns E.g. `Ana Putri <ana@example.com>`.
 */
export function fullNameOf(person: Person): string {
  return person.name ? `${person.name} <${person.address}>` : person.address;
}

/**
 * The messages not deleted.
 *
 * @returns Those still in the inbox.
 */
function kept(): Mail[] {
  return MAIL.filter((message) => !library.deleted.includes(message.path));
}
