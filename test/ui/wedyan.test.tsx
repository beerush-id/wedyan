import { withContext } from '@airlib/react';
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { wedyan } from '../../lib/share/wedyan.js';

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
});
