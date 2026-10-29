import { createContextStore, SESSION_STORE, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { read, write } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupKernel } from '../../lib/kernel/agent.js';
import { type AgentMessage, type Conversation, wedyan } from '../../lib/kernel/chat.h.js';
import { CONVERSATION_PATH, pagePath, RECENT_TURNS, setupConversation } from '../../lib/kernel/chat.js';
import { AGENTS, createTestAdapter } from './fixtures.js';
import { messagesOf, mockVendor, says } from './vendor.js';

// The conversation runs for real: the kernel, the room, r2-file on local R2 and D1, and IRPC's calls.
// Only the model provider is mocked.

const SESSION = 'chat-test-session';

beforeAll(async () => {
  const env = await resolveBinding<{ BUCKET: never; DB: never }>(undefined, { remoteBindings: false });
  implement({ bucket: env.BUCKET, indexer: env.DB });
  SESSION_STORE.key(SESSION);
});

/** A user and session unique to this run, so tests never share a home or a room. */
const newUser = () => ({ user: `u-${crypto.randomUUID().slice(0, 8)}`, session: crypto.randomUUID() });

/** Runs `fn` as one of the user's desktops: their session, in their home. */
function asDesktop<T>({ user, session }: { user: string; session: string }, fn: () => Promise<T>): Promise<T> {
  return withContext(createContextStore([[SESSION, session]]), () => {
    fsContext.set({ ownerId: user, homeDir: `/users/${user}` });
    return fn();
  });
}

