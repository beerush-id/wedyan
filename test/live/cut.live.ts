import { mutable, withContext } from '@airlib/react';
import type { ChatOutput } from '@irpclib/ai-kit';
import { AIAdapter } from '@irpclib/ai-kit/worker';
import { describe, it } from 'vitest';
import { createAgents, DEFAULT_MODELS, ENTRY } from '../../lib/agents/index.js';
import { withModels } from '../../lib/server/setup.js';
import { PROVIDERS } from './beat.js';

/*
 * What the router's model really writes, raw, before any parsing, for asks it has gone wrong on:
 * whether it says what it can't do plainly, and whether it copies how its earlier answers began.
 */

/** A conversation where every answer opens with who it is, as agents see one. */
const HISTORY = [
  'user: maybe John',
  'wedyan: said "Got it — you can call me John from now on!"',
  'user: Okay, you are funny now.',
  'wedyan: said "Haha, glad I could make you smile! Yes, I\'m still John for you — Wedyan, powered by Muse Spark built by Meta, at your service."',
  'user: What can you do for me?',
  'wedyan: said "I\'m John for you — Wedyan, powered by Muse Spark built by Meta — and I can help you manage your desktop."',
];

const ASKS = [
  { text: 'Can you search for the most recent news in Indonesia? Around AI topics.' },
  { text: 'Do you know what time is it?', history: true, context: { time: '2026-10-31T11:30:00+07:00' } },
  { text: 'How useful are you?', history: true },
];

describe.skipIf(!PROVIDERS.meta.key)('the raw reply, live', () => {
  it('prints what it writes', { timeout: 300_000 }, async () => {
    const adapter = withModels(new AIAdapter(), { meta: PROVIDERS.meta.key });
    const router = createAgents(DEFAULT_MODELS)[ENTRY];

    for (const { text, history, context } of ASKS) {
      for (let run = 1; run <= 3; run++) {
        await withContext(async () => {
          const live = mutable<{ data?: ChatOutput }>({});
          await new Promise<void>((resolve, reject) => {
            void adapter.ask(
              [
                ...(history ? [{ role: 'user', type: 'object', data: { conversation: HISTORY } } as const] : []),
                { role: 'user', type: 'object', data: { text, ...(context ? { context } : {}) } },
              ],
              {
                model: router.model,
                system: router.system,
                tools: router.tools,
                ...(router.effort ? { reasoningEffort: router.effort } : {}),
              },
              { state: live, resolve, reject },
            );
          });
          const said = live.data?.text || (live.data?.chunks ?? []).join('');
          process.stdout.write(`\n[${text.slice(0, 26)}] ${JSON.stringify(said.slice(0, 190))}\n`);
        });
      }
    }
  });
});
