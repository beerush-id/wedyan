import { writeFileSync } from 'node:fs';
import type { ChatTool } from '@irpclib/ai-kit';
import { describe, it } from 'vitest';
import { createAgents } from '../../lib/agents/index.js';
import { HANDOFF } from '../../lib/kernel/agent.js';

// Times real agent turns on the Meta Model API's Responses endpoint, phase by phase, across models
// and reasoning efforts, to decide whether every agent can run on Muse without Baseten. Writes the
// raw samples to TIMING_OUT (or prints them) and a median table to stdout.

const RUNS = Number(process.env.TIMING_RUNS ?? 2);

/** Where a model is served: the Meta Model API, or Baseten for the open-weight Spark. */
const PROVIDERS = {
  meta: { base: 'https://api.meta.ai/v1', key: process.env.MUSE_API_KEY ?? '' },
  baseten: { base: 'https://inference.baseten.co/v1', key: process.env.BASETEN_API_KEY ?? '' },
};

type Config = { provider: keyof typeof PROVIDERS; model: string; effort?: string };

const ALL_CONFIGS: Config[] = [
  { provider: 'meta', model: 'muse-spark-1.3' },
  { provider: 'meta', model: 'muse-spark-1.3', effort: 'low' },
  { provider: 'meta', model: 'muse-spark-1.3', effort: 'minimal' },
  { provider: 'meta', model: 'muse-spark-1.2' },
  { provider: 'meta', model: 'muse-spark-1.2', effort: 'minimal' },
  { provider: 'meta', model: 'muse-spark-1.1' },
  { provider: 'meta', model: 'muse-spark-1.1', effort: 'minimal' },
  { provider: 'meta', model: 'muse-spark-1.3-contributor' },
  { provider: 'meta', model: 'muse-spark-1.3-contributor', effort: 'minimal' },
  { provider: 'meta', model: 'muse-wonder-1.0' },
  { provider: 'meta', model: 'muse-wonder-1.0', effort: 'low' },
  { provider: 'meta', model: 'muse-wonder-1.0', effort: 'minimal' },
  { provider: 'baseten', model: 'meta-models/muse-spark-open' },
  { provider: 'baseten', model: 'meta-models/muse-spark-open', effort: 'low' },
  { provider: 'baseten', model: 'meta-models/muse-spark-open', effort: 'minimal' },
];

/**
 * `TIMING_ONLY=baseten` (or `meta`) limits the run to one provider, `TIMING_MODEL=wonder` to models
 * whose id contains it; configs without a key are skipped.
 */
const CONFIGS = ALL_CONFIGS.filter(
  (config) =>
    PROVIDERS[config.provider].key &&
    (!process.env.TIMING_ONLY || process.env.TIMING_ONLY === config.provider) &&
    (!process.env.TIMING_MODEL || config.model.includes(process.env.TIMING_MODEL)),
);

const agents = createAgents();
const routerTools: ChatTool[] = [
  {
    name: HANDOFF,
    description: 'Pass this ask to an agent better suited to it. Ends your turn.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: agents.router.handoffs ?? [] },
        brief: { type: 'string' },
      },
      required: ['agent', 'brief'],
    },
  },
];

const context = (data: Record<string, unknown>) => ({ role: 'user', content: JSON.stringify({ context: data }) });
const QUEUE = [
  { id: 'q1', kind: 'render', title: 'Short drama v3 render finished', at: '02:14' },
  { id: 'm1', kind: 'mail', from: 'Ana', title: 'Notes on the shoot schedule', at: '06:40' },
  { id: 'm2', kind: 'mail', from: 'Rudi', title: 'Budget approved for episode 2', at: '07:05' },
  { id: 'c1', kind: 'meeting', title: 'Casting call with Ana', at: '10:00 today' },
];

