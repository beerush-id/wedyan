import { mutable, subscribe } from '@airlib/react';
import { isWidgetRole } from '@airlib/react-aui/dynamic';
import {
  type ChatInput,
  type ChatMessage,
  type ChatOutput,
  type ChatTool,
  chatTurns,
  type ToolCall,
  WEB_SEARCH,
} from '@irpclib/ai-kit';
import type { AIAdapter } from '@irpclib/ai-kit/worker';
import { getAbortSignal, IRPC_STORE, type IRPCData, type IRPCRouter, setContext, stream } from '@irpclib/irpc';
import { fsContext } from '@irpclib/r2-file/context';
import { optionsOf, readsAsText } from '../documents/file-types.js';
import { WORK_EFFORTS, WORK_MODELS } from '../documents/generation.js';
import { logger } from '../logger.js';
import { isUsageLimit } from '../share/usage.js';
import {
  type ActionOutcome,
  type AskAction,
  type AskInput,
  type AskPart,
  type AskState,
  type AskStep,
  actorOf,
  askSeed,
  askWedyan,
} from './agent.h.js';
import { createMarkerParser } from './marker.js';
import { kernel } from './package.js';
import { createPartWriter, type PartWriterHooks } from './parts.js';

/** The kernel's log: tool calls at debug level, so a dev server shows what agents actually did. */
const log = logger.create({ tags: ['kernel'] });

export type { AskState } from './agent.h.js';

/**
 * What awaiting a call, an action or an ask gives: its data, with any blob it points at downloaded,
 * as awaiting an `IRPCBlob` does; `undefined` when there was nothing to return.
 */
export type CallResult = Awaited<IRPCData> | undefined;

/** A call the kernel resolves on the server, by name. `undefined` means nothing to return. */
export type SysHandler = (args: IRPCData, ask: SysAsk) => Promise<CallResult> | IRPCData | undefined;

/**
 * The ask a `sys.*` call is made in: the agent making it, the desktop the ask reaches, and how a long
 * call shows what it's doing, each piece of work a row of the answer of its own, timed as it runs.
 */
export type SysAsk = {
  agent: string;
  desktop: (action: AskAction) => Promise<CallResult>;
  activity: <T>(name: string, detail: string, work: () => Promise<T>) => Promise<T>;
  /** What the window in front says about the picture being made. */
  front: () => FrontPicture;
  /** Sets how many more turns the agent has, from what it says the work takes. */
  budget: (turns: number) => { granted: number; used: number };
};

/** The context key holding the ask a call is made in: the system's functions read it, and the desktop's calls have none. */
export const ASK_KEY = 'ask';

/** What the window in front says about the picture being made: the still it's on, or how a new one is made. */
export type FrontPicture = { path?: string; settings?: { model?: string; aspect?: string; batch?: number } };

/** What a model is told when a call gives it binary content, which it can't read. */
const BINARY = 'That file is a picture, a video or a sound: it can be shown or opened, not read';

/** The tool that reads a file. */
const FILE_READ = 'r2-file.read';

/** What the window in front picks for the work: a work model and an effort, by name. */
type FrontWork = { model?: string; effort?: string };

/** What the system's own tools start with. */
const SYSTEM_TOOL = 'sys.';

/**
 * A call's result as a model reads it: data as it is, and a downloaded blob as a note on how to
 * read it instead, since binary content reaches a model as nothing.
 *
 * @param result - What awaiting the call gave.
 * @returns What the model reads.
 */
export function dataOf(result: Awaited<IRPCData>): IRPCData;
export function dataOf(result: CallResult): IRPCData | undefined;
export function dataOf(result: CallResult): IRPCData | undefined {
  return result instanceof Blob ? { error: BINARY } : result;
}

/** What the kernel runs asks with: model access, the agents, and its server-side calls. */
export interface KernelConfig {
  adapter: AIAdapter;
  agents: Record<string, AgentProfile>;
  /** The first agent of every ask: the router. */
  entry: string;
  /** The agent that turns what other agents describe into widgets; it never speaks. */
  composer?: string;
  /**
   * Serve the packages whose tools agents call by `package.function`, one router per transport;
   * each call runs through its stub.
   */
  routers?: IRPCRouter[];
  /** Server-side calls by name (`sys.*`), for what isn't a package tool yet. */
  sys?: Record<string, SysHandler>;
  /** The skills a skilled agent can be handed, by name; built on the server, never chosen by the client. */
  skills?: Record<string, AgentSkill>;
  /** Loads the user's persona at the start of each ask, read on the server. */
  persona?: () => Promise<string | undefined> | string | undefined;
  /**
   * Adds the user's own agents to the agents at the start of each ask, read on the server: the
   * agents the ask runs with.
   */
  userAgents?: (agents: Record<string, AgentProfile>) => Promise<Record<string, AgentProfile>>;
  limits?: AgentLoopOptions['limits'];
}

let config: KernelConfig | undefined;

/**
 * Sets what the kernel runs asks with. Called once by the server entry before serving.
 *
 * @param next - Model access, agents, the entry agent and server-side calls.
 */
export function setupKernel(next: KernelConfig): void {
  config = next;
}

/** The context key naming who makes a call; the server's guards read it. */
export const ACTOR_KEY = 'actor';

/** The actor of every call an ask makes: its agents', never the user's own. */
export const AGENT_ACTOR = 'agent';

kernel.construct(askWedyan, (input) =>
  stream((state, resolve) => {
    const controller = new AbortController();
    getAbortSignal()?.addEventListener('abort', () => controller.abort(), { once: true });

    const followUps: string[] = [];
    state.answer('followUp', (text) => {
      followUps.push(text);
      return true;
    });

    void askWith({
      input: toChatInput(input),
      state: state.data,
      desktop: (action) => state.ask(action.name, action.args, { after: action.after, actor: actorOf(action) }),
      followUps: () => followUps.splice(0),
      signal: controller.signal,
    }).then(() => resolve());

    // Returned before the ask finishes, so closing the call can stop it.
    return () => controller.abort();
  }, askSeed()),
);

