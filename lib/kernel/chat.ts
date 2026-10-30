import type { ChatMessage } from '@irpclib/ai-kit';
import { createContextStore, IRPC_STORE, type RoomSetup, SESSION_STORE, stream, withContext } from '@irpclib/irpc';
import { type AsyncStore, getContextStore, mutable } from '@irpclib/irpc/core';
import { list, read, write } from '@irpclib/r2-file';
import type { DocumentHeader } from '@/lib/documents/types.js';
import { userPath } from '@/lib/memory/files.js';
import { PROFILE_PATH, type UserProfile } from '@/lib/share/profile.js';
import { CONVERSATION_PATH, INBOXES } from '@/lib/share/system.js';
import { type ActionMeta, type AskAction, type AskInput, actorOf, type WidgetPart } from './agent.h.js';
import { askRouter, askWith, type CallResult, toChatInput } from './agent.js';
import { ARRIVAL_SEEDS, landed } from './arrivals.js';
import {
  type ActionRecord,
  type AgentMessage,
  type Conversation,
  type ConversationMessage,
  type ConversationQueries,
  type Presence,
  type UserMessage,
  wedyan,
} from './chat.h.js';
import { DOC_CLOSE, DOC_OPEN } from './document.h.js';
import { kernel } from './package.js';

/** The session's room the conversation lives in: one per user, whichever desktop opens it first. */
export const CONVERSATION_ROOM = 'desktop.chat';

export { CONVERSATION_PATH };

/** How the conversation keeps its pages, what the agents read of it, and how it waits and briefs. */
export type ConversationConfig = {
  /**
   * Largest a page grows, in UTF-8 bytes, before its older messages move to a numbered page. The
   * default is about half of what D1 keeps inline, so the answer that tips it over still stays inline.
   */
  pageBytes: number;
  /** How many past turns the agents read, a turn being the user's words and Wedyan's answer. */
  recentTurns: number;
  /** Longest stretch of an answer's text kept in its line of the agents' view. */
  lineText: number;
  /** How long, in ms, an answer's actions wait for the desktop that sent its words to come back. */
  clientWait: number;
  /** How long, in ms, the user must have been away to be briefed, unless their profile says otherwise. */
  briefAfter: number;
  /** Most arrivals a briefing is told of, the newest. */
  arrivals: number;
  /** Where what comes from outside lands, and is briefed from. */
  inboxes: readonly string[];
  /**
   * The demo's arrivals, by their path in the home without `~/`: delivered once, the first time
   * the user is back from long enough away to be briefed. None to deliver nothing.
   */
  arrivalSeeds: Readonly<Record<string, string>>;
  /** Most unacknowledged answers the router weighs the user's words against, the newest. */
  acksRead: number;
  /** Whether the assistant asks if the user's words cover answers they may not, unless their profile says otherwise. */
  proactive: boolean;
};

/** The conversation's settings when none are given. */
export const CONVERSATION_DEFAULTS: Readonly<ConversationConfig> = {
  pageBytes: 256 * 1024,
  recentTurns: 4,
  lineText: 300,
  clientWait: 60_000,
  briefAfter: 10 * 60_000,
  arrivals: 20,
  inboxes: INBOXES,
  arrivalSeeds: ARRIVAL_SEEDS,
  acksRead: 8,
  proactive: true,
};

const config: ConversationConfig = { ...CONVERSATION_DEFAULTS };

/**
 * Sets how the conversation works for every session of the server; anything not given takes its
 * default.
 *
 * @param options - The settings to change.
 */
export function setupConversation(options: Partial<ConversationConfig>): void {
  Object.assign(config, CONVERSATION_DEFAULTS, options);
}

/**
 * A conversation page's path: the current one, or an older one by number, `1` being the oldest.
 *
 * @param page - The older page's number; the current page when unset.
 * @returns The page's path.
 */
export function pagePath(page?: number): string {
  return page ? `~/Desktop.${page}.chat` : CONVERSATION_PATH;
}

