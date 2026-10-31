import type { IRPCData } from '@irpclib/irpc';
import { onCleanup } from '@irpclib/irpc/core';
import type { StillDocument } from '@/lib/documents/types.js';
import type { ActionMeta } from '@/lib/kernel/agent.h.js';
import { DOC_ATTEMPTS, DOC_CLOSE, DOC_OPEN, DOC_UPDATE, documentPresence, partKey } from '@/lib/kernel/document.h.js';
import type { StillAttempt, StillRequest } from '@/lib/kernel/stills.h.js';
import { addAttempts, applyRequest } from './stills.js';
import { edit, edited, type FileRef } from './workspace.js';

/** An agent asking for a part of a document: what kind of part, which one, and who asks. */
export type PartRequest = { part: string; id: string; actor: string };

/**
 * What only the app knows about its document: which parts an agent may work on, and how an
 * agent's value is written into one.
 */
export type BindingRules = {
  /** Grants a part by returning it, the live object in the document; or refuses it with a reason. */
  open: (request: PartRequest) => object | string;
  /**
   * Writes an agent's value into the part it opened (`entity`, the object `open` granted); returns
   * `true`, or a reason to refuse it.
   */
  update: (request: PartRequest & { value: IRPCData; entity: object }) => true | string;
};

/** How a window binds a document: agents' rules for working inside it, and what it starts as. */
export type BindingOptions<T> = Partial<BindingRules> & {
  /** What to work on while the file doesn't exist; its first change makes the file. */
  blank?: T;
};

/** A document as a window works with it: its live content, and who is working on which part. */
export type DocumentBinding<T> = {
  /** Whether both its content and its presence have arrived. */
  readonly ready: boolean;
  /**
   * The document's live content: the same object every window and document referring to it holds,
   * changed in place, saved, and kept in sync with every change made to it in the session.
   */
  readonly data: T | undefined;
  /** Who is working on a part right now: their actors. */
  who(part: string, id: string): string[];
};

/** A document a window is showing: its live content, and with rules, its presence. */
type Bound = {
  content: FileRef<unknown>;
  presence?: ReturnType<typeof documentPresence>;
  rules?: BindingRules;
  /** What each agent has open here: one part at a time. */
  granted: Map<string, { part: string; id: string; entity: object }>;
};

/** The documents windows are showing on this desktop, by path: what the agents' asks reach. */
const BOUND = new Map<string, Bound>();

/**
 * Binds a document for a window working on it: its content, edited and saved (the workspace's one
 * live object for the file, so a document referring to it sees every change). With rules, agents
 * work inside it part by part, and who is working on which part shows on every desktop. Closes
 * with the window. A document only referred to needs `fileRef`, not a binding.
 *
 * @param path - The document's home path (`~/…`).
 * @param options - Which parts agents may open and how their values are written, for a document
 *   they work inside; and `blank`, for a file that may not exist yet.
 * @returns The live document.
 */
export function createBinding<T>(path: string, options: BindingOptions<T> = {}): DocumentBinding<T> {
  const { open, update, blank } = options;
  const rules = open && update ? { open, update } : undefined;
  const content = edit<T>(path, blank);
  const presence = rules ? documentPresence(path) : undefined;
  const bound: Bound = { content, presence, rules, granted: new Map() };
  BOUND.set(path, bound);

  onCleanup(() => {
    if (BOUND.get(path) === bound) BOUND.delete(path);
    presence?.close();
  });

  return {
    get ready() {
      return Boolean(content.ready && (presence?.data.ready ?? true));
    },
    get data() {
      return content.data;
    },
    who: (part, id) => presence?.data.parts[partKey(part, id)] ?? [],
  };
}

/** Something the server asks the desktop on, as the conversation (`wedyan()`) is. */
type Answerable = { answer(name: string, handler: (args: never, meta: ActionMeta) => unknown): unknown };

/**
 * Answers the agents' document asks on the desktop's conversation: `doc.open` grants a part by the
 * app's rules and answers with its current value, `doc.update` writes into a part the agent has
 * open, and `doc.close` lets go of it. The actor is the kernel's stamp, never the agent's say.
 *
 * @param chat - The desktop's live conversation.
 */
export function answerDocuments(chat: Answerable): void {
  chat.answer(DOC_OPEN, (args: { path: string; part: string; id: string }, { actor }) => {
    const bound = BOUND.get(args.path);
    if (!bound) return { refused: 'That document is not open on the desktop' };
    if (!bound.rules) return { refused: 'That document has no parts to open: work on it whole' };
    if (!bound.content.ready) return { refused: 'The document is still loading: try again in a moment' };
    const granted = bound.rules.open({ part: args.part, id: args.id, actor });
    if (typeof granted === 'string') return { refused: granted };
    bound.granted.set(actor, { part: args.part, id: args.id, entity: granted });
    void bound.presence?.ask('open', args.part, args.id, actor);
    return { opened: JSON.parse(JSON.stringify(granted)) as IRPCData };
  });

  chat.answer(DOC_UPDATE, (args: { path: string; part: string; id: string; value: IRPCData }, { actor }) => {
    const bound = BOUND.get(args.path);
    const open = bound?.granted.get(actor);
    if (!bound?.rules || open?.part !== args.part || open.id !== args.id) return { refused: 'Open that part first' };
    const done = bound.rules.update({ ...args, actor, entity: open.entity });
    return done === true ? { updated: true } : { refused: done };
  });

  // An agent's new attempts of a generated document this desktop is editing: taken into its copy,
  // so they're saved with its own edits instead of written over by them.
  chat.answer(DOC_ATTEMPTS, (args: { path: string; request: StillRequest; attempts: StillAttempt[] }) => {
    const still = edited<StillDocument>(args.path);
    if (!still) return { added: false };
    applyRequest(still, args.request);
    addAttempts(still, args.attempts);
    return { added: true };
  });

  chat.answer(DOC_CLOSE, (args: { path: string }, { actor }) => {
    const bound = BOUND.get(args.path);
    if (!bound?.granted.delete(actor)) return { closed: false };
    void bound.presence?.ask('close', actor);
    return { closed: true };
  });
}
