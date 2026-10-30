import { mutable, subscribe } from '@airlib/react';
import {
  type ChatInput,
  type ChatMessage,
  type ChatOutput,
  type ChatTool,
  chatTurns,
  type ToolCall,
} from '@irpclib/ai-kit';
import type { AIAdapter } from '@irpclib/ai-kit/worker';
import { getAbortSignal, IRPC_STORE, type IRPCData, type IRPCRouter, setContext, stream } from '@irpclib/irpc';
import { logger } from '../logger.js';
import { isUsageLimit } from '../share/usage.js';
import {
  type ActionOutcome,
  type AskAction,
  type AskInput,
  type AskPart,
  type AskState,
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

/** The ask a `sys.*` call is made in: the agent making it, and the desktop the ask reaches. */
export type SysAsk = { agent: string; desktop: (action: AskAction) => Promise<CallResult> };

/** What a model is told when a call gives it binary content, which it can't read. */
const BINARY = 'That is binary content: read it with an encoding, like "text" or "base64"';

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

  await runAgentLoop({
    adapter,
    agents,
    entry: options.entry ?? entry,
    composer,
    skills,
    persona,
    limits,
    input: options.input,
    state: options.state,
    // Tools are the server's: a package tool or a `sys.*` call. The desktop is reached by actions and asks.
    resolve: async (call) => {
      // A model sends one input object; the tool's router turns it into the stub's own arguments.
      for (const router of routers) {
        // The mapping and the stub come from the same package, so they always agree.
        const tool = router.toolOf(call.name);
        const args = router.argsOf(call.name, call.args as Record<string, unknown>);
        if (tool && args) return (await tool.pkg.call(tool.spec.name, ...args)) as CallResult;
      }
      return sys[call.name]?.(call.args, { agent: options.state.agent, desktop: options.desktop });
    },
    act: async (action) =>
      sys[action.name]
        ? sys[action.name](action.args, { agent: options.state.agent, desktop: options.desktop })
        : options.desktop(action),
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
}

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
  limits?: { turns?: number; handoffs?: number };
  resume?: LoopSnapshot;
  /** Called after every completed turn. */
  onSnapshot?: (snapshot: LoopSnapshot) => void;
}

/** The call an agent makes to pass the ask to another agent. */
export const HANDOFF = 'handoff';

const DEFAULT_TURN_LIMIT = 12;
const DEFAULT_HANDOFF_LIMIT = 3;

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
  const { adapter, agents, state, signal, resume, skills = {}, persona } = options;
  const turnLimit = options.limits?.turns ?? DEFAULT_TURN_LIMIT;
  const handoffLimit = options.limits?.handoffs ?? DEFAULT_HANDOFF_LIMIT;

  let skill = resume?.skill ? skills[resume.skill] : undefined;
  let agent = withSkill(agents[resume?.agent ?? options.entry], skill);
  const asks = resume ? [...resume.asks] : chatTurns(options.input);
  let history = resume ? [...resume.history] : [...asks];
  let turn = resume?.turn ?? 0;
  let handoffs = resume?.handoffs ?? 0;
  const actions = createActionQueue(options.act, options.track);
  const problems: string[] = [];
  const composer = options.composer ? agents[options.composer] : undefined;
  const compositions: Promise<void>[] = [];
  const compose = (request: IRPCData) =>
    composer
      ? composeWidget(
          adapter,
          persona ? { ...composer, system: `${composer.system}\n\n${persona}` } : composer,
          request,
          signal,
        )
      : Promise.reject(new Error('No composer to draw widgets'));

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
      if (turn >= turnLimit) return end('stopped', 'Turn limit reached');

      turn += 1;
      state.turn = turn;
      const current = turn;
      const tools = toolsOf(agent, agents, skills);
      // The user's own agents speak as themselves; the rest as the assistant.
      const voice = agent.persona ?? persona;
      const system = voice ? `${agent.system}\n\n${voice}` : agent.system;
      const callable = new Set(tools.map((tool) => tool.name));
      let asked = false;
      const take = () =>
        modelTurn(adapter, { ...agent, system, tools }, history, state.parts, signal, {
          onWidget: (part, intent) => {
            // The agent keeps speaking while its widget is composed; the part fills in place.
            compositions.push(
              compose({ widget: intent }).then(
                (nodes) => {
                  part.nodes = nodes;
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
          onAction: (written) => {
            // A call written as an action would run with its result lost: the model must call it.
            if (callable.has(written.name)) {
              problems.push(`${written.name} is a call, not an action: call it as a tool to get its result`);
              return;
            }
            if (written.ask) asked = true;
            // Stamped now: by the time it runs, the ask may have been handed to another agent.
            const action = { ...written, agent: agent.name };
            if (action.name !== 'ask_user') return actions.add(action, current);
            // Composed now, while the turn streams; the user is asked once their turn in the queue comes.
            actions.add(action, current, compose({ form: String(action.args) }));
          },
          onInvalid: (problem) => problems.push(problem),
        });
      const isEmpty = (result: { text: string; toolCalls: ToolCall[] }) => !result.text && !result.toolCalls.length;
      // An empty turn is usually a provider hiccup: one retry before giving up.
      let reply = await take();
      if (isEmpty(reply)) reply = await take();
      if (isEmpty(reply)) return end('error', `No answer from ${agent.model}`);

      history.push({
        role: 'assistant',
        type: 'text',
        text: reply.text,
        ...(reply.toolCalls.length ? { toolCalls: reply.toolCalls } : {}),
      });

      const [handoff, ...extraHandoffs] = reply.toolCalls.filter((call) => call.name === HANDOFF);
      const calls = reply.toolCalls.filter((call) => call.name !== HANDOFF);
      // Already data the model reads; awaiting them again only widens their type to downloaded blobs.
      const results = (await Promise.all(calls.map((call) => resolveCall(options.resolve, call, agent.name)))).map(
        (result) => dataOf(result),
      );
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
        const brief = String((handoff.args as { brief?: unknown })?.brief ?? '');
        const done = calls.map((call, index) => ({ name: call.name, args: call.args, result: results[index] }));
        history = [
          ...asks,
          { role: 'user', type: 'object', data: { handoff: { from: agent.name, brief, results: done } } },
        ];
        skill = targetSkill;
        agent = withSkill(target, skill);
        state.agent = agent.name;
        if (skill) state.skill = skill.name;
        else delete state.skill;
      } else {
        history.push(...followUps);
      }

      // The ask is only over once what it said it would do has happened, and what it showed is drawn.
      const ending = !reply.toolCalls.length && !followUps.length;
      const finished = Promise.all([actions.settle(), ...compositions]).then(() => undefined);
      if (ending && !(await settled(finished, signal))) return end('stopped', 'Aborted');

      const feedback = collectFeedback(actions.take(), problems.splice(0));
      if (feedback) history.push({ role: 'user', type: 'object', data: { feedback } });

      options.onSnapshot?.({
        agent: agent.name,
        ...(skill ? { skill: skill.name } : {}),
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
 * Runs one model turn for the agent: feeds each streamed chunk through the marker parser into the
 * answer's parts, and returns the raw text and the calls the model made. Commentary the provider
 * kept apart stays out of the answer, unless the turn made no calls and wrote no answer: commentary
 * only accompanies calls, so on its own it is the answer.
 */
async function modelTurn(
  adapter: AIAdapter,
  agent: AgentProfile,
  history: ChatMessage[],
  parts: AskPart[],
  signal: AbortSignal | undefined,
  hooks: PartWriterHooks,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const live = mutable<{ data?: ChatOutput }>({});
  const writer = createPartWriter(parts, hooks);
  const parser = createMarkerParser(writer);
  let seen = 0;
  const unsubscribe = subscribe(live, () => {
    const chunks = live.data?.chunks ?? [];
    if (seen >= chunks.length) return;
    while (seen < chunks.length) {
      parser.push(chunks[seen]);
      seen += 1;
    }
    writer.flush();
  });

  let text = '';
  try {
    await new Promise<void>((resolve, reject) => {
      void adapter.ask(
        history,
        {
          model: agent.model,
          system: agent.system,
          tools: agent.tools,
          ...(agent.effort ? { reasoningEffort: agent.effort } : {}),
        },
        {
          state: live,
          signal,
          resolve,
          reject,
        },
      );
    });

    text = live.data?.text ?? (live.data?.chunks ?? []).join('');
    const commentary = (live.data?.commentary ?? []).join('');
    if (!text && !live.data?.toolCalls?.length && commentary) {
      parser.push(commentary);
      writer.flush();
      text = commentary;
    }
  } finally {
    unsubscribe();
    parser.end();
    writer.end();
  }

  // Plain copies: the calls go into history and to resolvers, not the reactive state.
  const toolCalls = JSON.parse(JSON.stringify(live.data?.toolCalls ?? [])) as ToolCall[];
  return { text, toolCalls };
}

/**
 * Asks the composer for the widget nodes a description calls for. The composer never speaks: its
 * answer is JSON, one node or a list of them, checked before it reaches the answer.
 *
 * @param adapter - Model access.
 * @param composer - The composer's profile.
 * @param request - `{ widget: description }`, or `{ form: description }` for an `ask_user` form.
 * @param signal - Aborts the composition with the ask.
 * @returns The nodes; throws when the answer isn't widget nodes.
 */
async function composeWidget(
  adapter: AIAdapter,
  composer: AgentProfile,
  request: IRPCData,
  signal: AbortSignal | undefined,
): Promise<IRPCData[]> {
  const text = await answerOnce(adapter, composer, request, signal);
  let nodes: IRPCData[];
  try {
    nodes = nodesOf(text);
  } catch (error) {
    // A malformed answer is asked for once more, with what was wrong with it.
    const retry = { ...(request as Record<string, IRPCData>), previous: text, problem: (error as Error).message };
    nodes = nodesOf(await answerOnce(adapter, composer, retry, signal));
  }
  log.debug('widget composed', { request, nodes: summaryOf(nodes) });
  return nodes;
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
      },
      { state: live, signal, resolve, reject },
    );
  });
  return live.data?.text || (live.data?.chunks ?? []).join('') || (live.data?.commentary ?? []).join('');
}

/**
 * The widget nodes in the composer's answer: JSON, fenced or not, one node or a list of them.
 *
 * @param text - The composer's answer.
 * @returns The nodes; throws when the answer isn't widget nodes.
 */
function nodesOf(text: string): IRPCData[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new Error(`The composer's answer isn't JSON: ${summaryOf(text)}`);
  }
  const nodes = Array.isArray(parsed) ? parsed : [parsed];
  const isNode = (node: unknown) =>
    typeof node === 'string' ||
    (typeof node === 'object' && node !== null && typeof (node as { role?: unknown }).role === 'string');
  if (!nodes.length || !nodes.every(isNode))
    throw new Error(`The composer's answer isn't widget nodes: ${summaryOf(text)}`);
  return nodes as IRPCData[];
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
  return [
    ...agent.tools,
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
          brief: { type: 'string', description: 'What the next agent must do, and what is already known.' },
        },
        required: ['agent', 'brief'],
      },
    },
  ];
}

/**
 * An agent with a skill added: the skill's prompt after its own, and the skill's tools after its own.
 *
 * @param agent - The agent's base profile.
 * @param skill - The skill it was handed, if any.
 * @returns The profile it answers with.
 */
function withSkill(agent: AgentProfile, skill?: AgentSkill): AgentProfile {
  if (!skill) return agent;
  return { ...agent, system: `${agent.system}\n\n${skill.system}`, tools: [...agent.tools, ...skill.tools] };
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
  return input.context ? [{ role: 'user', type: 'object', data: { context: input.context } }, words] : [words];
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