kernel.construct(wedyan, (client) => {
  const member = SESSION_STORE.room(CONVERSATION_ROOM, createConversation);
  // Refused before the stream opens, so the desktop is told and makes a fresh ID.
  if (member.ask('connected', client)) {
    member.leave();
    throw new Error('This client is already connected');
  }

  return stream<Conversation, ConversationQueries>(
    (state) => {
      // The room's own conversation: every desktop's stream holds the same object.
      state.data = member.data;

      const detach = member.ask('attach', client, (action: AskAction) =>
        state.ask(action.name, action.args, { after: action.after, actor: actorOf(action) } satisfies ActionMeta),
      );
      state.answer('send', (input) => member.ask('send', input, client));
      state.answer('stop', (answer) => member.ask('stop', answer));
      state.answer('page', (page) => member.ask('page', page));
      state.answer('presence', (presence, context) => member.ask('presence', presence, client, context));

      return () => {
        detach();
        member.leave();
      };
    },
    { ready: false, page: 0, messages: [] },
  );
});

/** A desktop of the session: runs an action or ask there; `undefined` when it didn't. */
type Desktop = (action: AskAction) => Promise<CallResult>;

/**
 * A conversation page as kept in a `.chat` file; `delivered` is when the demo's arrivals landed,
 * so they land once.
 */
type ConversationPage = DocumentHeader<'chat'> &
  Pick<Conversation, 'page' | 'messages' | 'away'> & { delivered?: string };

/** What a page keeps of itself between saves: its id, when it was made, and when the arrivals landed. */
type PageHeader = Pick<ConversationPage, 'id' | 'created' | 'delivered'>;

/** An answer being written: its message, what the user added to it, and how to stop it. */
type Running = { message: AgentMessage; followUps: string[]; controller: AbortController };

/** What an answer answers: the user's words, or an event Wedyan answers on its own; and where its actions run. */
type Origin = { client: string; to?: string; event?: AgentMessage['event'] };

/** The words the briefing agent is given; what it briefs is in the context. */
const WAKE_TEXT = '(The user is back.)';

/**
 * Builds the session's conversation room: the conversation, read from its current page, and what
 * the desktops ask of it. Answers run in the room side by side, each held until it is saved, so each
 * reaches its end whichever desktop sent its words and whether or not that desktop stays. Words that
 * arrive while answers run go to the router, which joins them to the answer they continue or starts
 * a new one. Each answer's actions run only on the desktop that sent its words, the one whose state
 * they were worked out against: while that desktop is away they wait for it to come back, and fail
 * if it doesn't, never running on another. The user is away once no desktop is in use; when one is
 * again after long enough, Wedyan briefs them there on what they haven't acknowledged and what waits on them.
 */
