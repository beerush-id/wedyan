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
import { askWith, toChatInput } from './agent.js';
import {
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

/** Largest a page grows before its older messages move to a numbered page: small enough to stay inline in D1. */
export const PAGE_BYTES = 192 * 1024;

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

/** How the conversation keeps its pages; for tests to make pages small. */
export function setupConversation(options: { pageBytes?: number }): void {
  pageBytes = options.pageBytes ?? PAGE_BYTES;
}

kernel.construct(wedyan, () =>
  stream<Conversation, ConversationQueries>(
    (state) => {
      const member = SESSION_STORE.room(CONVERSATION_ROOM, createConversation);
      // The room's own conversation: every desktop's stream holds the same object.
      state.data = member.data;

      const desktop: Desktop = (action) => state.ask(action.name, action.args, { after: action.after });
      const detach = member.ask('attach', desktop);
      state.answer('send', (input) => member.ask('send', input, desktop));
      state.answer('stop', () => member.ask('stop'));
      state.answer('page', (page) => member.ask('page', page));

      return () => {
        detach();
        member.leave();
      };
    },
    { ready: false, page: 0, messages: [] },
  ),
);

/** A desktop of the session: runs an action or ask there; `undefined` when it didn't. */
type Desktop = (action: AskAction) => Promise<IRPCData | undefined>;

/** A conversation page as kept in a `.chat` file. */
type ConversationPage = DocumentHeader<'chat'> & { page: number; messages: ConversationMessage[] };

let pageBytes = PAGE_BYTES;

/**
 * Builds the session's conversation room: the conversation, read from its current page, and what
 * the desktops ask of it. An answer runs in the room, held until it is saved, so it reaches its end
 * whichever desktop sent it and whether or not that desktop stays. Actions go to the desktop that
 * sent the words while it is connected, else to the latest one to connect.
 */
function createConversation({ hold }: RoomSetup) {
  const data = mutable<Conversation>({ ready: false, page: 0, messages: [] });
  const desktops = new Set<Desktop>();
  let sender: Desktop | undefined;
  let running: { followUps: string[]; controller: AbortController } | undefined;
  let header: Pick<ConversationPage, 'id' | 'created'> | undefined;

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

  const onDesktop: Desktop = (action) => {
    const target = sender && desktops.has(sender) ? sender : [...desktops].at(-1);
    return target ? target(action) : Promise.resolve(undefined);
  };

  const answer = async (input: AskInput) => {
    const before = data.messages.slice(0, -1);
    data.messages.push(agentMessage());
    // The stored element, so the loop writes into what the desktops see.
    const message = data.messages[data.messages.length - 1] as AgentMessage;
    const controller = new AbortController();
    const turn = { followUps: [] as string[], controller };
    running = turn;

    try {
      await askWith({
        input: [...viewOf(before), ...toChatInput(input)],
        state: message,
        desktop: async (action) => {
          const reply = await onDesktop(action);
          message.actions.push({ name: action.name, args: action.args });
          return reply;
        },
        followUps: () => turn.followUps.splice(0),
        signal: controller.signal,
      });
    } finally {
      running = undefined;
      header = await savePage(data, header);
    }
  };

  return {
    data,
    commands: {
      attach: (desktop: Desktop) => {
        desktops.add(desktop);
        return () => void desktops.delete(desktop);
      },
      send: async (input: AskInput, desktop?: Desktop) => {
        await loaded;
        sender = desktop ?? sender;
        data.messages.push(userMessage(input));
        // While an answer runs, the words join it as a follow-up instead of starting another.
        if (running) {
          running.followUps.push(input.text);
          return true;
        }
        // Its own copy of the sender's context, so the answer keeps its home, session and bindings
        // to the end, even once the call that sent it is gone.
        hold(withContext(detachedContext(), () => answer(input))).catch((error: Error) =>
          IRPC_STORE.error(error, [{ conversation: input.text }]),
        );
        return true;
      },
      stop: () => {
        running?.controller.abort();
        return true;
      },
      page: async (page: number) => (await readPage(page))?.messages,
    },
  };
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

/** The user's words as a conversation message. */
function userMessage(input: AskInput): UserMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    created: new Date().toISOString(),
    text: input.text,
    ...(input.context ? { context: input.context } : {}),
  };
}

/** A new answer, before it starts. */
function agentMessage(): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role: 'agent',
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
  const done = message.actions.map((action) => `${action.name} ${JSON.stringify(action.args)}`);
  return [
    `wedyan: ${said ? `said "${said.length > LINE_TEXT ? `${said.slice(0, LINE_TEXT)}…` : said}"` : 'said nothing'}`,
    shown.length ? `showed: ${shown.join('; ')}` : '',
    done.length ? `did: ${done.join(', ')}` : '',
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

  if (JSON.stringify(pageOf(data.page, messages)).length > pageBytes && messages.length > keep) {
    const older = messages.slice(0, -keep);
    await write(pagePath(data.page + 1), pageOf(data.page + 1, older) as never);
    data.page += 1;
    data.messages.splice(0, older.length);
  }

  await write(CONVERSATION_PATH, pageOf(data.page, JSON.parse(JSON.stringify(data.messages))) as never);
  return kept;
}
