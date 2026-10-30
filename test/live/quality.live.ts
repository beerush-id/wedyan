import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type AgentModels, BRIEFER } from '../../lib/agents/index.js';
import type { TextPart, WidgetPart } from '../../lib/kernel/agent.h.js';
import { ARRIVED, ask, type BeatResult, PROFILE, PROVIDERS, runBeat } from './beat.js';

/*
 * Output quality on real Wedyan asks, per provider. Each beat's result is checked against the
 * format Wedyan expects; every check is a soft assertion, so one run reports every miss.
 *
 * Expected format, every ask:
 * - ends `done`, with no malformed markers reported back to the model;
 * - speaks: at least one spoken part, all spoken text together at most 280 characters;
 * - never claims an action is done: no "opened", "deleted", "tiled" or "shown" for an action it wrote;
 * - widgets are drawn by the composer: ready, with widget nodes of a string `role`, a card's with a
 *   string `props.title`.
 *
 * Expected per beat:
 * - router-answer: "Good morning!" is answered by the router itself, with no handoff and no calls.
 * - wake: the router hands off to wendy; wendy reads what arrived, shows at least two widgets, and
 *   greets the user by name.
 * - open: one action opens the short-drama project (app.open with a file in it, or app.files.reveal),
 *   one opens a mail (app.mail.open, m1 or m2), each anchored after a part.
 * - delete: ask_user comes before app.files.delete, which targets the selected file.
 * - photo: sys.photos.search, then sys.image.segment on the found photo, then sys.image.edit with the
 *   mask, then app.photos.show with the edited photo.
 * - onboarding: ask_user at least once.
 */

const RUNS = Number(process.env.QUALITY_RUNS ?? 3);

const CONFIGS: Array<{ name: string; models: AgentModels; needs: Array<keyof typeof PROVIDERS> }> = [
  {
    name: 'meta',
    needs: ['meta'],
    models: {
      router: { model: 'muse-spark-1.3', effort: 'minimal' },
      agents: { model: 'muse-spark-1.3', effort: 'minimal' },
    },
  },
  {
    name: 'baseten',
    needs: ['baseten'],
    models: {
      router: { model: 'meta-models/muse-spark-open-1026', effort: 'low' },
      agents: { model: 'meta-models/muse-spark-open-1026', effort: 'low' },
    },
  },
  {
    name: 'split',
    needs: ['meta', 'baseten'],
    models: {
      router: { model: 'meta-models/muse-spark-open-1026', effort: 'low' },
      agents: { model: 'muse-spark-1.3', effort: 'minimal' },
    },
  },
  // Standard effort: each provider's own default, no effort sent.
  {
    name: 'meta-standard',
    needs: ['meta'],
    models: { router: { model: 'muse-spark-1.3' }, agents: { model: 'muse-spark-1.3' } },
  },
  {
    name: 'baseten-standard',
    needs: ['baseten'],
    models: {
      router: { model: 'meta-models/muse-spark-open-1026' },
      agents: { model: 'meta-models/muse-spark-open-1026' },
    },
  },
  {
    name: 'split-standard',
    needs: ['meta', 'baseten'],
    models: { router: { model: 'meta-models/muse-spark-open-1026' }, agents: { model: 'muse-spark-1.3' } },
  },
  {
    name: 'wonder-low',
    needs: ['meta'],
    models: {
      router: { model: 'muse-spark-1.3', effort: 'minimal' },
      agents: { model: 'muse-wonder-1.0', effort: 'low' },
    },
  },
  {
    name: 'wonder-minimal',
    needs: ['meta'],
    models: {
      router: { model: 'muse-spark-1.3', effort: 'minimal' },
      agents: { model: 'muse-wonder-1.0', effort: 'minimal' },
    },
  },
].filter(
  (config) =>
    config.needs.every((provider) => PROVIDERS[provider as keyof typeof PROVIDERS].key) &&
    // `QUALITY_ONLY=wonder` limits the run to configs whose name contains it.
    (!process.env.QUALITY_ONLY || config.name.includes(process.env.QUALITY_ONLY)),
);

type Check = { name: string; pass: boolean; detail?: string };

const spoken = (result: BeatResult) =>
  result.parts
    .filter((part): part is TextPart => part.type === 'text' && part.spoken)
    .map((part) => part.text ?? part.chunks.join(''))
    .join(' ');