/** Waits until `check` holds, failing after `timeout` ms. */
async function until(check: () => boolean, timeout = 3000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const last = (conversation: Conversation) => conversation.messages.at(-1);
const answered = (conversation: Conversation) => {
  const message = last(conversation);
  return message?.role === 'agent' && message.status !== 'running' && message.status !== 'idle';
};

describe('the conversation', () => {
  beforeEach(() => {
    setupKernel({ adapter: createTestAdapter(), agents: AGENTS, entry: 'assistant', composer: 'composer' });
    setupConversation({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams an answer into the conversation, and keeps it in ~/Desktop.chat', async () => {
    mockVendor(says('[[say]]Hello, ', 'Nanang.[[/say]]'));
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = wedyan();
      await until(() => desktop.data.ready);
      await desktop.ask('send', { text: 'Hi', context: { time: '2026-10-29T09:00:00+07:00' } });
      await until(() => answered(desktop.data));

      expect(desktop.data.messages).toMatchObject([
        { role: 'user', text: 'Hi', context: { time: '2026-10-29T09:00:00+07:00' } },
        { role: 'agent', status: 'done', parts: [{ type: 'text', text: 'Hello, Nanang.', spoken: true }] },
      ]);
      await until(() => false, 50).catch(() => undefined);
      const kept = (await read(CONVERSATION_PATH, { encoding: 'json' })) as Conversation;
      expect(kept.messages).toEqual(JSON.parse(JSON.stringify(desktop.data.messages)));
      desktop.close();
    });
  });

  it('shows every desktop of the session the same conversation, and no other session', async () => {
    mockVendor(says('Hello.'));
    const who = newUser();
    // Another user's desktop, open in its own session until the check is done.
    let elsewhere: ReturnType<typeof wedyan> | undefined;
    let done!: () => void;
    const checked = new Promise<void>((resolve) => {
      done = resolve;
    });
    const otherDesktop = asDesktop(newUser(), async () => {
      elsewhere = wedyan();
      await checked;
      elsewhere.close();
    });

    await asDesktop(who, async () => {
      const first = wedyan();
      const second = wedyan();
      await until(() => first.data.ready && second.data.ready && elsewhere?.data.ready === true);

      await first.ask('send', { text: 'Hi' });
      await until(() => answered(second.data));

      expect(second.data.messages).toEqual(first.data.messages);
      expect(elsewhere?.data.messages).toEqual([]);
      first.close();
      second.close();
    });
    done();
    await otherDesktop;
  });

  it('finishes and keeps an answer when the desktop that asked disconnects, for the next desktop to see', async () => {
    mockVendor(says('Here is your briefing.'));
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = wedyan();
      await until(() => desktop.data.ready);
      await desktop.ask('send', { text: 'Brief me' });
      desktop.close();
    });

    await asDesktop(who, async () => {
      await until(() => false, 300).catch(() => undefined);
      const next = wedyan();
      await until(() => next.data.ready);

      expect(next.data.messages).toMatchObject([
        { role: 'user', text: 'Brief me' },
        { role: 'agent', status: 'done', parts: [{ type: 'text', text: 'Here is your briefing.' }] },
      ]);
      next.close();
    });
  });

  it('gives the agents the last turns as lines, never their tool results or widget nodes', async () => {
    const vendor = mockVendor(
      says('[[say]]Opening Motion.[[/say]][[action name=app.open]]{"app":"motion"}[[/action]]'),
      says('[[widget]]A card titled Today[[/widget]]'),
      says('{"role":"card","props":{"title":"Today"}}'),
      says('Done.'),
    );
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = wedyan();
      desktop.answer('app.open', () => true);
      await until(() => desktop.data.ready);
      await desktop.ask('send', { text: 'Open Motion' });
      await until(() => answered(desktop.data));
      await desktop.ask('send', { text: 'Show today' });
      await until(() => desktop.data.messages.length === 4 && answered(desktop.data));
      await desktop.ask('send', { text: 'And now?' });
      await until(() => desktop.data.messages.length === 6 && answered(desktop.data));

      expect(messagesOf(vendor.bodies, 3).find((message) => message.content?.includes('conversation'))).toEqual({
        role: 'user',
        content: JSON.stringify({
          conversation: [
            'user: Open Motion',
            'wedyan: said "Opening Motion." · did: app.open {"app":"motion"}',
            'user: Show today',
            'wedyan: said nothing · showed: A card titled Today',
          ],
        }),
      });
      desktop.close();
    });
  });

  it('runs actions on the desktop that sent the words, and records them', async () => {
    mockVendor(says('[[action name=app.open]]{"app":"photos"}[[/action]]'));
    const who = newUser();

    await asDesktop(who, async () => {
      const sender = wedyan();
      const other = wedyan();
      const ranOn: string[] = [];
      sender.answer('app.open', () => void ranOn.push('sender'));
      other.answer('app.open', () => void ranOn.push('other'));
      await until(() => sender.data.ready && other.data.ready);

      await sender.ask('send', { text: 'Open Photos' });
      await until(() => answered(sender.data));

      expect(ranOn).toEqual(['sender']);
      expect((last(sender.data) as AgentMessage).actions).toEqual([{ name: 'app.open', args: { app: 'photos' } }]);
      sender.close();
      other.close();
    });
  });

  it('takes words sent during an answer as its follow-up, and stops an answer on stop', async () => {
    const vendor = mockVendor(
      says('[[say]]Which one?[[/say]][[ask_user]]A choice named "pick" between a and b.[[/ask_user]]'),
      says('[{"role":"radio-group"}]'),
      says('[[ask_user]]A yes or no named "sure".[[/ask_user]]'),
      says('[{"role":"switch"}]'),
    );
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = wedyan();
      let asked = 0;
      desktop.answer('ask_user', async () => {
        asked += 1;
        if (asked === 1) {
          await desktop.ask('send', { text: 'Make it b, and hurry' });
          return { pick: 'b' };
        }
        await desktop.ask('stop');
        return { sure: true };
      });
      await until(() => desktop.data.ready);
      await desktop.ask('send', { text: 'Pick one for me' });
      // The follow-up is appended after the answer it joined, so the answer is the second message.
      const answer = () => desktop.data.messages[1] as AgentMessage | undefined;
      await until(() => answer()?.status === 'stopped' && desktop.data.messages.length === 3);

      expect(desktop.data.messages.map((message) => message.role)).toEqual(['user', 'agent', 'user']);
      const followed = messagesOf(vendor.bodies, 2).some((message) => message.content === 'Make it b, and hurry');
      expect(followed).toBe(true);
      expect(answer()?.turn).toBe(2);
      desktop.close();
    });
  });

  it('marks an answer cut off when it was last kept as interrupted', async () => {
    const who = newUser();
    await asDesktop(who, async () => {
      await write(CONVERSATION_PATH, {
        type: 'chat',
        version: 1,
        id: 'c1',
        name: 'Desktop',
        created: '2026-10-29T00:00:00Z',
        updated: '2026-10-29T00:00:00Z',
        author: { kind: 'agent' },
        page: 0,
        messages: [
          { id: 'm1', role: 'user', created: '2026-10-29T00:00:00Z', text: 'Hi' },
          {
            id: 'm2',
            role: 'agent',
            created: '2026-10-29T00:00:01Z',
            status: 'running',
            agent: 'assistant',
            turn: 1,
            parts: [],
            actions: [],
          },
        ],
      });

      const desktop = wedyan();
      await until(() => desktop.data.ready);

      expect(last(desktop.data)).toMatchObject({ role: 'agent', status: 'stopped', reason: 'Interrupted' });
      desktop.close();
    });
  });

  it('moves older messages to a numbered page once the page outgrows its size, keeping the recent turns', async () => {
    setupConversation({ pageBytes: 1500 });
    mockVendor(...Array.from({ length: 8 }, (_, i) => says(`Answer number ${i}, ${'with some words '.repeat(4)}`)));
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = wedyan();
      await until(() => desktop.data.ready);
      for (let i = 0; i < 8; i += 1) {
        await desktop.ask('send', { text: `Question ${i}` });
        await until(() => desktop.data.messages.at(-2)?.role === 'user' && answered(desktop.data));
        await until(() => false, 30).catch(() => undefined);
      }

      expect(desktop.data.page).toBeGreaterThan(0);
      expect(desktop.data.messages.length).toBeLessThanOrEqual(RECENT_TURNS * 2 + 2);
      const oldest = await desktop.ask('page', 1);
      expect(oldest?.[0]).toMatchObject({ role: 'user', text: 'Question 0' });
      const kept = (await read(pagePath(), { encoding: 'json' })) as Conversation;
      expect(kept.page).toBe(desktop.data.page);
      desktop.close();
    });
  });
});
