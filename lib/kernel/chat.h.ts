import type { IRPCData, RemoteState } from '@irpclib/irpc';
import { z } from 'zod';
import type { ActionMeta, ActionOutcome, AskAction, AskInput, AskState } from './agent.h.js';
import { kernel } from './package.js';

/** What the user said: their words, and what the desktop attached to resolve references. */
export type UserMessage = {
  id: string;
  role: 'user';
  created: string;
  text: string;
  context?: Record<string, IRPCData>;
  /** What they picked into their words, as the desktop offered it, to show them the same again. */
  selections?: IRPCData[];
  /** The desktop that sent them: the answer's actions run there and nowhere else. */
  client: string;
  /** The running answer these words joined as a follow-up; unset when they started their own. */
  answer?: string;
};

/** One action or ask of an answer, who did it, and what became of it, kept whether it ran or not. */
export type ActionRecord = Pick<AskAction, 'name' | 'args' | 'after' | 'ask'> &
  Pick<ActionMeta, 'actor'> &
  ActionOutcome;

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
  /**
   * Why Wedyan started it on its own: `wake` briefs the user who just came back, `job` tells them a
   * job they started in the background finished, `work` is an expert doing a task it was handed.
   */
  event?: 'wake' | 'job' | 'work';
  /** The task it does, when `event` is `work`. */
  task?: string;
  created: string;
  actions: ActionRecord[];
  /** When the user acknowledged it: their words replied to it, confirmed it or thanked for it. */
  acked?: string;
  /**
   * When the user put it off for later, like "I'll watch it later": not acknowledged, and brought
   * back up by the next briefing.
   */
  deferred?: string;
  /** When a briefing told the user of it, so no later briefing repeats it. */
  briefed?: string;
};

/** The action that hands a task to one of the user's experts; the conversation runs it, not the desktop. */
export const WORK_ASSIGN = 'work.assign';

/** What a task is about: one file, or one part of one (clip `s3` of a stage). */
export type WorkObject = { path: string; part?: string; id?: string };

/**
 * One piece of work handed to one of the user's experts: a goal about one object. An expert does
 * one task at a time, in the order they were handed to it, and an object has one task working on
 * it at a time.
 */
export type WorkTask = {
  id: string;
  /** The batch it belongs to, as the one who handed it out named it: "Lantern River episodes". */
  title: string;
  /** The expert doing it, by its path: `~/Agents/Director.agent`. */
  agent: string;
  goal: string;
  object: WorkObject;
  status: 'queued' | 'running' | 'done' | 'failed';
  /** The answer that handed it out. */
  by: string;
  /** The desktop its actions run on: the one the work was handed out on. */
  client: string;
  /** The answer doing it, once it started. */
  answer?: string;
  created: string;
  /** When it ended. */
  ended?: string;
};

/** A job the desktop ran in the background and that ended, like a render: what it was, and how it ended. */
export type FinishedJob = {
  /** What it was, as the user would say it: "the Wedyan promo render". */
  title: string;
  /** Where its result is, when it made one. */
  path?: string;
  /** Why it failed, when it did. */
  failed?: string;
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
  /** Since when the user has been away (every desktop idle or closed); unset while one is in use. */
  away?: string;
  /** The work handed to the user's experts, in the order it was handed out, finished tasks included. */
  work?: WorkTask[];
};

/** Whether a desktop is in use: `active` on input while it is shown, `idle` after a while without or when hidden. */
export type Presence = 'active' | 'idle';

/**
 * The questions on the conversation. The desktop asks to `send` the user's words (joined to a
 * running answer when they continue it, else answered on their own), to `stop` an answer (every
 * running one when unnamed), for an older `page`, and tells its `presence`, with its context when it
 * turns active, so a user back from away is briefed there. It tells when a job it ran in the
 * background ended (`finished`), so Wedyan says so and the next briefing knows. What the user has
 * taken in is known from their words, never from what was shown: each answer is `acked` once their
 * words acknowledge it, or `deferred` when they put it off for later. The server asks the desktop to
 * run actions and asks by name, as `askWedyan` does (`app.*`, `desktop.*`, `ask_user`).
 */
export type ConversationQueries = {
  // biome-ignore lint/suspicious/noExplicitAny: action and ask names are registered by the client at runtime
  [name: string]: (...args: any[]) => any;
  send: (input: AskInput) => boolean;
  stop: (answer?: string) => boolean;
  page: (page: number) => ConversationMessage[] | undefined;
  presence: (presence: Presence, context?: AskInput['context']) => boolean;
  finished: (job: FinishedJob) => boolean;
  /** Says a widget is done: its form becomes these facts, and it's settled. False once it already is. */
  ack: (widget: string, form: Record<string, IRPCData>) => boolean;
};

/**
 * Opens the conversation as one desktop: `client` is that desktop's own stable ID, one per tab,
 * kept across reloads. A second live connection with an ID already connected is refused
 * (`DUPLICATE_CLIENT`), as when a tab is duplicated: the desktop then opens again with a fresh ID.
 */
export type ConversationFn = (client: string) => RemoteState<Conversation, ConversationQueries>;

/** Why a desktop is refused the conversation: its ID is already connected, as a duplicated tab's is. */
export const DUPLICATE_CLIENT = 'This client is already connected';

/**
 * The user's conversation with Wedyan, live, as IRPC declares it. Every desktop of the session opens
 * it and sees the same conversation as it is written; the server owns it, runs each ask to the end
 * even if the desktop that sent it disconnects, and keeps it in the user's `~/Desktop.chat`. Each
 * answer's actions run only on the desktop that sent its words. A desktop opens it with `wedyan()`
 * (`lib/share/wedyan.ts`), which owns its ID; other clients, with an ID of their own.
 */
export const conversation = kernel.declare<ConversationFn>({
  name: 'wedyan.chat',
  stream: true,
  keepAlive: true,
  coalesce: false,
  seed: () => ({ ready: false, page: 0, messages: [] }),
  schema: { input: [z.string().min(1).max(100)] },
});
