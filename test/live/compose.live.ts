import { writeFileSync } from 'node:fs';
import type { ChatOutput } from '@irpclib/ai-kit';
import { mutable } from '@irpclib/irpc/core';
import { describe, expect, it } from 'vitest';
import { createAgents } from '../../lib/agents/index.js';
import { personaPrompt } from '../../lib/agents/persona.js';
import { liveAdapter, PROVIDERS } from './beat.js';

// Whether a model can do June's job: the same descriptions an agent would write, composed with
// June's own prompt, checked as the kernel and the desktop would take them. Prints a table, and
// writes every answer to COMPOSE_OUT when set.

const RUNS = Number(process.env.COMPOSE_RUNS ?? 2);

const MODELS = [
  { provider: 'baseten', model: 'meta-models/muse-spark-open-1026', effort: 'low' },
  { provider: 'meta', model: 'muse-spark-1.3', effort: 'minimal' },
].filter((config) => PROVIDERS[config.provider as keyof typeof PROVIDERS].key);

type Node = string | { role?: unknown; props?: Record<string, unknown>; bindings?: unknown; children?: Node[] };

/** Every node of a tree, depth first. */
const flat = (nodes: Node[]): Node[] =>
  nodes.flatMap((node) => (typeof node === 'string' ? [node] : [node, ...flat(node.children ?? [])]));
const roles = (nodes: Node[]) => flat(nodes).flatMap((node) => (typeof node === 'string' ? [] : [String(node.role)]));
const text = (nodes: Node[]) => JSON.stringify(nodes);
const boundTo = (nodes: Node[], field: string) => text(nodes).includes(`"$this.${field}"`);

const CASES: Array<{
  name: string;
  request: { widget: string } | { form: string };
  persona?: string;
  checks: (nodes: Node[]) => Array<[string, boolean]>;
}> = [
  {
    name: 'card with stats',
    request: { widget: 'A card titled Today with two stats: 3 unread mails, 2 meetings.' },
    checks: (nodes) => [
      [
        'a card titled Today',
        flat(nodes).some((n) => typeof n !== 'string' && n.role === 'card' && n.props?.title === 'Today'),
      ],
      ['keeps 3 and 2', /\b3\b/.test(text(nodes)) && /\b2\b/.test(text(nodes))],
    ],
  },
  {
    name: 'list of projects',
    request: { widget: 'A list of three projects: Lantern river, Lantern short, and Wedyan promo A.' },
    checks: (nodes) => [
      [
        'names all three',
        ['Lantern river', 'Lantern short', 'Wedyan promo A'].every((name) => text(nodes).includes(name)),
      ],
    ],
  },
  {
    name: 'choice form',
    request: { form: 'A choice named "choice" between keep (Keep it) and delete (Delete it).' },
    checks: (nodes) => [
      ['a radio-group', roles(nodes).includes('radio-group')],
      ['bound to $this.choice', boundTo(nodes, 'choice')],
      ['values keep and delete', text(nodes).includes('"keep"') && text(nodes).includes('"delete"')],
    ],
  },
  {
    name: 'text form',
    request: { form: 'A free-text field named "answer", asking for their name.' },
    checks: (nodes) => [
      ['a text-input', roles(nodes).includes('text-input')],
      ['bound to $this.answer', boundTo(nodes, 'answer')],
    ],
  },
  {
    name: 'onboarding form',
    request: { form: 'The onboarding form.' },
    checks: (nodes) => [['exactly [{"role":"onboarding"}]', text(nodes) === '[{"role":"onboarding"}]']],
  },
  {
    name: 'user’s look',
    request: { widget: 'A card titled Weekend with one stat: 5 new photos.' },
    persona: personaPrompt({ refinements: ['I like frosted glass UI.'] }),
    checks: (nodes) => [['glass variant', text(nodes).includes('"variant":"glass"')]],
  },
];

describe.skipIf(!MODELS.length)('June composing, live', () => {
  it('composes valid widgets and forms on each model', { timeout: 600_000 }, async () => {
    const june = createAgents().june;
    const adapter = liveAdapter();
    const rows: Array<Record<string, unknown>> = [];

    for (const config of MODELS) {
      for (const sample of CASES) {
        for (let run = 1; run <= RUNS; run += 1) {
          const live = mutable<{ data?: ChatOutput }>({});
          const system = sample.persona ? `${june.system}\n\n${sample.persona}` : june.system;
          const started = Date.now();
          await new Promise<void>((resolve, reject) => {
            void adapter.ask(
              [{ role: 'user', type: 'object', data: sample.request }],
              { model: config.model, system, tools: [], reasoningEffort: config.effort },
              { state: live, resolve, reject },
            );
          });
          const ms = Date.now() - started;
          const answer =
            live.data?.text || (live.data?.chunks ?? []).join('') || (live.data?.commentary ?? []).join('');

          // As the kernel takes it: JSON, fenced or not, one node or a list.
          let nodes: Node[] | undefined;
          try {
            const parsed = JSON.parse(answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
            nodes = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            nodes = undefined;
          }
          const valid =
            !!nodes?.length &&
            flat(nodes).every((node) => typeof node === 'string' || typeof node.role === 'string') &&
            // Only roles June was taught: each one named in her prompt.
            roles(nodes).every((role) => june.system.includes(role));
          const checks: Array<[string, boolean]> = [
            ['valid nodes, known roles', valid],
            ...(nodes && valid ? sample.checks(nodes) : []),
          ];
          for (const [check, pass] of checks) {
            rows.push({ model: config.model, case: sample.name, run, check, pass, ms, answer });
            expect.soft(pass, `${config.model} / ${sample.name} #${run}: ${check}\n${answer}`).toBe(true);
          }
        }
      }
    }

    if (process.env.COMPOSE_OUT) writeFileSync(process.env.COMPOSE_OUT, JSON.stringify(rows, null, 2));
    const summary = MODELS.map(({ model }) => {
      const mine = rows.filter((row) => row.model === model);
      const times = [...new Set(mine.map((row) => `${row.case}#${row.run}`))].map(
        (key) => mine.find((row) => `${row.case}#${row.run}` === key)?.ms as number,
      );
      return `${model}: ${mine.filter((row) => row.pass).length}/${mine.length} checks, ${Math.min(...times)}–${Math.max(...times)} ms`;
    });
    process.stdout.write(`\n=== composing\n${summary.join('\n')}\n`);
  });
});
