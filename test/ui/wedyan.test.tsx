import { execFileSync } from 'node:child_process';
import { withContext } from '@airlib/react';
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VISITOR_LIMIT } from '../../lib/server/usage.js';
import { isUsageLimit } from '../../lib/share/usage.js';
import { wedyan } from '../../lib/share/wedyan.js';
import { speak } from '../../lib/speech/speech.h.js';

// The desktop opening its conversation: one call, its tab's ID kept for it.

describe('a desktop opening the conversation', () => {
  it('opens as this tab, keeping its ID, and a duplicated tab opens with one of its own', async () => {
    await withContext(async () => {
      const first = wedyan();
      await waitFor(() => expect(first.data.ready).toBe(true), { timeout: 10_000 });
      const id = sessionStorage.getItem('wedyan.tab');
      expect(id).toBeTruthy();

      // A duplicated tab: the same storage, so the same ID, while the first is still open.
      const second = wedyan();
      await waitFor(() => expect(second.data.ready).toBe(true), { timeout: 10_000 });
      expect(sessionStorage.getItem('wedyan.tab')).not.toBe(id);

      first.close();
      second.close();
    });
  });

  // Only against a deployment: it spends a model call, and proves the deployment's own keys work.
  it.runIf(process.env.WEDYAN_ORIGIN)('gets an answer from the deployed models', { timeout: 90_000 }, async () => {
    await withContext(async () => {
      const chat = wedyan();
      await waitFor(() => expect(chat.data.ready).toBe(true), { timeout: 10_000 });

      await chat.ask('send', {
        text: 'Say hello in three words.',
        context: { time: new Date().toISOString() },
      });
      const answer = () => chat.data.messages.findLast((message) => message.role === 'agent');
      await waitFor(() => expect(['done', 'error']).toContain(answer()?.status), { timeout: 80_000 });

      process.stdout.write(`\n=== deployed answer: ${JSON.stringify(answer()).slice(0, 400)}\n`);
      expect(answer()?.status).toBe('done');
      chat.close();
    });
  });

  // Only against a deployment: limits are held there alone, and this session is put past its own.
  it.runIf(process.env.WEDYAN_ORIGIN)(
    'tells a visitor past the day’s limit, with no model called',
    {
      timeout: 90_000,
    },
    async () => {
      await withContext(async () => {
        const [session] = document.cookie.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) ?? [];
        const day = new Date().toISOString().slice(0, 10);
        const past = ['chat', 'speech']
          .map(
            (
              kind,
            ) => `INSERT INTO wedyan_usage (scope, kind, day, used) VALUES ('${session}', '${kind}', '${day}', 100000)
        ON CONFLICT (scope, kind, day) DO UPDATE SET used = 100000`,
          )
          .join(';');
        execFileSync(
          'bunx',
          ['wrangler', 'd1', 'execute', 'wedyan-index', '--remote', '--env', 'production', '--command', past],
          {
            stdio: 'pipe',
          },
        );

        const chat = wedyan();
        await waitFor(() => expect(chat.data.ready).toBe(true), { timeout: 10_000 });
        await chat.ask('send', { text: 'Say hello again.', context: { time: new Date().toISOString() } });
        const answer = () => chat.data.messages.findLast((message) => message.role === 'agent');
        await waitFor(() => expect(['done', 'error']).toContain(answer()?.status), { timeout: 30_000 });

        process.stdout.write(`\n=== past the limit: ${JSON.stringify(answer()).slice(0, 300)}\n`);
        // In the conversation: an ordinary answer, nothing for the desktop to handle.
        expect(answer()).toMatchObject({ status: 'done', parts: [{ type: 'text', text: VISITOR_LIMIT }] });
        chat.close();

        // A direct call: rejected with its code over the wire, and words ready to show.
        const refused = await Promise.resolve(speak('Hello')).catch((error: unknown) => error);
        expect(isUsageLimit(refused)).toBe(true);
        expect((refused as Error).message).toBe(VISITOR_LIMIT);
      });
    },
  );
});
