import { withContext } from '@airlib/react';
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { wedyan } from '../../lib/share/wedyan.js';

// Two visitors at once, each a run of this file with `VISITOR` set: separate pages, separate sessions,
// real WebSockets. `first` says something and stays; `second` must not see it.

const VISITOR = process.env.VISITOR;
const WORDS = `a word only the first visitor knows ${process.env.MARK}`;

describe.runIf(VISITOR)('two visitors at once', () => {
  it(`keeps each one’s conversation their own (${VISITOR})`, { timeout: 60_000 }, async () => {
    await withContext(async () => {
      const { chat } = wedyan();
      await waitFor(() => expect(chat.data.ready).toBe(true), { timeout: 15_000 });
      const said = () => chat.data.messages.filter((message) => message.role === 'user').map(({ text }) => text);
      const [session] = document.cookie.match(/[0-9a-f]{8}-[0-9a-f]{4}/) ?? [];

      if (VISITOR === 'first') {
        await chat.ask('send', { text: WORDS });
        process.stdout.write(`\n=== first ${session}: said it, ${chat.data.messages.length} messages\n`);
        // Stays connected, so the second arrives while this one's conversation is live.
        await new Promise((resolve) => setTimeout(resolve, 25_000));
      } else {
        process.stdout.write(`\n=== second ${session}: sees ${JSON.stringify(said())}\n`);
        expect(said()).not.toContain(WORDS);
      }
      chat.close();
    });
  });
});
