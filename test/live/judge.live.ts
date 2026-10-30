import { describe, expect, it } from 'vitest';
import { COMPOSER, createAgents, ENTRY } from '../../lib/agents/index.js';
import { askRouter, setupKernel } from '../../lib/kernel/agent.js';
import { JUDGE_PROMPT } from '../../lib/kernel/chat.js';
import { liveAdapter, PROVIDERS } from './beat.js';

/*
 * The router's judgment of the user's words on the models Wedyan ships with: what it acknowledges,
 * and what it puts off for later. `QUALITY_RUNS` runs each case (3 by default).
 */

const RUNS = Number(process.env.QUALITY_RUNS ?? 3);

const BUILD = { id: 'build', line: 'wedyan: said "Scripting the drama: episode 4 of 30."' };
const RENDER = { id: 'render', line: 'wedyan: said "Your render is done, let me know if you want to play it."' };

/** Words to the render-done answer while the build runs, and how each must be judged. */
const CASES: Array<{ words: string; later: boolean }> = [
  { words: 'I need to go, will watch it later.', later: true },
  { words: 'Remind me about it when I’m back.', later: true },
  { words: 'Play it.', later: false },
  { words: 'Thanks!', later: false },
];

type Judgment = { acks?: string[]; later?: string[] };

describe.skipIf(!PROVIDERS.meta.key && !PROVIDERS.baseten.key)('the router’s judgment of words, live', () => {
  it('puts off for later only what the words put off', { timeout: 600_000 }, async () => {
    setupKernel({ adapter: liveAdapter(), agents: createAgents(), entry: ENTRY, composer: COMPOSER });
    const lines: string[] = [];

    for (const { words, later } of CASES) {
      for (let run = 1; run <= RUNS; run += 1) {
        const started = Date.now();
        const reply = await askRouter(JUDGE_PROMPT, {
          words,
          running: [BUILD],
          unacknowledged: [{ ...RENDER, latest: true }],
        });
        const judged = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)) as Judgment;
        const deferred = judged.later?.includes(RENDER.id) ?? false;
        lines.push(`${words} #${run} | later: ${deferred} | ${Date.now() - started} ms | ${JSON.stringify(judged)}`);
        expect.soft(deferred, `${words} #${run}: ${reply}`).toBe(later);
      }
    }

    process.stdout.write(`\n=== judge (later expected for the first two)\n${lines.join('\n')}\n`);
  });
});
