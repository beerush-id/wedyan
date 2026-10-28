import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgentModels } from '../../lib/agents/index.js';
import type { TextPart, WidgetPart } from '../../lib/kernel/agent.h.js';
import { ask, type BeatResult, PROFILE, PROVIDERS, runBeat } from './beat.js';

/*
 * Output quality on real Wedyan asks, per provider. Each beat's result is checked against the
 * format Wedyan expects; every check is a soft assertion, so one run reports every miss.
 *
 * Expected format, every ask:
 * - ends `done`, with no malformed markers reported back to the model;
 * - speaks: at least one spoken part, all spoken text together at most 280 characters;
 * - never claims an action is done: no "opened", "deleted", "tiled" or "shown" for an action it wrote;
 * - widgets are widget nodes: a string `role`, and a card has a string `props.title`.
 *
 * Expected per beat:
 * - router-answer: "Good morning!" is answered by the router itself, with no handoff and no calls.
 * - wake: the router hands off to lita; lita calls sys.queue.list, shows at least two widgets, and
 *   greets the user by name.
 * - open: one action opens the short-drama project (app.open with a file in it, or app.files.reveal),
 *   one opens a mail (app.mail.open, m1 or m2), each anchored after a part.
 * - delete: ask_user comes before app.files.delete, which targets the selected file.
 * - photo: sys.photos.search, then sys.image.segment on the found photo, then sys.image.edit with the
 *   mask, then app.photos.show with the edited photo.
 * - onboarding: ask_user at least once, then sys.profile.save with the user's name.
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
      router: { model: 'meta-models/muse-spark-open', effort: 'low' },
      agents: { model: 'meta-models/muse-spark-open', effort: 'low' },
    },
  },
  {
    name: 'split',
    needs: ['meta', 'baseten'],
    models: {
      router: { model: 'meta-models/muse-spark-open', effort: 'low' },
      agents: { model: 'muse-spark-1.3', effort: 'minimal' },
    },
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
const called = (result: BeatResult, name: string) => result.calls.filter((call) => call.name === name);
const acted = (result: BeatResult, name: string) => result.actions.filter((action) => action.name === name);

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
      name: 'widgets are nodes',
      pass: widgets(result).every(
        (widget) =>
          typeof widget.role === 'string' &&
          (widget.role !== 'card' || typeof (widget.props as { title?: unknown })?.title === 'string'),
      ),
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
      { name: 'router answers itself', pass: result.agents.join() === 'router', detail: result.agents.join(' → ') },
      { name: 'no calls', pass: !result.calls.length, detail: result.calls.map((call) => call.name).join(', ') },
    ],
  },
  {
    name: 'wake',
    run: (models) => runBeat(ask('(The user unlocked the screen.)', { event: 'wake', ...PROFILE }), { models }),
    checks: (result) => [
      { name: 'routed to lita', pass: result.agents.includes('lita'), detail: result.agents.join(' → ') },
      { name: 'reads the queue', pass: called(result, 'sys.queue.list').length > 0 },
      { name: 'shows ≥ 2 widgets', pass: widgets(result).length >= 2, detail: `${widgets(result).length}` },
      { name: 'greets by name', pass: /nanang/i.test(spoken(result)) },
    ],
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
        { name: 'routed to photos', pass: result.agents.includes('photos'), detail: result.agents.join(' → ') },
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
        replies: ['Call me Nanang.', 'Lita is fine.', 'I make short dramas for social media.'],
      }),
    checks: (result) => {
      const saved = called(result, 'sys.profile.save')[0];
      return [
        { name: 'asks with ask_user', pass: acted(result, 'ask_user').length > 0 },
        { name: 'saves the profile', pass: /nanang/i.test(JSON.stringify(saved?.args ?? '')) },
      ];
    },
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

    for (const config of CONFIGS) {
      for (const beat of BEATS) {
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
