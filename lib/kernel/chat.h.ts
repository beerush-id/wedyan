import type { IRPCData, RemoteState } from '@irpclib/irpc';
import { z } from 'zod';
import type { ActionOutcome, AskAction, AskInput, AskState } from './agent.h.js';
import { kernel } from './package.js';

/** What the user said: their words, and what the desktop attached to resolve references. */
export type UserMessage = {
  id: string;
  role: 'user';
  created: string;
  text: string;
  context?: Record<string, IRPCData>;
  /** The desktop that sent them: the answer's actions run there and nowhere else. */
  client: string;
  /** The running answer these words joined as a follow-up; unset when they started their own. */
  answer?: string;
};

/** One action or ask of an answer and what became of it, kept whether it ran or not. */
export type ActionRecord = Pick<AskAction, 'name' | 'args' | 'after' | 'ask'> & ActionOutcome;

/**
 * Wedyan's answer: the ask's own live state (parts, status, agent), written in place as it runs,
 * and its actions on the desktop, each with what became of it. Several can be written at once, each
 * answering its words, or, with `event` instead, started by Wedyan itself.
 */
export type AgentMessage = AskState & {
  id: string;
  role: 'agent';
  /** The user's words it answers; unset when Wedyan started it. */
  to?: string;
  /** Why Wedyan started it on its own: `wake` briefs the user who just came back. */
  event?: 'wake';
  created: string;
  actions: ActionRecord[];
};

export type ConversationMessage = UserMessage | AgentMessage;

/**
 * The user's conversation with Wedyan, as every desktop of the session sees it live: the messages
 * of its current page, the answer being written included. `page` is how many older pages there are:
 * `page(1)` is the oldest.
 */
export type Conversation = {
  ready: boolean;
  page: number;
  messages: ConversationMessage[];
  /** The last message the user saw, on any desktop. */
  seen?: string;
  /** Since when the user has been away (every desktop idle or closed); unset while one is in use. */
  away?: string;
};

/** Whether a desktop is in use: `active` on input while it is shown, `idle` after a while without or when hidden. */
export type Presence = 'active' | 'idle';

/**
 * The questions on the conversation. The desktop asks to `send` the user's words (joined to a
 * running answer when they continue it, else answered on their own), to `stop` an answer (every
 * running one when unnamed), for an older `page`, to mark a message `seen` once the user has seen
 * it, and tells its `presence`, with its context when it turns active, so a user back from away is
 * briefed there. The server asks the desktop to run actions and asks by name, as `askWedyan` does
 * (`app.*`, `desktop.*`, `ask_user`).
 */
export type ConversationQueries = {
  // biome-ignore lint/suspicious/noExplicitAny: action and ask names are registered by the client at runtime
  [name: string]: (...args: any[]) => any;
  send: (input: AskInput) => boolean;
  stop: (answer?: string) => boolean;
  page: (page: number) => ConversationMessage[] | undefined;
  seen: (message: string) => boolean;
  presence: (presence: Presence, context?: AskInput['context']) => boolean;
};

/**
 * Opens the conversation as one desktop: `client` is that desktop's own stable ID, one per tab,
 * kept across reloads (in `sessionStorage`). A second live connection with an ID already connected
 * is refused, as when a tab is duplicated: the desktop then makes a fresh ID and opens again.
 */
export type WedyanFn = (client: string) => RemoteState<Conversation, ConversationQueries>;

/**
 * The user's conversation with Wedyan, live. Every desktop of the session opens it and sees the same
 * conversation as it is written; the server owns it, runs each ask to the end even if the desktop
 * that sent it disconnects, and keeps it in the user's `~/Desktop.chat`. Each answer's actions run
 * only on the desktop that sent its words.
 */
export const wedyan = kernel.declare<WedyanFn>({
  name: 'wedyan.chat',
  stream: true,
  keepAlive: true,
  coalesce: false,
  seed: () => ({ ready: false, page: 0, messages: [] }),
  schema: { input: [z.string().min(1).max(100)] },
});