/** One ask to run with the kernel's setup: what the agents read, where the answer goes, and its desktop. */
export interface AskOptions {
  /** The conversation before the ask, for the agent that holds it. */
  conversation?: ChatMessage[];
  input: ChatInput;
  /** The answer's live state, mutated in place as it runs. */
  state: AskState;
  /** Runs an action or ask on the desktop; `undefined` means no desktop ran it. */
  desktop: (action: AskAction) => Promise<CallResult>;
  /** What the user said while the ask was running. */
  followUps?: () => string[];
  /** Hears what became of each action and ask. */
  track?: AgentLoopOptions['track'];
  signal?: AbortSignal;
  /**
   * The agent that answers first, instead of the kernel's entry (the router): for an ask whose
   * handler is already known, like one Wedyan starts on its own.
   */
  entry?: string;
}

/**
 * Runs one ask with the kernel's setup: the agents and their persona, server tools through the
 * routers and `sys.*`, and actions on the desktop. Every call it makes runs as the agent actor.
 *
 * @param options - The ask, where its answer streams, and how the desktop is reached.
 * @returns Once the ask has ended; never throws, the state says how it ended.
 */
export async function askWith(options: AskOptions): Promise<void> {
  if (!config) throw new Error('Kernel is not set up');
  setContext(ACTOR_KEY, AGENT_ACTOR);
  const { adapter, entry, composer, routers = [], sys = {}, skills, limits } = config;
  // A profile that can't be read leaves the ask without a persona rather than stalling it.
  const persona = await Promise.resolve()
    .then(() => config?.persona?.())
    .catch(() => undefined);
  // Nor can the user's own agents stall it: it runs with Wedyan's alone.
  const base = config.agents;
  const agents = await Promise.resolve()
    .then(() => config?.userAgents?.(base) ?? base)
    .catch(() => base);
  const budget: TurnBudget = {};
  const sysAsk: SysAsk = {
    get agent() {
      return options.state.agent;
    },
    desktop: options.desktop,
    activity(name, detail, work) {
      const timer = timeStep(options.state, 'call', name, options.state.agent);
      timer.step.detail = detail;
      return work().finally(timer.end);
    },
    front: () => frontPicture(options.input),
    budget(turns) {
      const used = options.state.turn;
      budget.turns = used + turns;
      return { granted: turns, used };
    },
  };
  setContext(ASK_KEY, sysAsk);

  await runAgentLoop({
    adapter,
    agents,
    budget,
    entry: options.entry ?? entry,
    composer,
    skills,
    persona,
    limits,
    conversation: options.conversation,
    input: options.input,
    state: options.state,
    // Tools are the server's: a package tool or a `sys.*` call. The desktop is reached by actions and asks.
    resolve: async (call) => {
      // A model sends one input object; the tool's router turns it into the stub's own arguments.
      const input = call.name.startsWith(SYSTEM_TOOL) ? withLists(call.args) : call.args;
      for (const router of routers) {
        // The mapping and the stub come from the same package, so they always agree.
        const tool = router.toolOf(call.name);
        const args = router.argsOf(call.name, input as Record<string, unknown>);
        // With no encoding a read is a download, which only a browser can load and a model couldn't use.
        if (call.name === FILE_READ && !readsAsText(String(args?.[0]))) return { error: BINARY };
        if (tool && args) return inHomePaths((await tool.pkg.call(tool.spec.name, ...args)) as CallResult);
      }
      return sys[call.name]?.(call.args, sysAsk);
    },
    act: async (action) => (sys[action.name] ? sys[action.name](action.args, sysAsk) : options.desktop(action)),
    followUps: options.followUps,
    track: options.track,
    signal: options.signal,
  });
}

/**
 * Asks the router's model one short question with no tools, for a decision the kernel makes outside
 * an ask, such as which running answer the user's words continue.
 *
 * @param system - The question's instructions.
 * @param request - What it decides on, as one object.
 * @returns The router's answer, as text.
 */
export async function askRouter(system: string, request: IRPCData): Promise<string> {
  if (!config) throw new Error('Kernel is not set up');
  const router = config.agents[config.entry];
  return answerOnce(config.adapter, { ...router, system, tools: [] }, request);
}


/** One agent: a model, its system prompt (format and skill), its calls, and who it may hand off to. */
export interface AgentProfile {
  name: string;
  model: string;
  system: string;
  /** Calls this agent may make, besides `handoff`. */
  tools: ChatTool[];
  /** Agents this one may hand the ask to; the loop offers `handoff` only when there are any. */
  handoffs?: string[];
  /** Holds the whole conversation, so every other agent can work from only what it's handed. */
  holdsConversation?: boolean;
  /** Acts through the `act` call, so it can't say something is happening without doing it. */
  actsByCall?: boolean;
  /** Answers only in JSON, held to valid JSON by the provider. */
  json?: boolean;
  /** Whether it can search the web itself, where the provider hosts that. */
  webSearch?: boolean;
  /** Whether a job handed to it starts with a call, so it can't promise the work and stop there. */
  actsFirst?: boolean;
  /** How hard its model reasons, in the provider's terms (`minimal`, `low`, …); the provider's default if unset. */
  effort?: string;
  /** Takes a skill at handoff: its prompt and tools are added to this profile's for the rest of the ask. */
  skilled?: boolean;
  /** Its own persona, spoken instead of the assistant's: the user's own agents have one. */
  persona?: string;
}

/** A job a skilled agent can be handed: what it's for (for the one routing), its prompt and its tools. */
export interface AgentSkill {
  name: string;
  /** One line on what the skill is for, offered to whoever hands off. */
  description: string;
  system: string;
  tools: ChatTool[];
  /** The work model it runs on, by name, unless the window in front picks another; the agent's own without one. */
  model?: string;
}

/** Everything needed to resume an ask after the turn it was taken on. */
export interface LoopSnapshot {
  agent: string;
  /** The skill the active agent was handed, if any. */
  skill?: string;
  /** The active agent's conversation. */
  history: ChatMessage[];
  /** What the user said: the input and every follow-up. Survives handoffs. */
  asks: ChatMessage[];
  turn: number;
  handoffs: number;
  /** The turn the agent's budget runs to, if it reported one. */
  budget?: number;
}

/**
 * What an agent's own estimate of its work set: the turn its budget runs to. Work grows with what's
 * asked, so no fixed number fits: the system grants what the agent reports, and the day's usage
 * limits are what bound it.
 */
export type TurnBudget = { turns?: number };