function createConversation({ hold }: RoomSetup) {
  const data = mutable<Conversation>({ ready: false, page: 0, messages: [] });
  const desktops = new Map<string, Desktop>();
  const presences = new Map<string, Presence>();
  // Actions waiting for their desktop to come back, by its client ID.
  const waiting = new Map<string, Set<() => void>>();
  const running = new Map<string, Running>();
  // A new conversation's own until its page is read; never replaced by a save, so a save finishing
  // late can't undo a change to it.
  let header: PageHeader = newHeader();
  // Saves one after another, so two answers ending together never write over each other's page.
  let saving: Promise<unknown> = Promise.resolve();
  const persist = () => {
    saving = saving.then(async () => {
      await savePage(data, header);
    });
    return saving;
  };
  // A save asked for by a call, in its own copy of the call's context, since the save may wait
  // behind another past the end of that call.
  const keep = (context = detachedContext()) => {
    hold(withContext(context, persist)).catch((error: Error) =>
      IRPC_STORE.error(error, [{ conversation: CONVERSATION_PATH }]),
    );
  };

  const loaded = hold(
    readPage().then((page) => {
      if (page) {
        header = { id: page.id, created: page.created, ...(page.delivered ? { delivered: page.delivered } : {}) };
      }
      // An answer still running when the conversation was last kept was cut off.
      for (const message of page?.messages ?? []) {
        if (message.role === 'agent' && isWriting(message)) {
          Object.assign(message, { status: 'stopped', reason: 'Interrupted' });
        }
      }
      data.page = page?.page ?? 0;
      data.messages.push(...(page?.messages ?? []));
      data.away = page?.away;
      data.ready = true;
    }),
  );

  // The demo's arrivals land in the inboxes once: the first time the user is back from long enough
  // away, just before they are briefed, so the briefing that follows tells of them. Each is dated
  // to the moment it lands; the page keeps when, so no later room delivers them again. Arrivals
  // that fail to land are reported, and the user is briefed without them.
  const deliver = async () => {
    const seeds = Object.entries(config.arrivalSeeds);
    if (header.delivered || !seeds.length) return;
    const now = new Date();
    try {
      await Promise.all(seeds.map(([path, text]) => write(`~/${path}`, landed(path, text, now))));
      header = { ...header, delivered: now.toISOString() };
      keep();
    } catch (error) {
      IRPC_STORE.error(error as Error, [{ arrivals: Object.keys(config.arrivalSeeds) }]);
    }
  };

  // Whenever a desktop's presence changes or it leaves: the user goes away once none is in use, and
  // is briefed on the desktop that is in use again, when they were gone long enough.
  const notice = async (client?: string, context?: AskInput['context']) => {
    if (![...presences.values()].includes('active')) {
      if (!data.away) {
        data.away = new Date().toISOString();
        keep();
      }
      return;
    }
    const since = data.away;
    if (!since) return;
    data.away = undefined;
    if (!client) return;
    const profile = await readProfile();
    if (Date.now() - Date.parse(since) >= (profile?.briefAfter ?? config.briefAfter)) {
      await deliver();
      await brief(client, since, context);
    }
  };

  // The finished answers the user hasn't acknowledged, oldest first, as many as the router weighs.
  const unacked = () =>
    data.messages
      .filter((message): message is AgentMessage => message.role === 'agent' && !message.acked && !isWriting(message))
      .slice(-config.acksRead);

  const acknowledge = (ids: string[]) => {
    const now = new Date().toISOString();
    const acked = unacked().filter((message) => ids.includes(message.id));
    for (const message of acked) message.acked = now;
    if (acked.length) keep();
  };

  // Briefs the user who is back, when there is something to tell: what arrived in their inboxes,
  // the answers they haven't acknowledged and no briefing told them of, and the asks still waiting
  // on them. Each answer is told once; a briefing is never told of in another. The agents read the
  // rest of the conversation as usual.
  const brief = async (client: string, since: string, context?: AskInput['context']) => {
    const told = unacked().filter((message) => !message.briefed && message.event !== 'wake');
    const asking = [...running.values()]
      .filter(({ message }) => message.actions.some((action) => action.ask && action.status === 'waiting'))
      .map(({ message }) => lineOf(message));
    const arrived = await arrivals(since);
    if (!told.length && !asking.length && !arrived.length) return;

    // Each answer with the words it answered, which the briefing tells of rather than reads before it.
    const unseen = told.flatMap((message) => [...data.messages.filter(({ id }) => id === message.to), message]);
    const now = new Date().toISOString();
    for (const message of told) message.briefed = now;

    start(
      { client, event: 'wake' },
      {
        text: WAKE_TEXT,
        context: {
          ...context,
          event: 'wake',
          awayMinutes: Math.round((Date.now() - Date.parse(since)) / 60_000),
          arrived,
          unseen: unseen.map(lineOf),
          waiting: asking,
        },
      },
      data.messages.filter((message) => !unseen.includes(message)),
    );
  };

  // What an answer's agents still have open in documents is let go of on the desktop that granted
  // it, once the answer ends, so no part stays shown as worked on. A desktop gone by then has let go
  // of it already.
  const release = (client: string, message: AgentMessage) => {
    for (const record of message.actions) {
      const path = (record.args as { path?: unknown } | null)?.path;
      if (record.name !== DOC_OPEN || record.status !== 'done' || typeof path !== 'string') continue;
      const close: AskAction = { name: DOC_CLOSE, args: { path }, after: -1, agent: record.actor };
      onDesktop(client, close).catch(() => undefined);
    }
  };

  const onDesktop = async (client: string, action: AskAction) => {
    const desktop = desktops.get(client) ?? (await comesBack(client));
    return desktop(action);
  };

  const comesBack = (client: string) =>
    new Promise<Desktop>((resolve, reject) => {
      const list = waiting.get(client) ?? new Set();
      waiting.set(client, list);
      const back = () => {
        clearTimeout(timer);
        resolve(desktops.get(client)!);
      };
      const timer = setTimeout(() => {
        list.delete(back);
        reject(new Error('The desktop that asked is no longer connected'));
      }, config.clientWait);
      list.add(back);
    });

  const answer = async (origin: Origin, input: AskInput, before: ConversationMessage[]) => {
    data.messages.push(agentMessage(origin));
    // The stored element, so the loop writes into what the desktops see.
    const message = data.messages[data.messages.length - 1] as AgentMessage;
    const turn: Running = { message, followUps: [], controller: new AbortController() };
    running.set(message.id, turn);
    // Each action's record, kept from the moment it is queued and updated in place as it runs.
    const records = new Map<AskAction, ActionRecord>();

    try {
      await askWith({
        input: [...viewOf(before), ...toChatInput(input)],
        state: message,
        desktop: (action) => onDesktop(origin.client, action),
        track: (action, outcome) => {
          const record = records.get(action);
          if (record) {
            Object.assign(record, outcome);
            return;
          }
          const { name, args, after, ask } = action;
          message.actions.push({ name, args, after, ...(ask ? { ask } : {}), actor: actorOf(action), ...outcome });
          records.set(action, message.actions[message.actions.length - 1]);
        },
        followUps: () => turn.followUps.splice(0),
        signal: turn.controller.signal,
      });
    } finally {
      running.delete(message.id);
      release(origin.client, message);
      await persist();
    }

    // Words it was given too late to take in are answered on their own.
    const late = turn.followUps.splice(0);
    if (late.length) {
      const words = lastWords(data, message.id);
      start(words ? originOf(words) : origin, { text: late.join('\n') });
    }
  };

  // Its own copy of the sender's context, so the answer keeps its home, session and bindings to the
  // end, even once the call that sent it is gone. The agents read the turns before it, its words aside.
  const start = (
    origin: Origin,
    input: AskInput,
    before = data.messages.filter((message) => message.id !== origin.to),
  ) => {
    hold(withContext(detachedContext(), () => answer(origin, input, before))).catch((error: Error) =>
      IRPC_STORE.error(error, [{ conversation: input.text }]),
    );
  };

  return {
    data,
    commands: {
      connected: (client: string) => desktops.has(client),
      attach: (client: string, desktop: Desktop) => {
        desktops.set(client, desktop);
        // What waited for this desktop runs now, in the order it was asked.
        for (const back of waiting.get(client) ?? []) back();
        waiting.delete(client);
        // The desktop's own context, to save in once it has left.
        const context = detachedContext();
        return () => {
          if (desktops.get(client) !== desktop) return;
          desktops.delete(client);
          presences.delete(client);
          void withContext(context, () => notice());
        };
      },
      send: async (input: AskInput, client: string) => {
        await loaded;
        data.messages.push(userMessage(input, client));
        const words = data.messages[data.messages.length - 1] as UserMessage;
        // Kept as soon as they are said, not only once an answer ends.
        keep();

        const answers = [...running.values()];
        const earlier = unacked();
        // The answer just before the words is in front of the user: any words acknowledge it.
        const latest = data.messages.findLast(
          (message): message is AgentMessage => message.role === 'agent' && !isWriting(message),
        );
        const latestUnacked = latest && earlier.includes(latest) ? latest : undefined;
        if (!answers.length && earlier.every((message) => message === latestUnacked)) {
          if (latestUnacked) acknowledge([latestUnacked.id]);
          start(originOf(words), input);
          return true;
        }

        // The router decides whether the words continue a running answer, which older answers they
        // acknowledge, and whether they show the user missed any, the latest included.
        const judgment = await judge(input.text, answers, earlier, latestUnacked);
        const taken = latestUnacked ? [latestUnacked.id, ...judgment.acks] : judgment.acks;
        acknowledge(taken.filter((id) => !judgment.missed.includes(id)));
        const target = running.get(judgment.continues ?? '');
        if (target) {
          words.answer = target.message.id;
          target.followUps.push(input.text);
          return true;
        }

        // Answers the words may or may not cover: a proactive assistant asks.
        const unclear = earlier.filter((message) => judgment.unclear.includes(message.id) && !message.acked);
        const proactive = unclear.length ? ((await readProfile())?.proactive ?? config.proactive) : false;
        start(
          originOf(words),
          proactive ? { ...input, context: { ...input.context, unclear: unclear.map(lineOf) } } : input,
        );
        return true;
      },
      stop: (answer?: string) => {
        for (const [id, turn] of running) if (!answer || id === answer) turn.controller.abort();
        return true;
      },
      page: async (page: number) => (await readPage(page))?.messages,
      presence: async (presence: Presence, client: string, context?: AskInput['context']) => {
        await loaded;
        if (!desktops.has(client)) return false;
        presences.set(client, presence);
        await notice(client, context);
        return true;
      },
    },
  };
}

