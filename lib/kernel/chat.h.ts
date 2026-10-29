import type { IRPCData, RemoteState } from '@irpclib/irpc';
import type { AskAction, AskInput, AskState } from './agent.h.js';
import { kernel } from './package.js';

/** What the user said: their words, and what the desktop attached to resolve references. */
export type UserMessage = {
  id: string;
  role: 'user';
  created: string;
  text: string;
  context?: Record<string, IRPCData>;
};

/**
 * Wedyan's answer: the ask's own live state (parts, status, agent), written in place as it runs,
 * and the actions it ran on the desktop.
 */
export type AgentMessage = AskState & {
  id: string;
  role: 'agent';
  created: string;
  actions: Array<Pick<AskAction, 'name' | 'args'>>;
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
};

/**
 * The questions on the conversation. The desktop asks to `send` the user's words (a follow-up while
 * an answer is running), to `stop` the answer, and for an older `page`. The server asks the desktop
 * to run actions and asks by name, as `askWedyan` does (`app.*`, `desktop.*`, `ask_user`).
 */
export type ConversationQueries = {
  // biome-ignore lint/suspicious/noExplicitAny: action and ask names are registered by the client at runtime
  [name: string]: (...args: any[]) => any;
  send: (input: AskInput) => boolean;
  stop: () => boolean;
  page: (page: number) => ConversationMessage[] | undefined;
};

export type WedyanFn = () => RemoteState<Conversation, ConversationQueries>;

/**
 * The user's conversation with Wedyan, live. Every desktop of the session opens it and sees the same
 * conversation as it is written; the server owns it, runs each ask to the end even if the desktop
 * that sent it disconnects, and keeps it in the user's `~/Desktop.chat`.
 */
export const wedyan = kernel.declare<WedyanFn>({
  name: 'wedyan.chat',
  stream: true,
  keepAlive: true,
  coalesce: false,
  seed: () => ({ ready: false, page: 0, messages: [] }),
});
