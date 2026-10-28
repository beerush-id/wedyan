import { mutable, withContext } from '@airlib/react';
import type { ChatMessage, ToolCall } from '@irpclib/ai-kit';
import { AIAdapter, OpenAIDriver } from '@irpclib/ai-kit/worker';
import type { IRPCData } from '@irpclib/irpc';
import { type AgentModels, createAgents, ENTRY } from '../../lib/agents/index.js';
import { personaPrompt } from '../../lib/agents/persona.js';
import { SKILLS } from '../../lib/agents/skills.js';
import type { AskAction, AskPart, AskState } from '../../lib/kernel/agent.h.js';
import { type LoopSnapshot, runAgentLoop } from '../../lib/kernel/agent.js';

/** Where models are served, with the keys from `.env`. */
export const PROVIDERS = {
  meta: {
    base: 'https://api.meta.ai/v1',
    key: process.env.MUSE_API_KEY ?? '',
    models: ['muse-spark-1.3', 'muse-wonder-1.0'],
  },
  baseten: {
    base: 'https://inference.baseten.co/v1',
    key: process.env.BASETEN_API_KEY ?? '',
    models: ['meta-models/muse-spark-open'],
  },
};

/** An adapter serving every provider that has a key, over the Responses API. */
export function liveAdapter(): AIAdapter {
  const adapter = new AIAdapter();
  for (const [name, provider] of Object.entries(PROVIDERS)) {
    if (!provider.key) continue;
    adapter.use(
      new OpenAIDriver({
        name,
        baseUrl: provider.base,
        apiKey: provider.key,
        models: provider.models,
        api: 'responses',
      }),
    );
  }
  return adapter;
}

/** Seeded answers for server calls, as the beats expect them. */
export const SYS: Record<string, IRPCData> = {
  'sys.queue.list': [
    { id: 'q1', kind: 'render', title: 'Short drama v3 render finished', at: '02:14' },
    { id: 'm1', kind: 'mail', from: 'Ana', title: 'Notes on the shoot schedule', at: '06:40' },
    { id: 'm2', kind: 'mail', from: 'Rudi', title: 'Budget approved for episode 2', at: '07:05' },
    { id: 'c1', kind: 'meeting', title: 'Casting call with Ana', at: '10:00 today' },
  ],
  // r2-file's own tools, answering in its ListResult shape.
  'r2-file.search': {
    entries: [{ path: '~/projects/short-drama', name: 'short-drama', isDirectory: true, mtime: 'yesterday 23:40' }],
  },
  'r2-file.list': {
    entries: [
      { path: '~/projects/short-drama/cut-v3.motion', name: 'cut-v3.motion', isDirectory: false },
      { path: '~/projects/short-drama/script.md', name: 'script.md', isDirectory: false },
    ],
  },
  'sys.photos.search': [
    { path: '~/pictures/sofa.jpg', description: 'A grey sofa with an orange cat on the left cushion' },
  ],
  'sys.image.segment': { mask: 'mask-7f3', box: [40, 120, 310, 380], label: 'cat' },
  'sys.image.edit': { path: '~/pictures/sofa-edited.jpg' },
  'memory.save': { path: '~/Memos/Saved.memo', name: 'Saved', kind: 'note' },
  'memory.recall': [],
};

export const PROFILE = { userName: 'Nanang' };

/** One ask: the desktop's context, then the words, as the kernel sends them. */
export function ask(text: string, context?: Record<string, IRPCData>): ChatMessage[] {
  const words: ChatMessage = { role: 'user', type: 'text', text };
  return context ? [{ role: 'user', type: 'object', data: { context } }, words] : [words];
}

/** What one ask produced, for reports and checks. */
export interface BeatResult {
  status: AskState['status'];
  reason?: string;
  agents: string[];
  turns: number;
  msToFirstPart: number;
  msTotal: number;
  parts: AskPart[];
  calls: ToolCall[];
  actions: AskAction[];
  invalid: string[];
  failedActions: IRPCData[];
}

/**
 * Runs one ask through the real loop and agents. Server calls get the seeded answers; asks to the
 * user get `replies` in order; every action succeeds.
 */
export async function runBeat(
  input: ChatMessage[],
  options: { models?: AgentModels; replies?: string[] } = {},
): Promise<BeatResult> {
  const replies = [...(options.replies ?? [])];
  const state = mutable<AskState>({ status: 'idle', agent: '', turn: 0, parts: [] });
  const calls: ToolCall[] = [];
  const actions: AskAction[] = [];
  const snapshots: LoopSnapshot[] = [];
  const agents: string[] = [];
  const started = Date.now();
  let firstPart = 0;
  const watch = setInterval(() => {
    if (!firstPart && state.parts.length) firstPart = Date.now() - started;
    // A skilled agent is recorded with its skill, like `lita:photos`.
    const current = state.skill ? `${state.agent}:${state.skill}` : state.agent;
    if (current && agents.at(-1) !== current) agents.push(current);
  }, 10);

  // Each beat gets its own context, so the loop's subscriptions never leak into the next beat.
  await withContext(() =>
    runAgentLoop({
      adapter: liveAdapter(),
      agents: createAgents(options.models),
      entry: ENTRY,
      skills: SKILLS,
      persona: personaPrompt(PROFILE),
      input,
      state,
      resolve: async (call) => {
        calls.push(call);
        return SYS[call.name];
      },
      act: async (action) => {
        actions.push(action);
        // The user fills the form's first field with the next scripted reply.
        if (action.name === 'ask_user') return { [fieldsOf(action.args)[0] ?? 'answer']: replies.shift() ?? null };
        return action.ask ? undefined : { ok: true };
      },
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    }),
  );
  clearInterval(watch);

  const feedback = snapshots
    .flatMap((snapshot) => snapshot.history)
    .map((turn) =>
      turn.type === 'object'
        ? (turn.data as { feedback?: { invalid?: string[]; actions?: IRPCData[] } }).feedback
        : undefined,
    )
    .filter((value) => value !== undefined);

  return {
    status: state.status,
    reason: state.reason,
    agents,
    turns: state.turn,
    msToFirstPart: firstPart,
    msTotal: Date.now() - started,
    parts: JSON.parse(JSON.stringify(state.parts)),
    calls: JSON.parse(JSON.stringify(calls)),
    actions: JSON.parse(JSON.stringify(actions)),
    invalid: feedback.flatMap((entry) => entry?.invalid ?? []),
    failedActions: feedback.flatMap((entry) => entry?.actions ?? []),
  };
}

/**
 * The form fields an ask_user widget binds, in the order they appear: each writable `$this.FIELD`.
 *
 * @param widget - The widget the ask's form shows.
 * @returns The field names.
 */
function fieldsOf(widget: IRPCData): string[] {
  if (!widget || typeof widget !== 'object') return [];
  if (Array.isArray(widget)) return widget.flatMap(fieldsOf);
  const node = widget as { bindings?: { state?: string; writable?: boolean }[]; children?: IRPCData[] };
  const own = (node.bindings ?? [])
    .filter((binding) => binding.writable && binding.state?.startsWith('$this.'))
    .map((binding) => (binding.state as string).slice('$this.'.length));
  return [...own, ...(node.children ?? []).flatMap(fieldsOf)];
}
