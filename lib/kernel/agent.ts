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
import { getAbortSignal, type IRPCData, type IRPCHandler, type IRPCRouter, stream } from '@irpclib/irpc';
import { type AskAction, type AskInput, type AskPart, type AskState, askSeed, askWedyan } from './agent.h.js';
import { createMarkerParser } from './marker.js';
import { kernel } from './package.js';
import { createPartWriter, type PartWriterHooks } from './parts.js';

export type { AskState } from './agent.h.js';

/** A call the kernel resolves on the server, by name. `undefined` means nothing to return. */
export type SysHandler = (args: IRPCData) => Promise<IRPCData | undefined> | IRPCData | undefined;

/** What the kernel runs asks with: model access, the agents, and its server-side calls. */
export interface KernelConfig {
  adapter: AIAdapter;
  agents: Record<string, AgentProfile>;
  /** The first agent of every ask: the router. */
  entry: string;
  /** Serves the packages whose tools agents call by `package.function`; each call runs through its stub. */
  router?: IRPCRouter;
  /** Server-side calls by name (`sys.*`); every other call or action is asked of the client. */
  sys?: Record<string, SysHandler>;
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

kernel.construct(askWedyan, (input) =>
  stream((state, resolve) => {
    if (!config) throw new Error('Kernel is not set up');
    const { adapter, agents, entry, router, sys = {}, limits } = config;
    const tools: Record<string, IRPCHandler> = Object.assign(
      {},
      ...[...(router?.packages ?? [])].map((pkg) => pkg.tools()),
    );
    const controller = new AbortController();
    getAbortSignal()?.addEventListener('abort', () => controller.abort(), { once: true });

    const followUps: string[] = [];
    state.answer('followUp', (text) => {
      followUps.push(text);
      return true;
    });

    void runAgentLoop({
      adapter,
      agents,
      entry,
      limits,
      input: toChatInput(input),
      state: state.data,
      // Tools are the server's: a package tool or a `sys.*` call. The desktop is reached by actions and asks.
      resolve: async (call) => {
        // A model sends one input object; the router turns it into the stub's own arguments.
        const args = router?.argsOf(call.name, call.args as Record<string, unknown>);
        if (args) return tools[call.name](...args);
        return sys[call.name]?.(call.args);
      },
      act: async (action) =>
        sys[action.name] ? sys[action.name](action.args) : state.ask(action.name, action.args, { after: action.after }),
      followUps: () => followUps.splice(0),
      signal: controller.signal,
    }).then(() => resolve());

    // Returned before the ask finishes, so closing the call can stop it.
    return () => controller.abort();
  }, askSeed()),
);

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
}

