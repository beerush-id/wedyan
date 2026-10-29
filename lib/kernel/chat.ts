import type { ChatMessage } from '@irpclib/ai-kit';
import {
  createContextStore,
  IRPC_STORE,
  type IRPCData,
  type RoomSetup,
  SESSION_STORE,
  stream,
  withContext,
} from '@irpclib/irpc';
import { type AsyncStore, getContextStore, mutable } from '@irpclib/irpc/core';
import { list, read, write } from '@irpclib/r2-file';
import type { DocumentHeader } from '@/lib/documents/types.js';
import { userPath } from '@/lib/memory/files.js';
import { PROFILE_PATH, type UserProfile } from '@/lib/share/profile.js';
import { CONVERSATION_PATH, INBOXES } from '@/lib/share/system.js';
import type { AskAction, AskInput, WidgetPart } from './agent.h.js';
import { askRouter, askWith, toChatInput } from './agent.js';
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
        state.ask(action.name, action.args, { after: action.after }),
      );
      state.answer('send', (input) => member.ask('send', input, client));
      state.answer('stop', (answer) => member.ask('stop', answer));
      state.answer('page', (page) => member.ask('page', page));
      state.answer('seen', (message) => member.ask('seen', message));
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
type Desktop = (action: AskAction) => Promise<IRPCData | undefined>;

/** A conversation page as kept in a `.chat` file. */
type ConversationPage = DocumentHeader<'chat'> & Pick<Conversation, 'page' | 'messages' | 'seen' | 'away'>;

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
 * again after long enough, Wedyan briefs them there on what they haven't seen and what waits on them.
 */
function createConversation({ hold }: RoomSetup) {
  const data = mutable<Conversation>({ ready: false, page: 0, messages: [] });
  const desktops = new Map<string, Desktop>();
  const presences = new Map<string, Presence>();
  // Actions waiting for their desktop to come back, by its client ID.
  const waiting = new Map<string, Set<() => void>>();
  const running = new Map<string, Running>();
  let header: Pick<ConversationPage, 'id' | 'created'> | undefined;
  // Saves one after another, so two answers ending together never write over each other's page.
  let saving: Promise<unknown> = Promise.resolve();
  const persist = () => {
    saving = saving.then(async () => {
      header = await savePage(data, header);
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
      header = page ? { id: page.id, created: page.created } : undefined;
      // An answer still running when the conversation was last kept was cut off.
      for (const message of page?.messages ?? []) {
        if (message.role === 'agent' && (message.status === 'running' || message.status === 'idle')) {
          Object.assign(message, { status: 'stopped', reason: 'Interrupted' });
        }
      }
      data.page = page?.page ?? 0;
      data.messages.push(...(page?.messages ?? []));
      data.seen = page?.seen;
      data.away = page?.away;
      data.ready = true;
    }),
  );

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
    const profile = await read<UserProfile>(PROFILE_PATH, { encoding: 'json' });
    if (Date.now() - Date.parse(since) >= (profile?.briefAfter ?? config.briefAfter)) {
      await brief(client, since, context);
    }
  };

  // Briefs the user who is back, when there is something to tell: what arrived in their inboxes,
  // the answers they haven't seen, and the asks still waiting on them. The agents read what came
  // before the unseen as usual.
  const brief = async (client: string, since: string, context?: AskInput['context']) => {
    const from = data.messages.findIndex((message) => message.id === data.seen) + 1;
    const unseen = data.messages.slice(from).filter((message) => !running.has(message.id));
    const asking = [...running.values()]
      .filter(({ message }) => message.actions.some((action) => action.ask && action.status === 'waiting'))
      .map(({ message }) => lineOf(message));
    const arrived = await arrivals(since);
    if (!unseen.some((message) => message.role === 'agent') && !asking.length && !arrived.length) return;

    start(
      { client, event: 'wake' },
      {
        text: WAKE_TEXT,
        context: {
          ...context,
          event: 'wake',
          awayMinutes: Math.round((Date.now() - Date.parse(since)) / 60_000),
          arrived,
          unseen: unseen.slice(-config.recentTurns * 2).map(lineOf),
          waiting: asking,
        },
      },
      data.messages.slice(0, from),
    );
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
          message.actions.push({ name, args, after, ...(ask ? { ask } : {}), ...outcome });
          records.set(action, message.actions[message.actions.length - 1]);
        },
        followUps: () => turn.followUps.splice(0),
        signal: turn.controller.signal,
      });
    } finally {
      running.delete(message.id);
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

        // While answers run, the router decides whether the words continue one of them.
        const target = running.size
          ? running.get((await continued(input.text, [...running.values()])) ?? '')
          : undefined;
        if (target && running.has(target.message.id)) {
          words.answer = target.message.id;
          target.followUps.push(input.text);
          return true;
        }
        start(originOf(words), input);
        return true;
      },
      stop: (answer?: string) => {
        for (const [id, turn] of running) if (!answer || id === answer) turn.controller.abort();
        return true;
      },
      page: async (page: number) => (await readPage(page))?.messages,
      seen: async (message: string) => {
        await loaded;
        const at = data.messages.findIndex(({ id }) => id === message);
        // Only ever forward: a message before the one already seen changes nothing.
        if (at === -1 || at <= data.messages.findIndex(({ id }) => id === data.seen)) return false;
        data.seen = message;
        keep();
        return true;
      },
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
 * How the router decides where words that arrive during answers go: it is shown what each running
 * answer was asked and has said, and the words.
 */