/**
 * What landed in the user's inboxes since the given time, newest first: mail, invites, receipts.
 * An inbox that fails to list is reported and briefed without.
 *
 * @param since - When the user went away, as an ISO time.
 * @returns Each arrival's path, name and time.
 */
async function arrivals(since: string): Promise<Array<{ path: string; name: string; mtime: string }>> {
  const listed = await Promise.all(
    config.inboxes.map((inbox) =>
      list(inbox, {
        recursive: true,
        sort: '-mtime',
        limit: config.arrivals,
        filter: { mtime: { min: Date.parse(since) } },
      }).catch((error: Error & { code?: string }) => {
        if (error.code !== 'ENOENT') IRPC_STORE.error(error, [{ inbox }]);
        return undefined;
      }),
    ),
  );
  return listed
    .flatMap((result) => result?.entries ?? [])
    .filter((entry) => !entry.isDirectory)
    .map(({ path, name, mtime }) => ({ path: userPath(path), name, mtime: new Date(mtime).toISOString() }))
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
    .slice(0, config.arrivals);
}

/** What an answer to the user's words answers, and where its actions run. */
function originOf(words: UserMessage): Origin {
  return { client: words.client, to: words.id };
}

/**
 * How the router judges the user's words against the conversation: it is shown the words, the
 * answers still being written, and the earlier answers the user hasn't acknowledged, each by id.
 */