/** Everything needed to resume an ask after the turn it was taken on. */
export interface LoopSnapshot {
  agent: string;
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
  input: ChatInput;
  /** Mutated in place as the ask runs. */
  state: AskState;
  /**
   * Resolves every call except `handoff`, wherever its data lives. `undefined` means nothing
   * answers that call, which the model is told.
   */
  resolve: (call: ToolCall) => Promise<IRPCData | undefined>;
  /**
   * Runs one action or ask. They run one at a time, in order; a throw is a failure the model is told
   * about, and skips that turn's remaining ones. For an action, `undefined` means nothing ran it: a
   * no-op. For an ask, what it returns is the reply the model reads; `undefined` means nothing answered.
   */
  act?: (action: AskAction) => Promise<IRPCData | undefined>;
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
 * actions, malformed markers). The ask ends when a turn makes no calls, no follow-up is waiting, and
 * every action has run without a failure to report. Routing is not a separate step: the entry agent
 * routes by calling `handoff`.
 *
 * Never throws: failures, aborts and limits end the ask with the status and reason in `state`.
 *
 * @param options - Agents, model access, call and action resolution, the ask and its state.
 * @returns Once the ask has ended.
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<void> {
  const { adapter, agents, state, signal, resume } = options;
  const turnLimit = options.limits?.turns ?? DEFAULT_TURN_LIMIT;
  const handoffLimit = options.limits?.handoffs ?? DEFAULT_HANDOFF_LIMIT;

  let agent = agents[resume?.agent ?? options.entry];
  const asks = resume ? [...resume.asks] : chatTurns(options.input);
  let history = resume ? [...resume.history] : [...asks];
  let turn = resume?.turn ?? 0;
  let handoffs = resume?.handoffs ?? 0;
  const actions = createActionQueue(options.act);
  const problems: string[] = [];

  const end = (status: AskState['status'], reason?: string) => {
    state.status = status;
    if (reason) state.reason = reason;
  };

  state.status = 'running';
  state.agent = agent.name;
  state.turn = turn;

  try {
    for (;;) {
      if (signal?.aborted) return end('stopped', 'Aborted');
      if (turn >= turnLimit) return end('stopped', 'Turn limit reached');

      turn += 1;
      state.turn = turn;
      const current = turn;
      const callable = new Set(toolsOf(agent).map((tool) => tool.name));
      let asked = false;
      const take = () =>
        modelTurn(adapter, agent, history, state.parts, signal, {
          onAction: (action) => {
            // A call written as an action would run with its result lost: the model must call it.
            if (callable.has(action.name)) {
              problems.push(`${action.name} is a call, not an action: call it as a tool to get its result`);
              return;
            }
            if (action.ask) asked = true;
            actions.add(action, current);
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
      const results = await Promise.all(calls.map((call) => resolveCall(options.resolve, call)));
      for (const [index, call] of calls.entries()) history.push(toolTurn(call.id, results[index]));
      for (const call of extraHandoffs) history.push(toolTurn(call.id, { error: 'Only one handoff per turn' }));
      if (signal?.aborted) return end('stopped', 'Aborted');
      // An ask ends the turn: the next one needs its reply, and takes in what was said meanwhile.
      if (asked && !(await settled(actions.settle(), signal))) return end('stopped', 'Aborted');

      let target: AgentProfile | undefined;
      if (handoff) {
        const next = String((handoff.args as { agent?: unknown })?.agent ?? '');
        const refusal =
          !agent.handoffs?.includes(next) || !agents[next]
            ? `Cannot hand off to ${next}`
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
        agent = target;
        state.agent = agent.name;
      } else {
        history.push(...followUps);
      }

      // The ask is only over once what it said it would do has happened.
      const ending = !reply.toolCalls.length && !followUps.length;
      if (ending && !(await settled(actions.settle(), signal))) return end('stopped', 'Aborted');

      const feedback = collectFeedback(actions.take(), problems.splice(0));
      if (feedback) history.push({ role: 'user', type: 'object', data: { feedback } });

      options.onSnapshot?.({ agent: agent.name, history: [...history], asks: [...asks], turn, handoffs });
      if (ending && !feedback) return end('done');
    }
  } catch (error) {
    if (signal?.aborted) return end('stopped', 'Aborted');
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
          tools: toolsOf(agent),
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
 * Runs actions and asks one at a time, in the order they were written. A failure skips the rest of
 * that turn's actions and asks; an ask's reply, or that nothing answered it, is kept for the model
 * like a failure until taken.
 */
function createActionQueue(act: AgentLoopOptions['act']) {
  let chain: Promise<void> = Promise.resolve();
  const brokenTurns = new Set<number>();
  const failures: IRPCData[] = [];
  const replies: IRPCData[] = [];

  return {
    add(action: AskAction, turn: number) {
      chain = chain.then(async () => {
        if (brokenTurns.has(turn)) {
          failures.push({ action: action.name, args: action.args, skipped: true });
          return;
        }
        try {
          const reply = await act?.(action);
          if (action.ask) replies.push(replyOf(action, reply));
        } catch (error) {
          brokenTurns.add(turn);
          failures.push({ action: action.name, args: action.args, error: messageOf(error) });
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

/** The agent's calls plus `handoff`, limited to the agents it may hand off to. */
function toolsOf(agent: AgentProfile): ChatTool[] {
  if (!agent.handoffs?.length) return agent.tools;
  return [
    ...agent.tools,
    {
      name: HANDOFF,
      description: 'Pass this ask to an agent better suited to it. Ends your turn.',
      parameters: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: agent.handoffs },
          brief: { type: 'string', description: 'What the next agent must do, and what is already known.' },
        },
        required: ['agent', 'brief'],
      },
    },
  ];
}

/** Resolves one call into what the model reads back: the answer, or an error it can act on. */
async function resolveCall(resolve: AgentLoopOptions['resolve'], call: ToolCall): Promise<IRPCData> {
  try {
    return (await resolve(call)) ?? { error: 'not available' };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/** The ask as the model reads it: the desktop's context first, then the words. */
function toChatInput(input: AskInput): ChatMessage[] {
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