const CONTINUES_PROMPT = `Words from the user arrived while the answers below are still being written. Decide whether the words continue one of them, by answering its question, correcting it or adding to it, or are a new request of their own.

Reply with only the id of the answer they continue, or with new.`;

/**
 * Which running answer the words continue, as the router decides; `undefined` for a new request,
 * or when the router can't tell.
 */
async function continued(text: string, answers: Running[]): Promise<string | undefined> {
  const reply = await askRouter(CONTINUES_PROMPT, {
    words: text,
    running: answers.map(({ message }) => ({ id: message.id, line: lineOf(message) })),
  }).catch(() => undefined);
  const id = reply?.trim().replace(/^["'`]|["'`.]$/g, '');
  return answers.some(({ message }) => message.id === id) ? id : undefined;
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
 * @returns The page's header, made on its first save.
 */
async function savePage(
  data: Conversation,
  header?: Pick<ConversationPage, 'id' | 'created'>,
): Promise<Pick<ConversationPage, 'id' | 'created'>> {
  const kept = header ?? { id: crypto.randomUUID(), created: new Date().toISOString() };
  const pageOf = (page: number, messages: ConversationMessage[]): ConversationPage => ({
    type: 'chat',
    version: 1,
    ...kept,
    name: 'Desktop',
    updated: new Date().toISOString(),
    author: { kind: 'agent' },
    page,
    messages,
    ...(data.seen ? { seen: data.seen } : {}),
    ...(data.away ? { away: data.away } : {}),
  });
  const messages = JSON.parse(JSON.stringify(data.messages)) as ConversationMessage[];
  const keep = config.recentTurns * 2;

  // Never past an answer still being written: it keeps changing, so it stays on the current page.
  const writing = messages.findIndex(
    (message) => message.role === 'agent' && (message.status === 'running' || message.status === 'idle'),
  );
  const cut = Math.min(messages.length - keep, writing === -1 ? messages.length : writing);

  if (new TextEncoder().encode(JSON.stringify(pageOf(data.page, messages))).length > config.pageBytes && cut > 0) {
    const older = messages.slice(0, cut);
    await write(pagePath(data.page + 1), pageOf(data.page + 1, older) as never);
    data.page += 1;
    data.messages.splice(0, older.length);
  }

  await write(CONVERSATION_PATH, pageOf(data.page, JSON.parse(JSON.stringify(data.messages))) as never);
  return kept;
}