const widgets = (result: BeatResult) => result.parts.filter((part): part is WidgetPart => part.type === 'widget');
/** What an answer told the user: what it spoke, and what its widgets show. */
const told = (result: BeatResult) =>
  [spoken(result), ...widgets(result).map((widget) => `${widget.intent} ${JSON.stringify(widget.nodes)}`)].join(' ');
const called = (result: BeatResult, name: string) => result.calls.filter((call) => call.name === name);
const acted = (result: BeatResult, name: string) => result.actions.filter((action) => action.name === name);

/** The files an answer wrote, in the order it wrote them: each write's path and content as text. */
const written = (result: BeatResult) =>
  called(result, 'r2-file.write').map((call) => {
    const { path, data } = call.args as { path: string; data: unknown };
    return { path, text: typeof data === 'string' ? data : JSON.stringify(data) };
  });
/** A file's content as JSON, or undefined when it isn't. */
const json = (text?: string): Record<string, unknown> | undefined => {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const CLAIMS: Record<string, RegExp> = {
  'app.open': /\bopened\b/i,
  'app.mail.open': /\bopened\b/i,
  'app.files.delete': /\bdeleted\b/i,
  'desktop.tile': /\btiled\b/i,
  'app.photos.show': /\bshown\b/i,
};

/** The checks every ask must pass. */
function common(result: BeatResult): Check[] {
  const voice = spoken(result);
  const claims = result.actions
    .map((action) => CLAIMS[action.name])
    .filter((pattern) => pattern?.test(voice))
    .map((pattern) => String(pattern));
  return [
    { name: 'done', pass: result.status === 'done', detail: result.reason },
    { name: 'well-formed markers', pass: !result.invalid.length, detail: result.invalid.join(' | ') },
    { name: 'speaks', pass: voice.length > 0 },
    { name: 'speaks briefly', pass: voice.length <= 280, detail: `${voice.length} chars` },
    { name: 'no done-claims for actions', pass: !claims.length, detail: claims.join(', ') },
    {
      name: 'widgets are drawn as nodes',
      pass: widgets(result).every(
        (widget) =>
          widget.status === 'ready' &&
          widget.nodes.length > 0 &&
          (widget.nodes as Array<string | { role?: unknown; props?: { title?: unknown } }>).every(
            (node) =>
              typeof node === 'string' ||
              (typeof node.role === 'string' && (node.role !== 'card' || typeof node.props?.title === 'string')),
          ),
      ),
      detail: widgets(result)
        .filter((widget) => widget.status !== 'ready')
        .map((widget) => widget.error ?? widget.status)
        .join(', '),
    },
  ];
}

const BEATS: Array<{
  name: string;
  run: (models: AgentModels) => Promise<BeatResult>;
  checks: (result: BeatResult) => Check[];
}> = [
  {
    name: 'router-answer',
    run: (models) => runBeat(ask('Good morning!', PROFILE), { models }),
    checks: (result) => [
      { name: 'rita answers herself', pass: result.agents.join() === 'rita', detail: result.agents.join(' → ') },
      { name: 'no calls', pass: !result.calls.length, detail: result.calls.map((call) => call.name).join(', ') },
    ],
  },
  {
    name: 'wake',
    run: (models) =>
      runBeat(
        ask('(The user is back.)', {
          event: 'wake',
          awayMinutes: 420,
          arrived: ARRIVED,
          unseen: [],
          waiting: [],
          ...PROFILE,
        }),
        { models },
      ),
    checks: (result) => [
      { name: 'routed to wendy', pass: result.agents.includes('wendy'), detail: result.agents.join(' → ') },
      { name: 'reads what arrived', pass: called(result, 'r2-file.read').length > 0 },
      { name: 'shows ≥ 2 widgets', pass: widgets(result).length >= 2, detail: `${widgets(result).length}` },
      { name: 'greets by name', pass: /nanang/i.test(spoken(result)) },
    ],
  },
  {
    name: 'wake-later',
    run: (models) =>
      runBeat(
        ask('(The user is back.)', {
          event: 'wake',
          awayMinutes: 25,
          arrived: [],
          unseen: [],
          later: ['wedyan: said "Your render is done, let me know if you want to play it."'],
          waiting: [],
          working: ['wedyan: said "Scripting the drama: episode 12 of 30 done."'],
          ...PROFILE,
        }),
        { models, entry: BRIEFER },
      ),
    checks: (result) => [
      { name: 'answered by wendy', pass: result.agents.join() === 'wendy', detail: result.agents.join(' → ') },
      // Told when spoken or shown: a briefing speaks the few that matter most and shows each on a card.
      { name: 'reminds of the render', pass: /render/i.test(told(result)), detail: spoken(result) },
      { name: 'tells how far the work got', pass: /\b12\b|twelve/i.test(told(result)), detail: spoken(result) },
    ],
  },
  {
    name: 'job',
    run: (models) =>
      runBeat(
        ask('(A background job ended.)', {
          event: 'job',
          job: { title: 'the Wedyan promo render', path: '~/Motions/Wedyan promo/Renders/promo.mp4' },
          ...PROFILE,
        }),
        { models, entry: BRIEFER },
      ),
    checks: (result) => [
      { name: 'answered by wendy', pass: result.agents.join() === 'wendy', detail: result.agents.join(' → ') },
      { name: 'tells of the render', pass: /render/i.test(spoken(result)), detail: spoken(result) },
      {
        name: 'opens nothing unasked',
        pass: !result.actions.length,
        detail: result.actions.map((action) => action.name).join(', '),
      },
    ],
  },
  {
    name: 'build',
    run: (models) =>
      runBeat(
        ask("Let's start a new project: a short drama series, 3 episodes, about a lantern maker by the river. Set it up.", {
          ...PROFILE,
        }),
        { models, drive: new Map() },
      ),
    checks: (result) => {
      const writes = written(result);
      const motions = writes.filter(({ path }) => path.endsWith('.motion'));
      const stages = writes.filter(({ path }) => path.endsWith('.stage'));
      const script = writes.find(({ path }) => /\/Script\.md$/.test(path));
      const first = json(motions[0]?.text);
      const final = json(motions.at(-1)?.text);
      const listed = (final?.stages as string[] | undefined) ?? [];
      const stageFiles = new Set(stages.map(({ path }) => path.split('/').pop()));
      const placeholders = stages.every(({ text }) =>
        JSON.stringify(json(text)?.composition ?? {}).includes('"placeholder":true'),
      );
      const order = writes.map(({ path }) => path);
      return [
        { name: 'routed to lita with motions', pass: result.agents.includes('lita:motions'), detail: result.agents.join(' → ') },
        { name: 'all under ~/Motions/', pass: writes.length > 0 && writes.every(({ path }) => path.startsWith('~/Motions/')), detail: order.join(', ') },
        {
          name: 'project first, with no stages yet',
          pass: order.findIndex((path) => path.endsWith('.motion')) === 0 && Array.isArray(first?.stages) && !(first?.stages as unknown[]).length,
          detail: order[0],
        },
        { name: 'project has the header', pass: first?.type === 'motion' && first?.version === 1 && typeof first?.id === 'string' && (first?.author as { kind?: string })?.kind === 'agent' },
        { name: 'a series', pass: (first?.meta as { series?: boolean })?.series === true },
        { name: 'script with 3 headings', pass: (script?.text.match(/^## /gm) ?? []).length >= 3, detail: `${(script?.text.match(/^## /gm) ?? []).length}` },
        { name: '3 stages', pass: stageFiles.size === 3, detail: [...stageFiles].join(', ') },
        { name: 'stages point at the script', pass: stages.every(({ text }) => String(json(text)?.script ?? '').startsWith('Script.md#')) },
        { name: 'stages hold placeholders', pass: stages.length > 0 && placeholders },
        {
          name: 'project lists every stage',
          pass: listed.length === 3 && listed.every((path) => stageFiles.has(path.split('/').pop())),
          detail: listed.join(', '),
        },
        { name: 'opens the project', pass: acted(result, 'app.open').some((action) => JSON.stringify(action.args).includes('.motion')) },
      ];
    },
  },
  {
    name: 'open',
    run: (models) =>
      runBeat(
        ask("Open last night's short drama project, and the second mail.", {
          ...PROFILE,
          lastShown: [
            'Short drama v3 render finished',
            'Ana: Notes on the shoot schedule',
            'Rudi: Budget approved for episode 2',
          ],
        }),
        { models },
      ),
    checks: (result) => {
      const project = result.actions.find(
        (action) =>
          (action.name === 'app.open' || action.name === 'app.files.reveal') &&
          JSON.stringify(action.args).includes('short-drama'),
      );
      const mail = acted(result, 'app.mail.open')[0];
      const mailId = (mail?.args as { id?: string })?.id;
      return [
        { name: 'opens the project', pass: Boolean(project), detail: project?.name },
        { name: 'opens a mail', pass: mailId === 'm1' || mailId === 'm2', detail: mailId },
        { name: 'actions anchored', pass: result.actions.every((action) => action.after >= 0) },
      ];
    },
  },
  {
    name: 'delete',
    run: (models) =>
      runBeat(
        ask('Delete it.', {
          ...PROFILE,
          activeWindow: { app: 'files', selection: '~/projects/short-drama/script.md' },
        }),
        { models, replies: ['Yes, delete it.'] },
      ),
    checks: (result) => {
      const deletion = acted(result, 'app.files.delete')[0];
      return [
        { name: 'asks first', pass: acted(result, 'ask_user').length > 0 },
        {
          name: 'deletes the selection',
          pass: (deletion?.args as { path?: string })?.path === '~/projects/short-drama/script.md',
        },
      ];
    },
  },
  {
    name: 'photo',
    run: (models) => runBeat(ask('Remove the cat from my sofa photo.', PROFILE), { models }),
    checks: (result) => {
      const order = result.calls.map((call) => call.name);
      const segment = called(result, 'sys.image.segment')[0];
      const edit = called(result, 'sys.image.edit')[0];
      const show = acted(result, 'app.photos.show')[0];
      return [
        {
          name: 'routed to lita with photos',
          pass: result.agents.includes('lita:photos'),
          detail: result.agents.join(' → '),
        },
        {
          name: 'search → segment → edit',
          pass:
            order.indexOf('sys.photos.search') >= 0 &&
            order.indexOf('sys.photos.search') < order.indexOf('sys.image.segment') &&
            order.indexOf('sys.image.segment') < order.indexOf('sys.image.edit'),
          detail: order.join(' → '),
        },
        {
          name: 'segments the found photo',
          pass: (segment?.args as { image?: string })?.image === '~/pictures/sofa.jpg',
        },
        { name: 'edits with the mask', pass: (edit?.args as { mask?: string })?.mask === 'mask-7f3' },
        { name: 'shows the edit', pass: JSON.stringify(show?.args ?? '').includes('sofa-edited.jpg') },
      ];
    },
  },
  {
    name: 'onboarding',
    run: (models) =>
      runBeat(ask('(First visit.)', { event: 'onboarding' }), {
        models,
        replies: ['Call me Nanang.', 'Wedyan is fine.', 'I make short dramas for social media.'],
      }),
    checks: (result) => [{ name: 'asks with ask_user', pass: acted(result, 'ask_user').length > 0 }],
  },
];

describe.skipIf(!CONFIGS.length)('output quality on real asks, live', () => {
  it('checks every beat on every provider', { timeout: 3_600_000 }, async () => {
    const rows: Array<{
      config: string;
      beat: string;
      run: number;
      name: string;
      pass: boolean;
      detail?: string;
      ms: number;
    }> = [];

    // `QUALITY_BEATS=wake,open` limits the run to those beats.
    const only = process.env.QUALITY_BEATS?.split(',');
    for (const config of CONFIGS) {
      for (const beat of BEATS.filter(({ name }) => !only || only.includes(name))) {
        for (let run = 1; run <= RUNS; run += 1) {
          const result = await beat.run(config.models);
          for (const check of [...common(result), ...beat.checks(result)]) {
            rows.push({ config: config.name, beat: beat.name, run, ...check, ms: result.msTotal });
            expect
              .soft(check.pass, `${config.name} / ${beat.name} #${run}: ${check.name} — ${check.detail ?? ''}`)
              .toBe(true);
          }
        }
      }
    }

    if (process.env.QUALITY_OUT) writeFileSync(process.env.QUALITY_OUT, JSON.stringify(rows, null, 2));

    const summary = new Map<string, { pass: number; total: number; misses: string[] }>();
    for (const row of rows) {
      const key = `${row.config} | ${row.beat} | ${row.name}`;
      const entry = summary.get(key) ?? { pass: 0, total: 0, misses: [] };
      entry.total += 1;
      if (row.pass) entry.pass += 1;
      else entry.misses.push(row.detail ?? '');
      summary.set(key, entry);
    }
    const lines = [...summary].map(
      ([key, entry]) =>
        `${key} | ${entry.pass}/${entry.total}${entry.misses.length ? ` | ${entry.misses.join(' ; ')}` : ''}`,
    );
    process.stdout.write(`\n=== quality (passes of ${RUNS} runs)\n${lines.join('\n')}\n`);
  });
});
