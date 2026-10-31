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
import { exists, list, read, write } from '@irpclib/r2-file';
import { fsContext } from '@irpclib/r2-file/context';
import type { DocumentHeader } from '@/lib/documents/types.js';
import { userPath } from '@/lib/memory/files.js';
import { SETTINGS_PATH, type UserSettings } from '@/lib/share/profile.js';
import { AGENTS_PATH, CONVERSATION_PATH, INBOXES } from '@/lib/share/system.js';
import { type ActionMeta, type AskAction, type AskInput, actorOf, type WidgetPart } from './agent.h.js';
import { askRouter, askWith, type CallResult, toChatInput } from './agent.js';
import { ARRIVAL_SEEDS, landed } from './arrivals.js';
import {
  type ActionRecord,
  type AgentMessage,
  ASK_REPLY,
  type Conversation,
  type ConversationMessage,
  type ConversationQueries,
  conversation,
  DUPLICATE_CLIENT,
  type FinishedJob,
  type Presence,
  type UserMessage,
  WORK_ASSIGN,
  type WorkObject,
  type WorkTask,
} from './chat.h.js';
import { DOC_ATTEMPTS, DOC_CLOSE, DOC_OPEN } from './document.h.js';
import { kernel } from './package.js';
import { USER_ASK } from './parts.js';

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
  /**
   * The agent that answers what Wedyan starts on its own (a briefing, a finished job), without
   * asking the router; the router decides when unset.
   */
  briefer?: string;
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

