import type { RemoteState } from '@irpclib/irpc';
import { z } from 'zod';
import { kernel } from './package.js';

/**
 * Who is working where in one document, the same on every desktop of the session: the actors on
 * each part, by `part:id` (`clip:v3`). Live presence only; who a part is assigned to is kept in the
 * document itself.
 */
export type DocumentPresence = { ready: boolean; parts: Record<string, string[]> };

/**
 * What a desktop tells the document's room: an actor opened a part there (`open`), or closed what it
 * had open (`close`). Each actor has one part open at a time; a desktop's entries go when it leaves.
 */
export type PresenceQueries = {
  open: (part: string, id: string, actor: string) => boolean;
  close: (actor: string) => boolean;
};

/** The agents' document asks and action, by name: what the desktop answers through `answerDocuments`. */
export const DOC_OPEN = 'doc.open';
export const DOC_UPDATE = 'doc.update';
export const DOC_CLOSE = 'doc.close';

/** The key a part's presence is kept under. */
export function partKey(part: string, id: string): string {
  return `${part}:${id}`;
}

/**
 * Joins a document's presence, as one desktop showing it: live, who is working on which part.
 * Opened by `createBinding`; apps don't call it themselves.
 */
export const documentPresence = kernel.declare<(path: string) => RemoteState<DocumentPresence, PresenceQueries>>({
  name: 'document.presence',
  stream: true,
  keepAlive: true,
  coalesce: false,
  seed: () => ({ ready: false, parts: {} }),
  schema: { input: [z.string().min(1).max(1024)] },
});
