import type { WidgetNode } from '@airlib/react-aui/dynamic';
import type { IRPCData, RemoteState } from '@irpclib/irpc';
import { isUserAgent } from '@/lib/share/agents.js';
import { kernel } from './package.js';

/** What the user asks: the words, plus whatever context the desktop attaches to resolve references. */
export type AskInput = {
  text: string;
  context?: Record<string, IRPCData>;
  /** What the user picked into their words, as the desktop offered it, to show them the same again. */
  selections?: IRPCData[];
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

/**
 * UI described as data. It's added `pending`, with no nodes, where the agent asked for it, and the
 * composer fills its widget nodes (`role`, `props`, `bindings`, `children`) in place: `ready`, or
 * `error` with why, when the composer couldn't. `status` is about composing it: what the desktop
 * sees of a form's own state is `settled`.
 */
export type WidgetPart = {
  type: 'widget';
  /** Names it for good, so what's done with it later can find it. */
  id: string;
  status: 'pending' | 'ready' | 'error';
  /** What the agent asked to show, in its own words: the widget's plain-text summary. */
  intent: string;
  nodes: IRPCData[];
  error?: string;
  /** What it asks of the card the desktop draws it in: the style the user's look calls for. */
  props?: Record<string, IRPCData>;
  /** What its inputs start with, and after it's settled, the facts it ended with. */
  form?: Record<string, IRPCData>;
  /** What a submit runs on the desktop, e.g. `system.calendar.createEvent`. */
  formAction?: string;
  /** Whether it locks once its action succeeds. */
  once?: boolean;
  /** When the desktop acknowledged it done: it's a fact from then on, no longer asked. */
  settled?: string;
};

/** What the composer gives a widget. */
export type Composed = Pick<WidgetPart, 'nodes' | 'props' | 'form' | 'formAction' | 'once'>;

/** One part of an answer, in the order the agent produced it. */
export type AskPart = TextPart | WidgetPart;

/**
 * Something the answer does on the desktop. The kernel asks the client to run it by its `name`, in
 * order, once the part at index `after` has been shown or spoken (`-1`: before any part). An action is
 * fire-and-forget; an ask (`ask_user` with a widget form, or an app by name) waits for a reply the
 * model reads on its next turn. The agent writes an `ask_user` form in plain words: its `args` are
 * that description until the composer makes the form, which is what the client is asked with.
 */
export type AskAction = {
  name: string;
  args: IRPCData;
  after: number;
  ask?: true;
  /** The agent that wrote it, stamped by the loop; never sent to the desktop. */
  agent?: string;
  /** What an `ask_user` form asks, in the agent's words, once `args` is the composed form. */
  intent?: string;
};

/** The actor of what the assistant itself does, whatever the user named it. */
export const ASSISTANT_ACTOR = 'wedyan';

/** The actor of what the user does by hand; the user may do anything. */
export const USER_ACTOR = 'user';

/**
 * What the desktop is told with each action or ask: the part it comes `after`, and the `actor`
 * that does it, stamped by the kernel and never by a model. An app refuses a command whose actor
 * may not do it, as an agent on a part assigned to another.
 */
export type ActionMeta = { after: number; actor: string };

/**
 * Who does an action: the user's own agent that wrote it, by its path, or else the assistant,
 * whichever of Wedyan's engines wrote it.
 *
 * @param action - The action, as the loop stamped it.
 * @returns Its actor.
 */
export function actorOf(action: AskAction): string {
  return isUserAgent(action.agent) ? action.agent : ASSISTANT_ACTOR;
}

/**
 * What became of an action or ask: `waiting` once queued, then `done`, `failed` (with `error`),
 * `skipped` (an earlier one of its turn failed), or `unanswered` (an ask nothing replied to).
 */
export type ActionOutcome = {
  status: 'waiting' | 'done' | 'failed' | 'skipped' | 'unanswered';
  error?: string;
};

/**
 * One step of an answer and how long it took, kept to measure where the time goes: `model` is a turn
 * of a model, `call` a tool it called, `compose` a widget or form being drawn, `handoff` an ask being
 * passed on, with what it was passed with.
 */
export type AskStep = {
  kind: 'model' | 'call' | 'compose' | 'handoff';
  /** The agent for a model turn, the tool for a call, the composer for a composition, who takes a handoff. */
  name: string;
  /** The agent it ran for. */
  agent: string;
  /** What a call works on: the path or query it was given. */
  detail?: string;
  /** A call's arguments, as JSON, cut to what's worth keeping. */
  args?: string;
  /** How big a call's result was, in characters of JSON. */
  resultChars?: number;
  /** What a model reasoned this turn: kept to read later, never given back to a model. */
  reasoning?: string;
  /** Where it falls in the answer: after the part at this index (`-1`: before any part). */
  after: number;
  started: string;
  /** Unset while it's running. */
  ended?: string;
  /** How long it took, in milliseconds. */
  ms?: number;
  /** What a web search on this turn cited, as the provider gave it. */
  sources?: { url: string; title?: string }[];
  /** How long a model took to send anything: the provider's wait, which isn't the model's work. */
  waitMs?: number;
  /** How long a model reasoned before its first words or call, in milliseconds. */
  reasoningMs?: number;
  /** How long a model took to send its first words, in milliseconds. */
  firstChunkMs?: number;
  /** How many chunks a model's words arrived in. */
  chunks?: number;
};

/** The live state of one ask, streamed to the client. */
export interface AskState {
  status: 'idle' | 'running' | 'done' | 'stopped' | 'error';
  /** Why the ask stopped or failed. */
  reason?: string;
  /** The agent currently answering. */
  agent: string;
  /** The skill the answering agent was handed, when it takes one. */
  skill?: string;
  /** Model turns taken so far. */
  turn: number;
  /** The answer so far. */
  parts: AskPart[];
  /** Each step taken so far, with its timing. */
  steps?: AskStep[];
}

/**
 * Questions either side may ask while an ask runs. The client asks `followUp`. The kernel asks, by
 * name and with its anchor, every action and ask the answer makes (`app.*`, `desktop.*`,
 * `ask_user`); `ask_user`'s argument is the widget nodes its form shows, and its reply is the form's
 * fields. A name the client hasn't answered resolves to `undefined`.
 */
export type WedyanQueries = {
  // biome-ignore lint/suspicious/noExplicitAny: call names and shapes are registered by the client at runtime
  [name: string]: (...args: any[]) => any;
  /** Something the user said while the ask is running; taken in at the next safe turn. */
  followUp: (text: string) => boolean;
  /** Asks the user with a form, its body the nodes given; the reply is the form's fields. */
  ask_user: (form: WidgetNode[]) => Record<string, IRPCData> | undefined;
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
