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
import { read, write } from '@irpclib/r2-file';
import type { DocumentHeader } from '@/lib/documents/types.js';
import type { AskAction, AskInput, WidgetPart } from './agent.h.js';
import { askRouter, askWith, toChatInput } from './agent.js';
import {
  type ActionRecord,
  type AgentMessage,
  type Conversation,
  type ConversationMessage,
  type ConversationQueries,
  type UserMessage,
  wedyan,
} from './chat.h.js';
import { kernel } from './package.js';

/** The session's room the conversation lives in: one per user, whichever desktop opens it first. */
export const CONVERSATION_ROOM = 'desktop.chat';

/** Where the conversation's current page is kept, in the user's home. */
export const CONVERSATION_PATH = '~/Desktop.chat';

/**
 * Largest a page grows before its older messages move to a numbered page: about half of what D1
 * keeps inline, so the answer that tips it over still stays inline.
 */
export const PAGE_BYTES = 256 * 1024;

/** How many past turns the agents read, a turn being the user's words and Wedyan's answer. */
export const RECENT_TURNS = 4;

/**
 * A conversation page's path: the current one, or an older one by number, `1` being the oldest.
 *
 * @param page - The older page's number; the current page when unset.
 * @returns The page's path.
 */
export function pagePath(page?: number): string {
  return page ? `~/Desktop.${page}.chat` : CONVERSATION_PATH;
}

/** How long an answer's actions wait for the desktop that sent its words to come back. */
export const CLIENT_WAIT = 60_000;

/** How the conversation keeps its pages and waits for desktops; for tests to make both small. */
export function setupConversation(options: { pageBytes?: number; clientWait?: number }): void {
  pageBytes = options.pageBytes ?? PAGE_BYTES;
  clientWait = options.clientWait ?? CLIENT_WAIT;
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
type ConversationPage = DocumentHeader<'chat'> & { page: number; messages: ConversationMessage[] };

let pageBytes = PAGE_BYTES;
let clientWait = CLIENT_WAIT;

/** An answer being written: its message, what the user added to it, and how to stop it. */
type Running = { message: AgentMessage; followUps: string[]; controller: AbortController };

/**
 * Builds the session's conversation room: the conversation, read from its current page, and what
 * the desktops ask of it. Answers run in the room side by side, each held until it is saved, so each
 * reaches its end whichever desktop sent its words and whether or not that desktop stays. Words that
 * arrive while answers run go to the router, which joins them to the answer they continue or starts
 * a new one. Each answer's actions run only on the desktop that sent its words, the one whose state
 * they were worked out against: while that desktop is away they wait for it to come back, and fail
 * if it doesn't, never running on another.
 */
function createConversation({ hold }: RoomSetup) {
  const data = mutable<Conversation>({ ready: false, page: 0, messages: [] });
  const desktops = new Map<string, Desktop>();
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
      data.ready = true;
    }),
  );

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
      }, clientWait);
      list.add(back);
    });

  const answer = async (words: UserMessage, input: AskInput) => {
    const sender = words.client;
    const before = data.messages.filter((message) => message.id !== words.id);
    data.messages.push(agentMessage(words.id));
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
        desktop: (action) => onDesktop(sender, action),
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
    if (late.length) start(lastWords(data, message.id) ?? words, { text: late.join('\n') });
  };

  // Its own copy of the sender's context, so the answer keeps its home, session and bindings to the
  // end, even once the call that sent it is gone.
  const start = (words: UserMessage, input: AskInput) => {
    hold(withContext(detachedContext(), () => answer(words, input))).catch((error: Error) =>
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
        return () => {
          if (desktops.get(client) === desktop) desktops.delete(client);
        };
      },
      send: async (input: AskInput, client: string) => {
        await loaded;
        data.messages.push(userMessage(input, client));
        const words = data.messages[data.messages.length - 1] as UserMessage;
        // Kept as soon as they are said, not only once an answer ends; in its own context, since the
        // save may wait behind another past the end of this call.
        hold(withContext(detachedContext(), persist)).catch((error: Error) =>
          IRPC_STORE.error(error, [{ conversation: input.text }]),
        );

        // While answers run, the router decides whether the words continue one of them.
        const target = running.size
          ? running.get((await continued(input.text, [...running.values()])) ?? '')
          : undefined;
        if (target && running.has(target.message.id)) {
          words.answer = target.message.id;
          target.followUps.push(input.text);
          return true;
        }
        start(words, input);
        return true;
      },
      stop: (answer?: string) => {
        for (const [id, turn] of running) if (!answer || id === answer) turn.controller.abort();
        return true;
      },
      page: async (page: number) => (await readPage(page))?.messages,
    },
  };
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

/** A new answer to the given words, before it starts. */
function agentMessage(to: string): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role: 'agent',
    to,
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
  const lines = messages.slice(-RECENT_TURNS * 2).map(lineOf);
  return lines.length ? [{ role: 'user', type: 'object', data: { conversation: lines } }] : [];
}

/** Longest stretch of an answer's text kept in its line. */
const LINE_TEXT = 300;

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
    `wedyan: ${said ? `said "${said.length > LINE_TEXT ? `${said.slice(0, LINE_TEXT)}…` : said}"` : 'said nothing'}`,
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
 * Keeps the conversation: writes its current page and, once it outgrows `pageBytes`, first moves
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
  });
  const messages = JSON.parse(JSON.stringify(data.messages)) as ConversationMessage[];
  const keep = RECENT_TURNS * 2;

  // Never past an answer still being written: it keeps changing, so it stays on the current page.
  const writing = messages.findIndex(
    (message) => message.role === 'agent' && (message.status === 'running' || message.status === 'idle'),
  );
  const cut = Math.min(messages.length - keep, writing === -1 ? messages.length : writing);

  if (new TextEncoder().encode(JSON.stringify(pageOf(data.page, messages))).length > pageBytes && cut > 0) {
    const older = messages.slice(0, cut);
    await write(pagePath(data.page + 1), pageOf(data.page + 1, older) as never);
    data.page += 1;
    data.messages.splice(0, older.length);
  }

  await write(CONVERSATION_PATH, pageOf(data.page, JSON.parse(JSON.stringify(data.messages))) as never);
  return kept;
}