export interface AgentLoopOptions {
  /** Model access; every agent's model must be served by one of its drivers. */
  adapter: AIAdapter;
  agents: Record<string, AgentProfile>;
  /** The first agent: the router. */
  entry: string;
  /** The agent that composes the widgets and `ask_user` forms other agents describe. */
  composer?: string;
  /** The skills a skilled agent can be handed, by name. */
  skills?: Record<string, AgentSkill>;
  /**
   * The user's persona, added to every agent's system prompt so the voice never changes, and to the
   * composer's so the look they asked for never does either.
   */
  persona?: string;
  /** The conversation before the ask, read only by the agent that holds it. */
  conversation?: ChatMessage[];
  input: ChatInput;
  /** Mutated in place as the ask runs. */
  state: AskState;
  /**
   * Resolves every call except `handoff`, wherever its data lives. `undefined` means nothing
   * answers that call, which the model is told.
   */
  resolve: (call: ToolCall) => Promise<CallResult>;
  /**
   * Runs one action or ask. They run one at a time, in order; a throw is a failure the model is told
   * about, and skips that turn's remaining ones. For an action, `undefined` means nothing ran it: a
   * no-op. For an ask, what it returns is the reply the model reads; `undefined` means nothing answered.
   */
  act?: (action: AskAction) => Promise<CallResult>;
  /**
   * Hears what became of each action and ask: queued (`waiting`), then `done`, `failed` (with the
   * error), `skipped` (an earlier one of its turn failed), or `unanswered` (an ask nothing replied to).
   */
  track?: (action: AskAction, outcome: ActionOutcome) => void;
  /** Drained at each safe turn: what the user said while the ask was running. */
  followUps?: () => string[];
  signal?: AbortSignal;
  limits?: { turns?: number; handoffs?: number; forms?: number };
  /** The budget the agent reported, read before each turn; without one, `limits.turns`. */
  budget?: TurnBudget;
  resume?: LoopSnapshot;
  /** Called after every completed turn. */
  onSnapshot?: (snapshot: LoopSnapshot) => void;
}

/** How much of a call's arguments the record keeps: a file being written can be all of its content. */
const ARGS_LIMIT = 500;

/** A step of an answer being timed. */
type StepTimer ={ step: AskStep; elapsed(): number; end(): void };

/**
 * Starts timing a step of an answer, in the answer itself, so its timing is kept with it.
 *
 * @param state - The answer.
 * @param kind - What kind of step it is.
 * @param name - What's running.
 * @param agent - The agent it runs for.
 * @returns The stored step, and what reads and ends its timing.
 */
function timeStep(state: AskState, kind: AskStep['kind'], name: string, agent: string): StepTimer {
  state.steps ??= [];
  state.steps.push({ kind, name, agent, after: state.parts.length - 1, started: new Date().toISOString() });
  // Written through the stored element, so a reactive answer sees every later change.
  const step = state.steps[state.steps.length - 1];
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  return {
    step,
    elapsed,
    end() {
      step.ended = new Date().toISOString();
      step.ms = elapsed();
    },
  };
}

/**
 * What a call is working on, for the row that shows it.
 *
 * @param args - The call's arguments.
 * @returns The path, query or name it's given, in its options or beside them, when it has one.
 */
function detailOf(args: unknown): string | undefined {
  const { path, query, name, options, items } = (args ?? {}) as { path?: unknown; query?: unknown; name?: unknown; options?: string | object; items?: unknown };
  const first = Array.isArray(items) ? (items[0] as { name?: unknown } | undefined)?.name : undefined;
  const detail = path ?? query ?? name ?? first ?? optionsOf<{ query?: unknown }>(options)?.query;
  return typeof detail === 'string' ? detail : undefined;
}

/** The call an agent makes to pass the ask to another agent. */
export const HANDOFF = 'handoff';

/** The call an agent makes to do something on the desktop: what it says and what it does are one. */
export const ACT = 'act';

const DEFAULT_TURN_LIMIT = 12;

/** How many turns before its budget ends an agent is told: enough to report again and finish the round it's on. */
const BUDGET_WARNING = 3;
const DEFAULT_HANDOFF_LIMIT = 3;

/** How many forms one answer may put to the user: a reply that doesn't help must not start a loop. */
const DEFAULT_FORM_LIMIT = 3;

/** What an agent is told when it would ask once more than that. */
/** What an agent that acts first hears when it answered a handed job with words alone. */
const NOT_ACTED =
  'You were handed this job and made no call. Make the call now, or say plainly why none is needed. This note is between you and the system: the user never sees it, so never mention or apologize for it.';

const TOO_MANY_FORMS =
  'You have asked the user enough in this answer: don’t ask again. Say in words what you still need, and stop.';