kernel.construct(conversation, (client) => {
  const member = SESSION_STORE.room(CONVERSATION_ROOM, createConversation);
  // Refused before the stream opens, so the desktop is told and makes a fresh ID.
  if (member.ask('connected', client)) {
    member.leave();
    throw new Error(DUPLICATE_CLIENT);
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
      state.answer('finished', (job) => member.ask('finished', job, client));
      state.answer('ack', (widget, form) => member.ask('ack', widget, form));

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
  Pick<Conversation, 'page' | 'messages' | 'away' | 'work'> & { delivered?: string };

/** What a page keeps of itself between saves: its id, when it was made, and when the arrivals landed. */
type PageHeader = Pick<ConversationPage, 'id' | 'created' | 'delivered'>;

/** An answer being written: its message, what the user added to it, and how to stop it. */
type Running = { message: AgentMessage; followUps: string[]; controller: AbortController };

/** What an answer answers: the user's words, or an event Wedyan answers on its own; and where its actions run. */
type Origin = {
  client: string;
  to?: string;
  event?: AgentMessage['event'];
  /** The task it does, when it does one. */
  task?: string;
  /** Who answers first, instead of the router. */
  entry?: string;
};

/** The words the briefing agent is given; what it briefs is in the context. */
const WAKE_TEXT = '(The user is back.)';

/** The words the agent telling of a finished job is given; the job is in the context. */
const JOB_TEXT = '(A background job ended.)';

/** What the button that sends a form says. */
const SEND_LABEL = 'Send';

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
  const home = fsContext.get();
  const desktops = new Map<string, Desktop>();
  const presences = new Map<string, Presence>();
  // Forms an answer is waiting on the user to fill in, by widget, with what takes the reply.
  const forms = new Map<string, (reply: IRPCData | undefined) => void>();
  // Actions waiting for their desktop to come back, by its client ID.
  const waiting = new Map<string, Set<() => void>>();
  const running = new Map<string, Running>();
  // A new conversation's own until its page is read; never replaced by a save, so a save finishing
  // late can't undo a change to it.
  let header: PageHeader = newHeader();
  // Saves one after another, so two answers ending together never write over each other's page.
  let saving: Promise<unknown> = Promise.resolve();
  const persist = (context = detachedContext()) => {
    // Always into the home it was opened in, whoever asks: a conversation written into another
    // home takes that home's conversation with it.
    const save = () =>
      withContext(context, () => {
        if (home) fsContext.set(home);
        return savePage(data, header);
      });
    saving = saving.then(save, save);
    return saving;
  };
  const keep = () => {
    hold(persist()).catch((error: Error) => IRPC_STORE.error(error, [{ conversation: CONVERSATION_PATH }]));
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
      // A task still running when the conversation was last kept was cut off: it starts over.
      data.work = (page?.work ?? []).map((task) => (task.status === 'running' ? { ...task, status: 'queued' } : task));
      data.ready = true;
      pump();
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
    const settings = await readSettings();
    if (Date.now() - Date.parse(since) >= (settings?.briefAfter ?? config.briefAfter)) {
      await deliver();
      await brief(client, since, context);
    }
  };

  // The finished answers the user hasn't acknowledged, oldest first, as many as the router weighs.
  // Tasks' answers aren't among them: the work's progress tells of those.
  const unacked = () =>
    data.messages
      .filter(
        (message): message is AgentMessage =>
          message.role === 'agent' && !message.acked && message.event !== 'work' && !isWriting(message),
      )
      .slice(-config.acksRead);

  const acknowledge = (ids: string[]) => {
    const now = new Date().toISOString();
    const acked = unacked().filter((message) => ids.includes(message.id));
    for (const message of acked) {
      message.acked = now;
      delete message.deferred;
    }
    if (acked.length) keep();
  };

  // Answers the user put off for later: no longer acknowledged, and told of again by the next
  // briefing, even one that told of them before.
  const defer = (ids: string[]) => {
    const now = new Date().toISOString();
    const put = data.messages.filter(
      (message): message is AgentMessage => message.role === 'agent' && ids.includes(message.id) && !isWriting(message),
    );
    for (const message of put) {
      message.deferred = now;
      delete message.acked;
      delete message.briefed;
    }
    if (put.length) keep();
  };

  // Briefs the user who is back, when there is something to tell: what arrived in their inboxes,
  // the answers they haven't acknowledged and no briefing told them of, what they put off for
  // later, the asks still waiting on them, and the answers still working. Each answer is told once;
  // a briefing is never told of in another. The agents read the rest of the conversation as usual.
  const brief = async (client: string, since: string, context?: AskInput['context']) => {
    const told = unacked().filter((message) => !message.briefed && !message.deferred && message.event !== 'wake');
    const later = data.messages.filter(
      (message): message is AgentMessage =>
        message.role === 'agent' && Boolean(message.deferred) && !message.acked && !message.briefed,
    );
    const turns = [...running.values()];
    const isAsking = ({ message }: Running) =>
      message.actions.some((action) => action.ask && action.status === 'waiting');
    const asking = turns.filter(isAsking).map(({ message }) => lineOf(message));
    const working = turns
      .filter((turn) => !isAsking(turn) && turn.message.event !== 'work')
      .map(({ message }) => lineOf(message));
    const progress = progressOf(data.work ?? [], since);
    const arrived = await arrivals(since);
    if (!told.length && !later.length && !asking.length && !working.length && !progress.length && !arrived.length) {
      return;
    }

    // Each answer with the words it answered, which the briefing tells of rather than reads before it.
    const unseen = told.flatMap((message) => [...data.messages.filter(({ id }) => id === message.to), message]);
    const now = new Date().toISOString();
    for (const message of [...told, ...later]) message.briefed = now;

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
          later: later.map(lineOf),
          waiting: asking,
          working,
          progress,
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

  // A running answer as the router and whoever is asked about it see it: who is at work, what it
  // said and did so far, and the goal of the task it does, if any.
  const runningLine = (message: AgentMessage): RunningLine => {
    const task = message.task ? data.work?.find(({ id }) => id === message.task) : undefined;
    return { id: message.id, agent: message.agent, line: lineOf(message), ...(task ? { goal: task.goal } : {}) };
  };

  // Hands one task to one of the user's experts: queued behind what that expert already has, and
  // started as soon as the expert and the object are free. A task's own answer hands work only to
  // its own expert, what it means to do next, so work never fans out on its own.
  const assign = async (args: IRPCData, by: AgentMessage, client: string): Promise<CallResult> => {
    const { title, agent, goal, object } = (args ?? {}) as Partial<
      Pick<WorkTask, 'title' | 'agent' | 'goal' | 'object'>
    >;
    if (!title || !agent || !goal || !object?.path) {
      throw new Error(`${WORK_ASSIGN} needs a title, an agent, a goal, and an object with its path`);
    }
    if (by.event === 'work' && agent !== by.agent) {
      throw new Error('A task hands work only to its own expert: say in your answer what else needs doing');
    }
    if (!agent.startsWith(`${AGENTS_PATH}/`) || !(await exists(agent))) throw new Error(`No expert at ${agent}`);

    data.work ??= [];
    const ahead = data.work.filter((task) => task.agent === agent && isOpen(task)).length;
    const { path, part, id } = object;
    data.work.push({
      id: crypto.randomUUID(),
      title,
      agent,
      goal,
      object: { path, ...(part ? { part } : {}), ...(id ? { id } : {}) },
      status: 'queued',
      by: by.id,
      client,
      created: new Date().toISOString(),
    });
    keep();
    pump();
    return { queued: true, ahead };
  };

  // Starts every task whose expert and object are free, in the order they were handed out. An
  // expert works on one task at a time, and its tasks keep their order: one waiting for its object
  // holds the expert's later ones back.
  const pump = () => {
    const running = (data.work ?? []).filter((task) => task.status === 'running');
    const busy = new Set(running.map((task) => task.agent));
    const held = running.map((task) => task.object);
    for (const task of data.work ?? []) {
      if (task.status !== 'queued' || busy.has(task.agent)) continue;
      busy.add(task.agent);
      if (held.some((object) => overlaps(object, task.object))) continue;
      held.push(task.object);
      perform(task);
    }
  };

  // Runs a task as the expert's own answer, with its goal and its object and none of the
  // conversation, in its own copy of the current context; then the next ones start.
  const perform = (task: WorkTask) => {
    task.status = 'running';
    keep();
    const origin: Origin = { client: task.client, event: 'work', task: task.id, entry: task.agent };
    const input: AskInput = { text: task.goal, context: { event: 'work', object: task.object as IRPCData } };
    hold(
      withContext(detachedContext(), async () => {
        const message = await answer(origin, input, []).catch(() => undefined);
        task.answer = message?.id;
        task.status = message?.status === 'done' ? 'done' : 'failed';
        task.ended = new Date().toISOString();
        keep();
        pump();
        finished(task);
      }),
    ).catch((error: Error) => IRPC_STORE.error(error, [{ task: task.goal }]));
  };

  // Once a batch's last task ends, Wedyan says so on the desktop it was handed out on.
  const finished = ({ title, by }: WorkTask) => {
    const batch = (data.work ?? []).filter((task) => task.title === title && task.by === by);
    if (batch.some(isOpen)) return;
    const failed = batch.filter((task) => task.status === 'failed').length;
    const job: FinishedJob = { title, ...(failed ? { failed: `${failed} of ${batch.length} tasks failed` } : {}) };
    start({ client: batch[0].client, event: 'job' }, { text: JOB_TEXT, context: { event: 'job', job } });
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

  /**
   * Puts a form to the user, in the answer that asked: a widget like any other, so it comes back the
   * same after a reload and any desktop can fill it in, with the agent waiting here until one does.
   */
  const askUser = (action: AskAction, message: AgentMessage, signal: AbortSignal) =>
    new Promise<IRPCData | undefined>((resolve) => {
      const id = crypto.randomUUID();
      message.parts.push({
        type: 'widget',
        id,
        status: 'ready',
        intent: action.intent ?? '',
        nodes: formNodes(action.args as IRPCData[]),
        form: {},
        formAction: ASK_REPLY,
        once: true,
      });
      forms.set(id, resolve);
      signal.addEventListener('abort', () => forms.delete(id) && resolve(undefined), { once: true });
      keep();
    });

  /** Settles a widget with its facts, replying to the agent when it's a form one is waiting on. */
  const settle = (widget: WidgetPart, form: Record<string, IRPCData>) => {
    widget.form = form;
    widget.settled = new Date().toISOString();
    forms.get(widget.id)?.(form);
    forms.delete(widget.id);
    keep();
  };

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
        // Forms and work are the conversation's own; every other action runs on the desktop. A
        // desktop away isn't waited for to take new attempts: the server keeps them itself.
        desktop: (action) => {
          if (action.name === USER_ASK) return askUser(action, message, turn.controller.signal);
          if (action.name === WORK_ASSIGN) return assign(action.args, message, origin.client);
          if (action.name === DOC_ATTEMPTS && !desktops.has(origin.client)) return Promise.resolve(undefined);
          return onDesktop(origin.client, action);
        },
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
        ...(origin.entry ? { entry: origin.entry } : origin.event && config.briefer ? { entry: config.briefer } : {}),
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
    return message;
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
        // acknowledge or put off for later, and whether they show the user missed any, the latest
        // included.
        const judgment = await judge(
          input.text,
          answers.map(({ message }) => runningLine(message)),
          earlier,
          latestUnacked,
        );
        const taken = latestUnacked ? [latestUnacked.id, ...judgment.acks] : judgment.acks;
        acknowledge(taken.filter((id) => !judgment.missed.includes(id) && !judgment.later.includes(id)));
        defer(judgment.later.filter((id) => earlier.some((message) => message.id === id)));

        // Words that only ask about running work are told at once, by whoever is at it, from what
        // it's doing, while it goes on.
        const asked = running.get(judgment.about ?? '');
        if (asked) {
          const working = runningLine(asked.message);
          const context = { ...input.context, event: 'about', working: working as IRPCData };
          start({ ...originOf(words), entry: working.agent }, { ...input, context });
          return true;
        }

        const target = running.get(judgment.continues ?? '');
        if (target) {
          words.answer = target.message.id;
          target.followUps.push(input.text);
          // Said rather than filled in, as hands-free it would be: the answer's form is answered.
          for (const part of target.message.parts) {
            if (part.type === 'widget' && forms.has(part.id)) settle(part, { said: input.text });
          }
          return true;
        }

        // Answers the words may or may not cover: a proactive assistant asks.
        const unclear = earlier.filter((message) => judgment.unclear.includes(message.id) && !message.acked);
        const proactive = unclear.length ? ((await readSettings())?.proactive ?? config.proactive) : false;
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
      // A job the desktop ran ended: Wedyan says so on that desktop. Told while the user is away,
      // it stays unacknowledged, so the briefing tells of it.
      finished: async (job: FinishedJob, client: string) => {
        await loaded;
        start({ client, event: 'job' }, { text: JOB_TEXT, context: { event: 'job', job } });
        return true;
      },
      ack: async (id: string, form: Record<string, IRPCData>) => {
        await loaded;
        const widget = widgetOf(data.messages, id);
        // The first says what happened: a second press can't change it.
        if (!widget || widget.settled) return false;
        settle(widget, form);
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
/** How far a batch of work got: how many of its tasks are done or failed, and what's under way. */
type Progress = { title: string; done: number; failed: number; total: number; now: string[] };

/**
 * How far each batch of work got, for a briefing: the batches still going, and those that ended
 * while the user was away.
 *
 * @param work - The conversation's work.
 * @param since - Since when the user was away.
 * @returns Each such batch's progress, in the order it was handed out.
 */
function progressOf(work: WorkTask[], since: string): Progress[] {
  const batches = new Map<string, WorkTask[]>();
  for (const task of work) {
    const key = `${task.by}:${task.title}`;
    batches.set(key, [...(batches.get(key) ?? []), task]);
  }
  return [...batches.values()]
    .filter((batch) => batch.some((task) => isOpen(task) || (task.ended && task.ended >= since)))
    .map((batch) => ({
      title: batch[0].title,
      done: batch.filter((task) => task.status === 'done').length,
      failed: batch.filter((task) => task.status === 'failed').length,
      total: batch.length,
      now: batch.filter((task) => task.status === 'running').map((task) => `${task.agent}: ${task.goal}`),
    }));
}

/** Whether a task is still to be done: waiting its turn, or under way. */
function isOpen(task: WorkTask): boolean {
  return task.status === 'queued' || task.status === 'running';
}

/** Whether two tasks are about the same thing: the same file whole, or one part of it either holds. */
function overlaps(a: WorkObject, b: WorkObject): boolean {
  if (a.path !== b.path) return false;
  if (!a.part || !b.part) return true;
  return a.part === b.part && a.id === b.id;
}

function originOf(words: UserMessage): Origin {
  return { client: words.client, to: words.id };
}

/**
 * How the router judges the user's words against the conversation: it is shown the words, the
 * answers still being written, and the earlier answers the user hasn't acknowledged, each by id.
 */
export const JUDGE_PROMPT = `Words from the user arrived. Below are Wedyan's answers still being written ("running") and its earlier answers the user hasn't acknowledged yet ("unacknowledged"), each with its id. The one marked "latest" came just before the words: the user has it in front of them. Decide:
- continues: the id of the running answer the words continue, by answering its question, correcting it or adding to it; null when they are a request of their own.
- about: the id of the running answer the words only ask about, like "how far are you?" or "why that scene?", to be told without changing it; null otherwise. Words that change what it does continue it instead.
- acks: the ids of the other unacknowledged answers the words show the user has taken in: replying to them, building on them, confirming them or thanking for them, like "copy that".
- unclear: the ids of the other unacknowledged answers the words may or may not cover.
- missed: the ids of any unacknowledged answers, the latest included, the words show the user hasn't taken in, like "what did you say?".
- later: the ids of any unacknowledged answers, the latest included, the words put off for later, like "I'll watch it later" or "remind me when I'm back".

Reply with only JSON: {"continues": id or null, "about": id or null, "acks": [ids], "unclear": [ids], "missed": [ids], "later": [ids]}`;

/** What the router made of the user's words; ids it made up are dropped where they are used. */
type Judgment = {
  continues?: string;
  about?: string;
  acks: string[];
  unclear: string[];
  missed: string[];
  later: string[];
};

/** A running answer as the router is shown it: who is at work, what it said and did, and a task's goal. */
type RunningLine = { id: string; agent: string; line: string; goal?: string };

/**
 * Judges the user's words: which running answer they continue or only ask about, which older
 * answers they acknowledge or may, which they show the user missed, and which they put off for
 * later. Nothing continued, asked about, acknowledged, missed or put off when the router fails or
 * can't tell.
 *
 * @param text - The user's words.
 * @param answers - The answers being written.
 * @param earlier - The answers the user hasn't acknowledged.
 * @param latest - The one of them just before the words, if any.
 * @returns The router's judgment.
 */
async function judge(
  text: string,
  answers: RunningLine[],
  earlier: AgentMessage[],
  latest?: AgentMessage,
): Promise<Judgment> {
  const reply = await askRouter(JUDGE_PROMPT, {
    words: text,
    running: answers,
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
      ...(typeof parsed.about === 'string' ? { about: parsed.about } : {}),
      acks: ids(parsed.acks),
      unclear: ids(parsed.unclear),
      missed: ids(parsed.missed),
      later: ids(parsed.later),
    };
  } catch {
    return { acks: [], unclear: [], missed: [], later: [] };
  }
}

/** Whether an answer is still being written: it keeps changing, so it is neither acknowledged nor moved to an older page. */
function isWriting(message: AgentMessage): boolean {
  return message.status === 'running' || message.status === 'idle';
}

/** The user's settings; `undefined` before they have any. */
async function readSettings(): Promise<UserSettings | undefined> {
  return (await read<UserSettings>(SETTINGS_PATH, { encoding: 'json' })) ?? undefined;
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
    ...(input.selections?.length ? { selections: input.selections } : {}),
  };
}

/** A form the composer drew as what the desktop's card holds: its fields, and what sends them. */
function formNodes(fields: IRPCData[]): IRPCData[] {
  const send = { role: 'button', props: { size: 'sm', variant: 'filled', type: 'submit' }, children: [SEND_LABEL] };
  return [
    { role: 'card-body', children: fields },
    { role: 'card-actions', children: [send] },
  ];
}

/** A widget of an answer on the live page, by its id. */
function widgetOf(messages: ConversationMessage[], id: string): WidgetPart | undefined {
  for (const message of messages) {
    if (message.role !== 'agent') continue;
    const found = message.parts.find((part) => part.type === 'widget' && part.id === id);
    if (found) return found as WidgetPart;
  }
  return undefined;
}

/** What the agents read of a widget: what it showed, and for a form, what became of it. */
function shownOf(part: WidgetPart): string {
  if (part.settled) return `${part.intent} (done: ${JSON.stringify(part.form)})`;
  return part.formAction ? `${part.intent} (waiting on the user)` : part.intent;
}

/** A new answer, to the user's words or an event, before it starts. */
function agentMessage({ to, event, task }: Origin): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role: 'agent',
    ...(to ? { to } : {}),
    ...(event ? { event } : {}),
    ...(task ? { task } : {}),
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
  const shown = message.parts.filter((part): part is WidgetPart => part.type === 'widget').map(shownOf);
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
    ...(data.work?.length ? { work: JSON.parse(JSON.stringify(data.work)) as WorkTask[] } : {}),
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