/** One turn of a beat, as the kernel would send it. */
const SCENARIOS: Array<{ name: string; system: string; tools: ChatTool[]; input: unknown[] }> = [
  {
    name: 'router → handoff',
    system: agents.router.system,
    tools: routerTools,
    input: [{ role: 'user', content: 'Open the second mail I got this morning.' }],
  },
  {
    name: 'router → own answer',
    system: agents.router.system,
    tools: routerTools,
    input: [{ role: 'user', content: 'Good morning!' }],
  },
  {
    name: 'lita → tool call',
    system: agents.lita.system,
    tools: agents.lita.tools,
    input: [
      context({ event: 'wake', userName: 'Nanang', assistantName: 'Lita' }),
      { role: 'user', content: '(The user unlocked the screen.)' },
    ],
  },
  {
    name: 'lita → briefing answer',
    system: agents.lita.system,
    tools: agents.lita.tools,
    input: [
      context({ event: 'wake', userName: 'Nanang', assistantName: 'Lita' }),
      { role: 'user', content: '(The user unlocked the screen.)' },
      { type: 'function_call', call_id: 'call_seed', name: 'sys__queue__list', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_seed', output: JSON.stringify(QUEUE) },
    ],
  },
];

type Sample = {
  scenario: string;
  model: string;
  effort: string;
  status: number;
  firstEvent?: number;
  firstReasoning?: number;
  firstCommentary?: number;
  firstAnswer?: number;
  firstCall?: number;
  total: number;
  outcome: string;
};

/** The fields of a Responses API stream event this harness reads. */
type StreamEvent = {
  type: string;
  delta?: string;
  item_id?: string;
  item?: { id: string; type: string; phase?: string; name?: string; arguments?: string };
};

/** Streams one turn and timestamps each phase, in milliseconds from the request. */
async function timeTurn(scenario: (typeof SCENARIOS)[number], config: Config): Promise<Sample> {
  const started = performance.now();
  const at = () => Math.round(performance.now() - started);
  const sample: Sample = {
    scenario: scenario.name,
    model: config.model,
    effort: config.effort ?? 'default',
    status: 0,
    total: 0,
    outcome: '',
  };

  const provider = PROVIDERS[config.provider];
  const response = await fetch(`${provider.base}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      instructions: scenario.system,
      input: scenario.input,
      tools: scenario.tools.map((tool) => ({
        type: 'function',
        name: tool.name.replace(/\./g, '__'),
        ...(tool.description ? { description: tool.description } : {}),
        ...(tool.parameters ? { parameters: tool.parameters } : {}),
      })),
      reasoning: { summary: 'auto', ...(config.effort ? { effort: config.effort } : {}) },
    }),
  });
  sample.status = response.status;
  if (!response.ok || !response.body) {
    sample.total = at();
    sample.outcome = (await response.text()).slice(0, 160);
    return sample;
  }

  const phases = new Map<string, string | undefined>();
  const calls: string[] = [];
  let answer = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((part) => part.startsWith('data: '));
      if (!line || line === 'data: [DONE]') continue;
      const event = JSON.parse(line.slice(6)) as StreamEvent;
      sample.firstEvent ??= at();
      if (event.type === 'response.reasoning_summary_text.delta') sample.firstReasoning ??= at();
      if (event.type === 'response.output_item.added' && event.item?.type === 'message') {
        phases.set(event.item.id, event.item.phase);
      }
      if (event.type === 'response.output_text.delta') {
        if (phases.get(event.item_id) === 'commentary') sample.firstCommentary ??= at();
        else {
          sample.firstAnswer ??= at();
          answer += event.delta;
        }
      }
      if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
        sample.firstCall ??= at();
        const name = event.item.name ?? '';
        calls.push(name === HANDOFF ? `handoff(${JSON.parse(event.item.arguments ?? '{}').agent})` : name);
      }
    }
  }

  sample.total = at();
  sample.outcome = calls.length ? calls.join(', ') : `answer: ${answer.length} chars`;
  return sample;
}

const median = (values: Array<number | undefined>) => {
  const sorted = values.filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
};

describe.skipIf(!CONFIGS.length)('turn timings on the Muse API and Baseten, live', () => {
  it('times every scenario on every config', { timeout: 1_800_000 }, async () => {
    const samples: Sample[] = [];
    for (const config of CONFIGS) {
      for (const scenario of SCENARIOS) {
        for (let run = 0; run < RUNS; run += 1) samples.push(await timeTurn(scenario, config));
      }
    }

    if (process.env.TIMING_OUT) writeFileSync(process.env.TIMING_OUT, JSON.stringify(samples, null, 2));

    const rows = new Map<string, Sample[]>();
    for (const sample of samples) {
      const key = `${sample.scenario} | ${sample.model} | ${sample.effort}`;
      rows.set(key, [...(rows.get(key) ?? []), sample]);
    }
    const lines = ['scenario | model | effort | status | reasoning | commentary | answer | call | total | outcomes'];
    for (const [key, group] of rows) {
      const cell = (pick: (sample: Sample) => number | undefined) => median(group.map(pick)) ?? '-';
      lines.push(
        [
          key,
          group.map((sample) => sample.status).join('/'),
          cell((sample) => sample.firstReasoning),
          cell((sample) => sample.firstCommentary),
          cell((sample) => sample.firstAnswer),
          cell((sample) => sample.firstCall),
          cell((sample) => sample.total),
          group.map((sample) => sample.outcome).join(' ; '),
        ].join(' | '),
      );
    }
    process.stdout.write(`\n=== timings (median ms of ${RUNS})\n${lines.join('\n')}\n`);
  });
});