/**
 * Runs one ask to the end. Each turn calls the active agent's model, translates its markers into
 * the answer's parts, queues its actions, and resolves its calls. At the safe turn it takes in
 * follow-ups, applies a handoff, and tells the model what went wrong since the last turn (failed
 * actions, malformed markers). A widget the agent describes is composed by the composer while the
 * agent keeps going, and an `ask_user` form before the user is asked. The ask ends when a turn makes
 * no calls, no follow-up is waiting, every action has run without a failure to report, and every
 * widget is drawn or failed. Routing is not a separate step: the entry agent routes by calling
 * `handoff`.
 *
 * Never throws: failures, aborts and limits end the ask with the status and reason in `state`.
 *
 * @param options - Agents, model access, call and action resolution, the ask and its state.
 * @returns Once the ask has ended.
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<void> {
  const { adapter, agents, state, signal, resume, skills = {}, persona, budget = {} } = options;
  budget.turns ??= resume?.budget;
  // An estimate only ever adds: reporting a small job doesn't cut what any ask starts with.
  const turnLimit = () => Math.max(options.limits?.turns ?? DEFAULT_TURN_LIMIT, budget.turns ?? 0);
  const handoffLimit = options.limits?.handoffs ?? DEFAULT_HANDOFF_LIMIT;
  const formLimit = options.limits?.forms ?? DEFAULT_FORM_LIMIT;

  let skill = resume?.skill ? skills[resume.skill] : undefined;
  const front = frontWork(options.input);
  let agent = withSkill(agents[resume?.agent ?? options.entry], skill, front);
  const given = resume ? [...resume.asks] : chatTurns(options.input);
  const asks = given.map(withoutCommands);
  const held = (profile: AgentProfile) => (profile.holdsConversation ? (options.conversation ?? []) : []);
  let history = resume ? [...resume.history] : [...held(agent), ...asks];
  let turn = resume?.turn ?? 0;
  let handoffs = resume?.handoffs ?? 0;
  let handed = false;
  // The user was told as the ask was handed over, so the next agent's opening words would say it again.
  let told = false;
  let nudged = false;
  // The limit the agent was last warned about, so a new budget is warned about too.
  let warned = 0;
  const actions = createActionQueue(options.act, options.track);
  const problems: string[] = [];
  let forms = 0;
  const composer = options.composer ? agents[options.composer] : undefined;
  const compositions: Promise<void>[] = [];
  // What a widget can open on the desktop. Commands stay out until they say what they do and take:
  // a name alone drew buttons that had nothing to do with the card.
  const { links } = given.map(contextOf).find(Boolean) ?? {};
  const reach = links ? { links } : {};
  // The pages a web search cited: real addresses, for what's drawn to link to.
  let sources: IRPCData[] = [];
  const compose = (request: Record<string, IRPCData>) => {
    if (!composer) return Promise.reject(new Error('No composer to draw widgets'));
    const timer = timeStep(state, 'compose', composer.name, agent.name);
    return composeWidget(
      adapter,
      persona ? { ...composer, system: `${composer.system}\n\n${persona}` } : composer,
      { ...request, ...reach, ...(sources.length ? { sources } : {}) },
      signal,
    ).finally(timer.end);
  };

  const end = (status: AskState['status'], reason?: string) => {
    state.status = status;
    if (reason) state.reason = reason;
  };

  state.status = 'running';
  state.agent = agent.name;
  if (skill) state.skill = skill.name;
  state.turn = turn;

  try {
    for (;;) {
      if (signal?.aborted) return end('stopped', 'Aborted');
      if (turn >= turnLimit()) return end('stopped', 'Turn limit reached');

      turn += 1;
      state.turn = turn;
      const current = turn;
      const tools = toolsOf(agent, agents, skills);
      // The user's own agents speak as themselves; the rest as the assistant.
      const voice = agent.persona ?? persona;
      const system = voice ? `${agent.system}\n\n${voice}` : agent.system;
      const callable = new Set(tools.map((tool) => tool.name));
      let asked = false;
      // What the agent did on the desktop this turn, so whoever it hands to doesn't do it again.
      const acted: IRPCData[] = [];
      // What the agent tells the user as it hands the ask over: the handoff carries it, so it can't
      // say it instead of making the call. The user hears it as soon as it's written, brief or no brief.
      let said = '';
      const tell = (words: string) => {
        if (said || !words) return;
        said = words;
        state.parts.push({ type: 'text', chunks: [words], text: words, spoken: true });
      };
      // A call shows once it's named, long before its arguments are written.
      const named = new Map<string, StepTimer[]>();
      const announce = (name: string) => {
        if (name === HANDOFF || name === ACT) return;
        named.set(name, [...(named.get(name) ?? []), timeStep(state, 'call', name, agent.name)]);
      };
      // A search runs on the provider's side, inside the turn: it has no result to wait for here.
      const searched = (query: string) => {
        const timer = named.get(WEB_SEARCH)?.shift();
        if (!timer) return;
        timer.step.detail = query;
        timer.end();
      };
      const queue = (written: AskAction) => {
        // A call written as an action would run with its result lost: the model must call it.
        if (callable.has(written.name)) {
          problems.push(`${written.name} is a call, not an action: call it as a tool to get its result`);
          return;
        }
        if (written.name === 'ask_user' && ++forms > formLimit) {
          problems.push(TOO_MANY_FORMS);
          return;
        }
        if (written.ask) asked = true;
        else acted.push({ action: written.name, args: written.args });
        // Stamped now: by the time it runs, the ask may have been handed to another agent.
        const action = { ...written, agent: agent.name };
        if (action.name !== 'ask_user') return actions.add(action, current);
        // Composed now, while the turn streams; the user is asked once their turn in the queue comes.
        const intent = String(action.args);
        actions.add(
          { ...action, intent },
          current,
          compose({ form: intent }).then(({ nodes }) => nodes),
        );
      };
      const turnWith = (timer: StepTimer) =>
        modelTurn(adapter, { ...agent, system, tools }, history, state.parts, signal, timer, { announce, searched, handing: (args) => tell(drafted(args)), cited: (found) => (sources = found), quiet: handed && told }, {
          onWidget: (part, intent) => {
            // The agent keeps speaking while its widget is composed; the part fills in place.
            compositions.push(
              compose({ widget: intent }).then(
                (composed) => {
                  Object.assign(part, composed);
                  part.status = 'ready';
                },
                (error) => {
                  IRPC_STORE.error(error as Error, [{ composer: options.composer, widget: intent }]);
                  part.error = messageOf(error);
                  part.status = 'error';
                },
              ),
            );
          },
          onAction: queue,
          onInvalid: (problem) => problems.push(problem),
        });
      const take = () => {
        const timer = timeStep(state, 'model', agent.name, agent.name);
        return turnWith(timer).finally(timer.end);
      };
      const isEmpty =(result: { text: string; toolCalls: ToolCall[] }) => !result.text && !result.toolCalls.length;
      // An empty turn is usually a provider hiccup: one retry before giving up.
      let reply = await take();
      if (isEmpty(reply)) reply = await take();
      if (isEmpty(reply)) return end('error', `No answer from ${agent.model}`);
      // Ending on "I'll now…" with nothing done is a promise left hanging: it's held to it, once each
      // time, since a long job can stall between any two of its steps.
      if (agent.actsFirst && !reply.toolCalls.length && (handed || (reply.unfinished && !nudged))) {
        nudged = true;
        problems.push(NOT_ACTED);
      }
      if (reply.toolCalls.length) nudged = false;
      handed = false;

      history.push({
        role: 'assistant',
        type: 'text',
        text: reply.text,
        ...(reply.toolCalls.length ? { toolCalls: reply.toolCalls } : {}),
      });

      const [handoff, ...extraHandoffs] = reply.toolCalls.filter((call) => call.name === HANDOFF);
      const acting = reply.toolCalls.find((call) => call.name === ACT);
      const calls = reply.toolCalls.filter((call) => call.name !== HANDOFF && call.name !== ACT);
      tell(String(((handoff ?? acting)?.args as { say?: unknown } | undefined)?.say ?? '').trim());
      // What it does as it speaks: part of the call, so it can't say it and not do it.
      const queueAlong = (call: ToolCall) => {
        const { actions: along } = (call.args ?? {}) as { actions?: unknown };
        for (const { name, args } of Array.isArray(along) ? (along as AskAction[]) : []) {
          queue({ name, args: args ?? null, after: state.parts.length - 1 });
        }
      };
      if (acting) {
        queueAlong(acting);
        history.push(toolTurn(acting.id, { done: true }));
      }
      const timedCall = (call: ToolCall) => {
        const timer = named.get(call.name)?.shift() ?? timeStep(state, 'call', call.name, agent.name);
        timer.step.detail = detailOf(call.args);
        timer.step.args = JSON.stringify(call.args ?? {}).slice(0, ARGS_LIMIT);
        return resolveCall(options.resolve, call, agent.name)
          .then((result) => {
            timer.step.resultChars = JSON.stringify(dataOf(result))?.length ?? 0;
            return result;
          })
          .finally(timer.end);
      };
      // Already data the model reads; awaiting them again only widens their type to downloaded blobs.
      const results = (await Promise.all(calls.map(timedCall))).map((result) => dataOf(result));
      for (const [index, call] of calls.entries()) history.push(toolTurn(call.id, results[index]));
      for (const call of extraHandoffs) history.push(toolTurn(call.id, { error: 'Only one handoff per turn' }));
      if (signal?.aborted) return end('stopped', 'Aborted');
      // An ask ends the turn: the next one needs its reply, and takes in what was said meanwhile.
      if (asked && !(await settled(actions.settle(), signal))) return end('stopped', 'Aborted');

      let target: AgentProfile | undefined;
      let targetSkill: AgentSkill | undefined;
      if (handoff) {
        const args = handoff.args as { agent?: unknown; skill?: unknown };
        const next = String(args?.agent ?? '');
        targetSkill = agents[next]?.skilled ? skills[String(args?.skill ?? '')] : undefined;
        const refusal =
          !agent.handoffs?.includes(next) || !agents[next]
            ? `Cannot hand off to ${next}`
            : agents[next].skilled && !targetSkill
              ? `${next} needs a skill: one of ${Object.keys(skills).join(', ')}`
              : handoffs >= handoffLimit
                ? 'Handoff limit reached'
                : undefined;
        if (refusal) history.push(toolTurn(handoff.id, { error: refusal }));
        else target = agents[next];
      }

      const followUps: ChatMessage[] = (options.followUps?.() ?? []).map((text) => ({
        role: 'user',
        type: 'text',
        text,
      }));
      asks.push(...followUps);

      if (target && handoff) {
        handoffs += 1;
        const passed = timeStep(state, 'handoff', target.name, agent.name);
        passed.step.args = JSON.stringify(handoff.args ?? {}).slice(0, ARGS_LIMIT);
        passed.end();
        queueAlong(handoff);
        const brief = String((handoff.args as { brief?: unknown })?.brief ?? '');
        const done = calls.map((call, index) => ({ name: call.name, args: call.args, result: results[index] }));
        history = [
          ...held(target),
          ...asks,
          {
            role: 'user',
            type: 'object',
            data: {
              handoff: {
                from: agent.name,
                ...(said ? { said } : {}),
                ...(acted.length ? { acted } : {}),
                brief,
                results: done,
              },
            },
          },
        ];
        skill = targetSkill;
        agent = withSkill(target, skill, front);
        handed = true;
        told = !!said;
        state.agent = agent.name;
        if (skill) state.skill = skill.name;
        else delete state.skill;
      } else {
        history.push(...followUps);
      }

      // The ask is only over once what it said it would do has happened, and what it showed is drawn.
      const ending = !followUps.length && reply.toolCalls.length === (acting ? 1 : 0);
      const finished = Promise.all([actions.settle(), ...compositions]).then(() => undefined);
      if (ending && !(await settled(finished, signal))) return end('stopped', 'Aborted');

      // Running out ends the ask with its work unfinished, so one that reported a budget hears it coming.
      const limit = turnLimit();
      if (budget.turns === limit && !ending && warned !== limit && limit - turn <= BUDGET_WARNING) {
        warned = limit;
        problems.push(`${limit - turn} turns left of your budget. If the work needs more, call sys.budget.request now with all it still needs.`);
      }

      const feedback = collectFeedback(actions.take(), problems.splice(0));
      if (feedback) history.push({ role: 'user', type: 'object', data: { feedback } });

      options.onSnapshot?.({
        agent: agent.name,
        ...(skill ? { skill: skill.name } : {}),
        ...(budget.turns ? { budget: budget.turns } : {}),
        history: [...history],
        asks: [...asks],
        turn,
        handoffs,
      });
      if (ending && !feedback) return end('done');
    }
  } catch (error) {
    if (signal?.aborted) return end('stopped', 'Aborted');
    // Nothing went wrong: the user is told so as any answer is, with nothing for the desktop to do.
    if (isUsageLimit(error)) {
      state.parts.push({ type: 'text', chunks: [error.message], text: error.message, spoken: true });
      return end('done');
    }
    IRPC_STORE.error(error as Error, [{ agent: agent.name, turn }]);
    return end('error', error instanceof Error ? error.message : String(error));
  }
}

/**
 * A tool's result with its paths in the home form the agents write them in: where a file really is
 * in storage names the user, and is never theirs to see.
 *
 * @param result - What the tool returned.
 * @returns The result, its paths as `~/…`.
 */