export const JUDGE_PROMPT = `Words from the user arrived. Below are Wedyan's answers still being written ("running") and its earlier answers the user hasn't acknowledged yet ("unacknowledged"), each with its id. The one marked "latest" came just before the words: the user has it in front of them. Decide:
- continues: the id of the running answer the words continue, by answering its question, correcting it or adding to it; null when they are a request of their own.
- acks: the ids of the other unacknowledged answers the words show the user has taken in: replying to them, building on them, confirming them or thanking for them, like "copy that".
- unclear: the ids of the other unacknowledged answers the words may or may not cover.
- missed: the ids of any unacknowledged answers, the latest included, the words show the user hasn't taken in, like "what did you say?".

Reply with only JSON: {"continues": id or null, "acks": [ids], "unclear": [ids], "missed": [ids]}`;

/** What the router made of the user's words; ids it made up are dropped where they are used. */
type Judgment = { continues?: string; acks: string[]; unclear: string[]; missed: string[] };

/**
 * Judges the user's words: which running answer they continue, which older answers they
 * acknowledge or may, and which they show the user missed. Nothing continued, acknowledged or missed
 * when the router fails or can't tell.
 *
 * @param text - The user's words.
 * @param answers - The answers being written.
 * @param earlier - The answers the user hasn't acknowledged.
 * @param latest - The one of them just before the words, if any.
 * @returns The router's judgment.
 */
async function judge(
  text: string,
  answers: Running[],
  earlier: AgentMessage[],
  latest?: AgentMessage,
): Promise<Judgment> {
  const reply = await askRouter(JUDGE_PROMPT, {
    words: text,
    running: answers.map(({ message }) => ({ id: message.id, line: lineOf(message) })),
    unacknowledged: earlier.map((message) => ({
      id: message.id,
      line: lineOf(message),
      ...(message === latest ? { latest: true } : {}),
    })),
  }).catch(() => undefined);
  try {
    const parsed = JSON.parse(reply?.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1) ?? '');
    const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
    return {
      ...(typeof parsed.continues === 'string' ? { continues: parsed.continues } : {}),
      acks: ids(parsed.acks),
      unclear: ids(parsed.unclear),
      missed: ids(parsed.missed),
    };
  } catch {
    return { acks: [], unclear: [], missed: [] };
  }
}

/** Whether an answer is still being written: it keeps changing, so it is neither acknowledged nor moved to an older page. */
function isWriting(message: AgentMessage): boolean {
  return message.status === 'running' || message.status === 'idle';
}

/** The user's profile, for their own settings; `undefined` before they have one. */
async function readProfile(): Promise<UserProfile | undefined> {
  return (await read<UserProfile>(PROFILE_PATH, { encoding: 'json' })) ?? undefined;
}

/** The latest of the user's words that joined an answer, to answer them on their own. */
function lastWords(data: Conversation, answer: string): UserMessage | undefined {
  return data.messages.findLast(
    (message): message is UserMessage => message.role === 'user' && message.answer === answer,
  );
}

/**
 * A copy of the current call's context, its parents flattened in: what work that outlives the call
 * runs in, since a call's context ends with the call.
 */
