import { mutable, withContext } from '@airlib/react';
import { AIAdapter } from '@irpclib/ai-kit/worker';
import { describe, expect, it } from 'vitest';
import { COMPOSER, createAgents, DEFAULT_MODELS, ENTRY } from '../../lib/agents/index.js';
import { SKILLS } from '../../lib/agents/skills.js';
import type { AskState } from '../../lib/kernel/agent.h.js';
import { runAgentLoop } from '../../lib/kernel/agent.js';
import { withModels } from '../../lib/server/setup.js';
import { PROVIDERS } from './beat.js';

/*
 * Whether the user hears something before a slow call runs, on real models from the first agent on:
 * the answer's parts are timed against the call, which stands in for a picture taking a while.
 */

const ASKS = [
  'Draw me a picture of a cat on a lighthouse.',
  'Generate an image of a red bicycle in the rain.',
  'draw me a dancing cat. it must look funny, but realistic',
];

/** How long the stand-in call takes. */
const DRAWING = 2500;

describe.skipIf(!PROVIDERS.meta.key)('first words, live', () => {
  for (const ask of ASKS) {
    it(`speaks before it draws: ${ask}`, { timeout: 120_000 }, async () => {
      const adapter = withModels(new AIAdapter(), { meta: PROVIDERS.meta.key });
      const state = mutable<AskState>({ status: 'idle', agent: '', turn: 0, parts: [] });
      const started = Date.now();
      const since = () => ((Date.now() - started) / 1000).toFixed(1);
      const timeline: string[] = [];
      let spoke = 0;
      let called = 0;

      const watching = setInterval(() => {
        const said = state.parts.find((part) => part.type === 'text' && part.chunks.length);
        if (said && !spoke) {
          spoke = Date.now();
          timeline.push(`${since()} s first words (${state.agent})`);
        }
      }, 25);

      await withContext(() =>
        runAgentLoop({
          adapter,
          agents: createAgents(DEFAULT_MODELS),
          entry: ENTRY,
          composer: COMPOSER,
          skills: SKILLS,
          input: ask,
          state,
          resolve: async (call) => {
            called ||= Date.now();
            timeline.push(`${since()} s call ${call.name}`);
            await new Promise((resolve) => setTimeout(resolve, DRAWING));
            return { path: '~/Pictures/made.webp' };
          },
        }),
      );
      clearInterval(watching);

      const said = state.parts
        .map((part) => (part.type === 'text' ? (part.text ?? part.chunks.join('')) : `[widget]`))
        .join(' | ');
      const roles = state.parts.flatMap((part) => (part.type === 'widget' ? JSON.stringify(part.nodes) : []));
      process.stdout.write(
        `\n=== ${ask}\n${timeline.join('\n')}\n${since()} s done: ${said.slice(0, 200)}\ndrawn: ${roles.join(' ').slice(0, 300)}\n`,
      );

      expect(called, 'it never made the call').toBeGreaterThan(0);
      expect(
        state.parts.some((part) => part.type === 'widget'),
        'it didn’t show the picture in its answer',
      ).toBe(true);
      // Watched every 25 ms, so words said as the call starts can be seen just after it.
      expect(spoke, 'it said nothing as the call began').toBeGreaterThan(0);
      expect(spoke - called, 'it said nothing as the call began').toBeLessThan(100);
    });
  }
});