function inHomePaths(result: CallResult): CallResult {
  const home = fsContext.get()?.homeDir;
  if (!home || !result || typeof result !== 'object' || result instanceof Blob) return result;
  return JSON.parse(JSON.stringify(result).replaceAll(`${home}/`, '~/')) as CallResult;
}

/**
 * What a model sent with the lists and objects it wrote out as JSON text read back as what they
 * are: a long argument can reach a tool as a string, which would be refused for nothing.
 *
 * @param args - What the model sent.
 * @returns The arguments, each as it was meant.
 */
function withLists(args: unknown): unknown {
  if (!args || typeof args !== 'object') return args;
  return Object.fromEntries(
    Object.entries(args).map(([name, value]) => {
      if (typeof value !== 'string' || !/^\s*[[{]/.test(value)) return [name, value];
      try {
        return [name, JSON.parse(value)];
      } catch {
        return [name, value];
      }
    }),
  );
}

/**
 * What the window in front says about the image being made, for the ask being answered: a still
 * open there is what's made, in its own settings, and Photos' dock says how a new one is. It's the
 * user's choice, so what a model asked for doesn't replace it.
 *
 * @param input - The ask.
 * @returns The still's path, or the model, aspect ratio and how many to make.
 */
function frontPicture(input: ChatInput): FrontPicture {
  const context = chatTurns(input).map(contextOf).find(Boolean) as
    | { activeWindow?: { data?: { still?: string; generation?: FrontPicture['settings'] } } }
    | undefined;
  const { still, generation } = context?.activeWindow?.data ?? {};
  if (still) return { path: still };
  return generation ? { settings: Object.fromEntries(Object.entries(generation).filter(([, value]) => value !== undefined)) } : {};
}

/**
 * The work model and effort the window in front picks.
 *
 * @param input - The ask.
 * @returns Them by name, when that window picks any.
 */
function frontWork(input: ChatInput): FrontWork | undefined {
  const context = chatTurns(input).map(contextOf).find(Boolean) as
    | { activeWindow?: { data?: { animation?: FrontWork } } }
    | undefined;
  return context?.activeWindow?.data?.animation;
}

/** The desktop's context a turn carries, if it's that turn. */
function contextOf(turn: ChatMessage): Record<string, IRPCData> | undefined {
  return (turn.data as { context?: Record<string, IRPCData> } | undefined)?.context;
}

/**
 * A turn as the agents read it. The desktop's command list is for what's drawn: agents can't run it,
 * and what they're never given they can't recite to the user.
 *
 * @param turn - The turn.
 * @returns The turn, without the list when it carried one.
 */
function withoutCommands(turn: ChatMessage): ChatMessage {
  const context = contextOf(turn);
  if (!context?.commands) return turn;
  const { commands: _, ...rest } = context;
  return { ...turn, data: { ...(turn.data as Record<string, IRPCData>), context: rest } };
}

/**
 * Runs one model turn for the agent: feeds each streamed chunk through the marker parser into the
 * answer's parts, and returns the raw text and the calls the model made. Commentary the provider
 * keeps apart is the agent telling the user what it's doing, so it streams into the answer too.
 */
async function modelTurn(
  adapter: AIAdapter,
  agent: AgentProfile,
  history: ChatMessage[],
  parts: AskPart[],
  signal: AbortSignal | undefined,
  timer: StepTimer,
  calls: {
    announce(call: string): void;
    searched(query: string): void;
    handing(args: string): void;
    cited(sources: IRPCData[]): void;
    quiet: boolean;
  },
  hooks: PartWriterHooks,
): Promise<{ text: string; toolCalls: ToolCall[]; unfinished: boolean }> {
  const live = mutable<{ data?: ChatOutput }>({});
  const writer = createPartWriter(parts, hooks);
  const parser = createMarkerParser(writer);
  let seen = 0;
  let heard = 0;
  let announced = 0;
  let found = 0;
  const unsubscribe = subscribe(live, () => {
    const calling = live.data?.calling ?? [];
    for (; announced < calling.length; announced += 1) calls.announce(calling[announced]);
    const searched = live.data?.searched ?? [];
    for (; found < searched.length; found += 1) calls.searched(searched[found]);
    if (live.data?.sources?.length) calls.cited(JSON.parse(JSON.stringify(live.data.sources)));
    const commentary = live.data?.commentary ?? [];
    const chunks = live.data?.chunks ?? [];
    const reasoned = live.data?.reasoning?.length;
    const acted = calling.length || commentary.length || chunks.length;
    if (reasoned || acted) timer.step.waitMs ??= timer.elapsed();
    if (reasoned && acted) timer.step.reasoningMs ??= timer.elapsed() - (timer.step.waitMs ?? 0);
    if (heard < commentary.length || seen < chunks.length) {
      timer.step.firstChunkMs ??= timer.elapsed();
      timer.step.chunks = commentary.length + chunks.length;
      for (; heard < commentary.length; heard += 1) if (!calls.quiet) parser.push(commentary[heard]);
      for (; seen < chunks.length; seen += 1) parser.push(chunks[seen]);
      writer.flush();
    }
    const handing = calling.indexOf(HANDOFF);
    if (handing >= 0) calls.handing((live.data?.drafts?.[handing] ?? []).join(''));
  });

  let text = '';
  let unfinished = false;
  try {
    await new Promise<void>((resolve, reject) => {
      void adapter.ask(
        history,
        {
          model: agent.model,
          system: agent.system,
          tools: agent.tools,
          ...(agent.effort ? { reasoningEffort: agent.effort } : {}),
          ...(agent.webSearch ? { webSearch: true } : {}),
        },
        {
          state: live,
          signal,
          resolve,
          reject,
        },
      );
    });

    // Held back as a repeat, but with no call it was the agent's whole answer.
    if (calls.quiet && !live.data?.calling?.length) for (const line of live.data?.commentary ?? []) parser.push(line);

    // Everything the agent said this turn, so its next turn knows it's been said.
    const answer = live.data?.text ?? (live.data?.chunks ?? []).join('');
    text = [(live.data?.commentary ?? []).join(''), answer].filter(Boolean).join('\n\n');
    // Commentary goes with work: on its own, the agent said what it would do and stopped.
    unfinished = !answer && !!live.data?.commentary?.length;
  } finally {
    unsubscribe();
    parser.end();
    writer.end();
    const reasoning = (live.data?.reasoning ?? []).join('');
    if (reasoning) timer.step.reasoning = reasoning;
    if (live.data?.sources?.length) timer.step.sources = JSON.parse(JSON.stringify(live.data.sources));
  }

  // Plain copies: the calls go into history and to resolvers, not the reactive state.
  const toolCalls = JSON.parse(JSON.stringify(live.data?.toolCalls ?? [])) as ToolCall[];
  return { text, toolCalls, unfinished };
}

/**
 * What a handoff still being written tells the user, once those words are whole.
 *
 * @param args - The call's arguments so far, as raw JSON.
 * @returns Its `say`; empty until the value is complete.
 */
function drafted(args: string): string {
  const [, say] = /"say"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(args) ?? [];
  return say ? String(JSON.parse(say)).trim() : '';
}

/**
 * Asks the composer for the widget nodes a description calls for. The composer never speaks: its
 * answer is JSON, one node or a list of them, checked before it reaches the answer.
 *
 * @param adapter - Model access.
 * @param composer - The composer's profile.
 * @param request - `{ widget: description }`, or `{ form: description }` for an `ask_user` form.
 * @param signal - Aborts the composition with the ask.
 * @returns What was composed; throws when the answer isn't widget nodes.
 */
async function composeWidget(
  adapter: AIAdapter,
  composer: AgentProfile,
  request: IRPCData,
  signal: AbortSignal | undefined,
): Promise<Composed> {
  const text = await answerOnce(adapter, composer, request, signal);
  let composed: Composed;
  try {
    composed = composedOf(text);
  } catch (error) {
    // A malformed answer is asked for once more, with what was wrong with it.
    const retry = { ...(request as Record<string, IRPCData>), previous: text, problem: (error as Error).message };
    composed = composedOf(await answerOnce(adapter, composer, retry, signal));
  }
  log.debug('widget composed', { request, nodes: summaryOf(composed.nodes) });
  return composed;
}

/**
 * One model call with no tools and no history: an agent's answer to one object, as text.
 *
 * @param adapter - Model access.
 * @param agent - Whose model and prompt answer.
 * @param request - What it is asked, as one object.
 * @param signal - Aborts the call.
 * @returns The answer's text; an answer the provider kept as commentary is still the answer.
 */
async function answerOnce(
  adapter: AIAdapter,
  agent: AgentProfile,
  request: IRPCData,
  signal?: AbortSignal,
): Promise<string> {
  const live = mutable<{ data?: ChatOutput }>({});
  await new Promise<void>((resolve, reject) => {
    void adapter.ask(
      [{ role: 'user', type: 'object', data: request }],
      {
        model: agent.model,
        system: agent.system,
        tools: agent.tools,
        ...(agent.effort ? { reasoningEffort: agent.effort } : {}),
        ...(agent.json ? { json: true } : {}),
      },
      { state: live, signal, resolve, reject },
    );
  });
  return live.data?.text || (live.data?.chunks ?? []).join('') || (live.data?.commentary ?? []).join('');
}

/**
 * Every role in some nodes, however deep.
 *
 * @param nodes - The nodes.
 * @returns Their roles.
 */
function rolesIn(nodes: unknown[]): string[] {
  return nodes.flatMap((node) => {
    if (typeof node !== 'object' || node === null) return [];
    const { role, children } = node as { role?: string; children?: unknown[] };
    return [...(role ? [role] : []), ...rolesIn(Array.isArray(children) ? children : [])];
  });
}

/** Roles that draw their `items` and nothing else: children given to them never show. */
const ITEMS_ROLES = new Set(['avatar-group', 'description-list', 'gallery', 'image-viewer', 'reorder', 'tree']);

/**
 * What in some nodes is written well but would draw nothing or do nothing, however deep.
 *
 * @param nodes - The nodes.
 * @returns What's wrong, one line each, for the composer to put right.
 */
function misdrawnIn(nodes: unknown[]): string[] {
  return nodes.flatMap((node) => {
    if (typeof node !== 'object' || node === null) return [];
    const { role, props, bindings, children } = node as {
      role?: string;
      props?: { items?: unknown; href?: unknown };
      bindings?: { prop?: string }[];
      children?: unknown[];
    };
    const itemsBound = bindings?.some(({ prop }) => prop === 'items');
    return [
      ...(role && ITEMS_ROLES.has(role) && !Array.isArray(props?.items) && !itemsBound
        ? [`${role} draws only props.items, so its children never show: put them in items.`]
        : []),
      ...(role === 'button' && props?.href ? ['A button has no href, so it opens nothing: use link or a to open something.'] : []),
      ...misdrawnIn(Array.isArray(children) ? children : []),
    ];
  });
}

/** Whether something is a widget node, all the way down: text, or a role with children that are nodes. */
function isNode(node: unknown): boolean {
  if (typeof node === 'string') return true;
  const { role, children } = (node ?? {}) as { role?: unknown; children?: unknown };
  return typeof role === 'string' && (!Array.isArray(children) || children.every(isNode));
}

/**
 * What the composer's answer gives a widget: JSON, fenced or not. The widget itself, a node with no
 * role since the host draws its card, with what it declares about that card; or just what goes in it.
 *
 * @param text - The composer's answer.
 * @returns What was composed; throws when the answer isn't widget nodes.
 */
function composedOf(text: string): Composed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (error) {
    throw new Error(`The composer's answer isn't JSON (${messageOf(error)}): ${summaryOf(text)}`);
  }
  const { children, role, ...declared } = (parsed ?? {}) as Record<string, IRPCData> & { role?: unknown };
  const widget = !Array.isArray(parsed) && !role && Array.isArray(children);
  const nodes = widget ? (children as IRPCData[]) : Array.isArray(parsed) ? parsed : [parsed];
  if (!nodes.length || !nodes.every(isNode))
    throw new Error(`The composer's answer isn't widget nodes: ${summaryOf(text)}`);
  const unknown = rolesIn(nodes).filter((role) => !isWidgetRole(role));
  if (unknown.length) throw new Error(`Nothing draws these roles: ${unknown.join(', ')}. Use only the catalog's.`);
  const drawnWrong = misdrawnIn(nodes);
  if (drawnWrong.length) throw new Error(drawnWrong.join(' '));
  return widget ? { ...declared, nodes } : { nodes: nodes as IRPCData[] };
}

/**
 * Runs actions and asks one at a time, in the order they were written. A failure skips the rest of
 * that turn's actions and asks; an ask's reply, or that nothing answered it, is kept for the model
 * like a failure until taken.
 */
function createActionQueue(act: AgentLoopOptions['act'], track?: AgentLoopOptions['track']) {
  let chain: Promise<void> = Promise.resolve();
  const brokenTurns = new Set<number>();
  const failures: IRPCData[] = [];
  const replies: IRPCData[] = [];

  return {
    /**
     * Queues an action or ask. `prepared` is arguments still being made, such as an `ask_user` form:
     * it runs with them once they're ready, and fails like the action itself when they can't be made.
     */
    add(action: AskAction, turn: number, prepared?: Promise<IRPCData>) {
      // Awaited when its turn comes; until then a failure mustn't count as unhandled.
      prepared?.catch(() => undefined);
      track?.(action, { status: 'waiting' });
      chain = chain.then(async () => {
        if (brokenTurns.has(turn)) {
          failures.push({ action: action.name, args: action.args, skipped: true });
          track?.(action, { status: 'skipped' });
          return;
        }
        try {
          const reply = await act?.(prepared ? { ...action, args: dataOf(await prepared) ?? null } : action);
          if (action.ask) replies.push(replyOf(action, dataOf(reply)));
          track?.(action, { status: action.ask && reply === undefined ? 'unanswered' : 'done' });
        } catch (error) {
          IRPC_STORE.error(error as Error, [{ action: action.name, args: action.args }]);
          brokenTurns.add(turn);
          failures.push({ action: action.name, args: action.args, error: messageOf(error) });
          track?.(action, { status: 'failed', error: messageOf(error) });
        }
      });
    },
    /** Resolves once every queued action and ask has run or been skipped. */
    settle: () => chain,
    /** Hands over the failures and replies so far, for the model's next turn. */
    take: () => ({ failures: failures.splice(0), replies: replies.splice(0) }),
  };
}

/**
 * What the model reads back for an ask: its reply, or that nothing answered it. The user's form
 * isn't echoed back; an app ask keeps its arguments, so two asks of one app stay apart.
 */
function replyOf(action: AskAction, reply: IRPCData | undefined): IRPCData {
  const asked = action.name === 'ask_user' ? { ask: action.name } : { ask: action.name, args: action.args };
  return reply === undefined ? { ...asked, error: 'not available' } : { ...asked, reply };
}

/** What the model must hear about at the next turn, or undefined when there is nothing. */
function collectFeedback(
  taken: { failures: IRPCData[]; replies: IRPCData[] },
  invalid: string[],
): IRPCData | undefined {
  const { failures, replies } = taken;
  if (!failures.length && !replies.length && !invalid.length) return undefined;
  return {
    ...(replies.length ? { asks: replies } : {}),
    ...(failures.length ? { actions: failures } : {}),
    ...(invalid.length ? { invalid } : {}),
  };
}

/** Waits for the promise unless the signal aborts first; false when aborted. */
async function settled(promise: Promise<void>, signal?: AbortSignal): Promise<boolean> {
  if (!signal) {
    await promise;
    return true;
  }
  if (signal.aborted) return false;
  return new Promise<boolean>((resolve) => {
    const onAbort = () => resolve(false);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(!signal.aborted);
    });
  });
}