function detachedContext() {
  const chain = [];
  for (let store: AsyncStore | undefined = getContextStore(); store; store = store.parent) chain.unshift(store);
  return createContextStore(chain.flatMap((store) => [...store.entries()]));
}

/** The user's words as a conversation message, from the desktop that sent them. */
function userMessage(input: AskInput, client: string): UserMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    created: new Date().toISOString(),
    text: input.text,
    client,
    ...(input.context ? { context: input.context } : {}),
  };
}

/** A new answer, to the user's words or an event, before it starts. */
function agentMessage({ to, event }: Origin): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role: 'agent',
    ...(to ? { to } : {}),
    ...(event ? { event } : {}),
    created: new Date().toISOString(),
    status: 'idle',
    agent: '',
    turn: 0,
    parts: [],
    actions: [],
  };
}

/**
 * What the agents read of the conversation before the ask: the last few turns, one line each, as
 * Wedyan answered them in plain words. No tool results and no widget nodes: what was shown is the
 * agents' own description of it.
 */
function viewOf(messages: ConversationMessage[]): ChatMessage[] {
  const lines = messages.slice(-config.recentTurns * 2).map(lineOf);
  return lines.length ? [{ role: 'user', type: 'object', data: { conversation: lines } }] : [];
}

/** One message as a line of the agents' view. */
function lineOf(message: ConversationMessage): string {
  if (message.role === 'user') return `user: ${message.text}`;
  const said = message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text ?? part.chunks.join('')] : []))
    .join(' ')
    .trim();
  const shown = message.parts.filter((part): part is WidgetPart => part.type === 'widget').map((part) => part.intent);
  const call = (action: ActionRecord) => `${action.name} ${JSON.stringify(action.args)}`;
  const done = message.actions.filter((action) => action.status === 'done').map(call);
  const undone = message.actions
    .filter((action) => action.status !== 'done')
    .map((action) => `${call(action)} (${action.error ?? action.status})`);
  return [
    `wedyan: ${said ? `said "${said.length > config.lineText ? `${said.slice(0, config.lineText)}…` : said}"` : 'said nothing'}`,
    shown.length ? `showed: ${shown.join('; ')}` : '',
    done.length ? `did: ${done.join(', ')}` : '',
    undone.length ? `didn't: ${undone.join(', ')}` : '',
    message.status === 'done' ? '' : `(${message.reason ?? message.status})`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A new conversation's header. */
function newHeader(): PageHeader {
  return { id: crypto.randomUUID(), created: new Date().toISOString() };
}

/** A conversation page, the current one when unset; `undefined` when there is none yet. */
async function readPage(page?: number): Promise<ConversationPage | undefined> {
  return (await read<ConversationPage>(pagePath(page), { encoding: 'json' })) ?? undefined;
}

/**
 * Keeps the conversation: writes its current page and, once it outgrows `config.pageBytes`, first moves
 * its older messages to the next numbered page, keeping the turns the agents read on the current
 * one. The numbered page is written before the current one shrinks, so a failure between the two
 * repeats a page rather than losing one.
 *
 * @param data - The conversation.
 * @param header - The page's header.
 */
async function savePage(data: Conversation, header: PageHeader): Promise<void> {
  const pageOf = (page: number, messages: ConversationMessage[]): ConversationPage => ({
    type: 'chat',
    version: 1,
    ...header,
    name: 'Desktop',
    updated: new Date().toISOString(),
    author: { kind: 'agent' },
    page,
    messages,
    ...(data.away ? { away: data.away } : {}),
  });
  const messages = JSON.parse(JSON.stringify(data.messages)) as ConversationMessage[];
  const keep = config.recentTurns * 2;

  // Never past an answer still being written: it keeps changing, so it stays on the current page.
  const writing = messages.findIndex((message) => message.role === 'agent' && isWriting(message));
  const cut = Math.min(messages.length - keep, writing === -1 ? messages.length : writing);

  if (new TextEncoder().encode(JSON.stringify(pageOf(data.page, messages))).length > config.pageBytes && cut > 0) {
    const older = messages.slice(0, cut);
    await write(pagePath(data.page + 1), pageOf(data.page + 1, older) as never);
    data.page += 1;
    data.messages.splice(0, older.length);
  }

  await write(CONVERSATION_PATH, pageOf(data.page, JSON.parse(JSON.stringify(data.messages))) as never);
}
