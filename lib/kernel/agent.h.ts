import type { IRPCData, RemoteState } from '@irpclib/irpc';
import { kernel } from './package.js';

/** What the user asks: the words, plus whatever context the desktop attaches to resolve references. */
export type AskInput = {
  text: string;
  context?: Record<string, IRPCData>;
};

/**
 * Markdown the answer shows. Its text streams as `chunks`, each pushed once; `text` is set once, when
 * the part is complete. `spoken` marks the parts voice reads aloud.
 */
export type TextPart = {
  type: 'text';
  chunks: string[];
  text?: string;
  spoken: boolean;
};

/** UI described as data (a widget node: `role`, `props`, `children`), added whole once complete. */
export type WidgetPart = {
  type: 'widget';
  role: string;
  [key: string]: IRPCData;
};

/** One part of an answer, in the order the agent produced it. */
export type AskPart = TextPart | WidgetPart;

/**
 * Something the answer does on the desktop. The kernel asks the client to run it by its `name`, in
 * order, once the part at index `after` has been shown or spoken (`-1`: before any part). An action is
 * fire-and-forget; an ask (`ask_user` with a widget form, or an app by name) waits for a reply the
 * model reads on its next turn.
 */
export type AskAction = {
  name: string;
  args: IRPCData;
  after: number;
  ask?: true;
};

/** The live state of one ask, streamed to the client. */
export interface AskState {
  status: 'idle' | 'running' | 'done' | 'stopped' | 'error';
  /** Why the ask stopped or failed. */
  reason?: string;
  /** The agent currently answering. */
  agent: string;
  /** Model turns taken so far. */
  turn: number;
  /** The answer so far. */
  parts: AskPart[];
}

/**
 * Questions either side may ask while an ask runs. The client asks `followUp`. The kernel asks, by
 * name and with its anchor, every action and ask the answer makes (`app.*`, `desktop.*`,
 * `ask_user`); `ask_user`'s arguments are the widget its form shows, and its reply is the form's
 * fields. A name the client hasn't answered resolves to `undefined`.
 */
export type WedyanQueries = {
  // biome-ignore lint/suspicious/noExplicitAny: call names and shapes are registered by the client at runtime
  [name: string]: (...args: any[]) => any;
  /** Something the user said while the ask is running; taken in at the next safe turn. */
  followUp: (text: string) => boolean;
};

export type AskWedyanFn = (input: AskInput) => RemoteState<AskState, WedyanQueries>;

/**
 * One user ask, end to end, as a single streaming call: routing, calls, questions back to the
 * client and handoffs all happen inside it. Kept alive for as long as the ask runs; closing the
 * call stops the ask.
 */
export const askWedyan = kernel.declare<AskWedyanFn>({
  name: 'wedyan.ask',
  keepAlive: true,
  coalesce: false,
  seed: () => askSeed(),
});

/**
 * The state of an ask before it starts.
 *
 * @returns A fresh idle state.
 */
export function askSeed(): AskState {
  return { status: 'idle', agent: '', turn: 0, parts: [] };
}