/**
 * The agent's calls plus `handoff`, limited to the agents it may hand off to. When one of them
 * takes a skill, `handoff` also offers the skills by name; the kernel resolves the name, so the
 * model only ever picks from the catalog.
 */
function toolsOf(
  agent: AgentProfile,
  agents: Record<string, AgentProfile>,
  skills: Record<string, AgentSkill>,
): ChatTool[] {
  if (!agent.handoffs?.length) return agent.tools;
  const skilled = agent.handoffs.some((name) => agents[name]?.skilled) && Object.keys(skills).length > 0;
  const actions = {
    type: 'array',
    description: 'The actions to run on the desktop, in order.',
    items: {
      type: 'object',
      properties: { name: { type: 'string' }, args: { type: 'object' } },
      required: ['name'],
    },
  };
  return [
    ...agent.tools,
    ...(agent.actsByCall
      ? [
          {
            name: ACT,
            description: 'Does something on the desktop now, and tells the user. Ends your turn.',
            parameters: {
              type: 'object',
              properties: {
                say: { type: 'string', description: 'What to tell the user, shown and read aloud.' },
                actions,
              },
              required: ['say', 'actions'],
            },
          },
        ]
      : []),
    {
      name: HANDOFF,
      description: 'Pass this ask to an agent better suited to it. Ends your turn.',
      parameters: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: agent.handoffs },
          ...(skilled
            ? {
                skill: {
                  type: 'string',
                  enum: Object.keys(skills),
                  description: 'The skill a skilled agent works with; required when handing to one.',
                },
              }
            : {}),
          say: { type: 'string', description: 'What to tell the user as it\'s handed over, shown and read aloud, when there is something to tell.' },
          actions,
          brief: {
            type: 'string',
            description: 'Only facts from the conversation the next agent can\'t see. Never the ask itself or what to do. Empty when there are none.',
          },
        },
        required: ['agent', 'brief'],
      },
    },
  ];
}

/**
 * An agent with a skill added: the skill's prompt after its own, the skill's tools after its own,
 * and for a skill that names a work model, that one, or what the window in front picks. What the
 * desktop sends is only ever a name looked up here, so it can't reach another model.
 *
 * @param agent - The agent's base profile.
 * @param skill - The skill it was handed, if any.
 * @param front - The work model and effort the window in front picks, if any.
 * @returns The profile it answers with.
 */
function withSkill(agent: AgentProfile, skill?: AgentSkill, front?: FrontWork): AgentProfile {
  if (!skill) return agent;
  const work = skill.model && (WORK_MODELS[front?.model ?? ''] ?? WORK_MODELS[skill.model]);
  return {
    ...agent,
    system: `${agent.system}\n\n${skill.system}`,
    tools: [...agent.tools, ...skill.tools],
    ...(work ? { model: work.model, effort: WORK_EFFORTS[front?.effort ?? ''] ? front?.effort : work.effort } : {}),
  };
}

/** Resolves one call into what the model reads back: the answer, or an error it can act on. */
async function resolveCall(resolve: AgentLoopOptions['resolve'], call: ToolCall, agent: string): Promise<IRPCData> {
  try {
    const result = dataOf(await resolve(call)) ?? { error: 'not available' };
    log.debug(`tool ${call.name}`, { agent, args: call.args, result: summaryOf(result) });
    return result;
  } catch (error) {
    // The model only reads the message; the log keeps what failed, for whoever debugs it.
    IRPC_STORE.error(error as Error, [{ agent, call: call.name, args: call.args }]);
    return { error: messageOf(error) };
  }
}

/**
 * The ask as the model reads it: the desktop's context first, then the words.
 *
 * @param input - The user's words and the desktop's context.
 * @returns The ask's messages, in order.
 */
export function toChatInput(input: AskInput): ChatMessage[] {
  const words: ChatMessage = { role: 'user', type: 'text', text: input.text };
  const picked = (input.selections as Array<Record<string, IRPCData>> | undefined)?.map(({ type, value, label }) => ({ type, value, label }));
  const known = { ...(input.context ? { context: input.context } : {}), ...(picked?.length ? { picked } : {}) };
  return Object.keys(known).length ? [{ role: 'user', type: 'object', data: known }, words] : [words];
}

/** The tool turn that answers a call. */
function toolTurn(toolCallId: string, data: IRPCData): ChatMessage {
  return { role: 'tool', type: 'object', toolCallId, data };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Longest stretch of a tool result kept in a trace. */
const TRACE_LIMIT = 200;

/** A tool result as a trace shows it: JSON, clipped. */
function summaryOf(result: IRPCData): string {
  const json = JSON.stringify(result) ?? '';
  return json.length > TRACE_LIMIT ? `${json.slice(0, TRACE_LIMIT)}…` : json;
}
