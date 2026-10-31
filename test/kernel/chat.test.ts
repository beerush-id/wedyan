import { createContextStore, SESSION_STORE, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { exists, read, write } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetPart } from '../../lib/kernel/agent.h.js';
import { setupKernel } from '../../lib/kernel/agent.js';
import { type AgentMessage, ASK_REPLY, type Conversation, conversation } from '../../lib/kernel/chat.h.js';
import {
  CONVERSATION_DEFAULTS,
  CONVERSATION_PATH,
  JUDGE_PROMPT,
  pagePath,
  setupConversation,
} from '../../lib/kernel/chat.js';
import { PROFILE_PATH } from '../../lib/share/profile.js';
import { AGENTS, createTestAdapter } from './fixtures.js';
import { messagesOf, mockVendorAside, says } from './vendor.js';

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

/** What the router was shown of the conversation with the user's words, each answer by id. */
type Asked = {
  running: Array<{ id: string; agent: string; line: string; goal?: string }>;
  unacknowledged: Array<{ id: string; line: string; latest?: true }>;
};
type Judge = (body: Record<string, unknown>) => Response;

/**
 * The router's judgment of the user's words, picked from what it was shown; nothing continued,
 * acknowledged or unclear unless picked.
 */
const judged =
  (
    pick: (asked: Asked) => {
      continues?: string;
      about?: string;
      acks?: string[];
      unclear?: string[];
      missed?: string[];
      later?: string[];
    } = () => ({}),
  ): Judge =>
  (body) => {
    const asked = (body.messages as Array<{ role: string; content?: string }>)
      .filter((message) => message.role !== 'system')
      .map((message) => message.content ?? '')
      .join('');
    const picked = pick(JSON.parse(asked.slice(asked.indexOf('{'))) as Asked);
    return says(JSON.stringify({ continues: null, acks: [], unclear: [], missed: [], ...picked }));
  };

/** The router's judgment that the words continue the running answer at this index, or are a new request. */
const routesTo = (to: number | 'new') => judged((asked) => (to === 'new' ? {} : { continues: asked.running[to].id }));

/**
 * The model provider for these tests: the router's judgments of the user's words come from
 * `judgments` in order (nothing continued or acknowledged once they run out) and are kept aside,
 * every other turn from `turns`.
 */
function chatVendor(judgments: Judge[], ...turns: Array<Response | Judge>) {
  const isJudgment = (body: Record<string, unknown>) =>
    (body.messages as Array<{ content?: string }>).some((message) => message.content?.includes(JUDGE_PROMPT));
  return mockVendorAside({ match: isJudgment, answer: (body) => (judgments.shift() ?? judged())(body) }, ...turns);
}

/** A model reply that only starts arriving after `ms`, for what must happen while it is pending. */
const later = (response: Response, ms: number) => () =>
  new Response(
    new ReadableStream({
      async start(controller) {
        await new Promise((resolve) => setTimeout(resolve, ms));
        const reader = response.body!.getReader();
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) controller.enqueue(chunk.value);
        controller.close();
      },
    }),
    { headers: response.headers },
  );

/** The context the answer at this turn was asked with. */
const contextOf = (bodies: Record<string, unknown>[], index: number) => {
  const asked = messagesOf(bodies, index).find((message) => message.content?.includes('"context"'));
  return asked && (JSON.parse(asked.content!) as { context: Record<string, unknown> }).context;
};

const last = (conversation: Conversation) => conversation.messages.at(-1);
const isRunning = (message: AgentMessage) => message.status === 'running' || message.status === 'idle';
const answered = (conversation: Conversation) => {
  const message = last(conversation);
  return message?.role === 'agent' && !isRunning(message);
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
    chatVendor([], says('[[say]]Hello, ', 'Nanang.[[/say]]'));
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
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
    chatVendor([], says('Hello.'));
    const who = newUser();
    // Another user's desktop, open in its own session until the check is done.
    let elsewhere: ReturnType<typeof conversation> | undefined;
    let done!: () => void;
    const checked = new Promise<void>((resolve) => {
      done = resolve;
    });
    const otherDesktop = asDesktop(newUser(), async () => {
      elsewhere = conversation('tab-a');
      await checked;
      elsewhere.close();
    });

    await asDesktop(who, async () => {
      const first = conversation('tab-a');
      const second = conversation('tab-b');
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
    chatVendor([], says('Here is your briefing.'));
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
      await until(() => desktop.data.ready);
      await desktop.ask('send', { text: 'Brief me' });
      desktop.close();
    });

    await asDesktop(who, async () => {
      await until(() => false, 300).catch(() => undefined);
      const next = conversation('tab-b');
      await until(() => next.data.ready);

      expect(next.data.messages).toMatchObject([
        { role: 'user', text: 'Brief me' },
        { role: 'agent', status: 'done', parts: [{ type: 'text', text: 'Here is your briefing.' }] },
      ]);
      next.close();
    });
  });

  it('gives the agents the last turns as lines, never their tool results or widget nodes', async () => {
    const vendor = chatVendor(
      [],
      says('[[say]]Opening Motion.[[/say]][[action name=app.open]]{"app":"motion"}[[/action]]'),
      says('[[widget]]A card titled Today[[/widget]]'),
      says('{"role":"card","props":{"title":"Today"}}'),
      says('Done.'),
    );
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
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

  it('settles a widget once, for every desktop, and the agents read it as a fact', async () => {
    const vendor = chatVendor(
      [],
      says('[[widget]]A meeting form[[/widget]]'),
      says('{"role":"card","props":{"title":"New meeting"}}'),
      says('Done.'),
    );
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
      const other = conversation('tab-b');
      await until(() => desktop.data.ready && other.data.ready);
      await desktop.ask('send', { text: 'Book a meeting' });
      await until(() => desktop.data.messages.length === 2 && answered(desktop.data));

      const { id } = (last(desktop.data) as AgentMessage).parts[0] as WidgetPart;
      expect(await desktop.ask('ack', id, { title: 'Trailer review' })).toBe(true);
      expect(await desktop.ask('ack', id, { title: 'Something else' })).toBe(false);
      expect(await desktop.ask('ack', 'no-such-widget', {})).toBe(false);

      await until(() => (other.data.messages[1] as AgentMessage).parts[0]?.type === 'widget');
      await until(() => !!((other.data.messages[1] as AgentMessage).parts[0] as WidgetPart).settled);
      expect((other.data.messages[1] as AgentMessage).parts[0]).toMatchObject({ form: { title: 'Trailer review' } });

      await desktop.ask('send', { text: 'Is it booked?' });
      await until(() => desktop.data.messages.length === 4 && answered(desktop.data));
      const asked = messagesOf(vendor.bodies, vendor.bodies.length - 1);
      expect(asked.find((message) => message.content?.includes('conversation'))?.content).toContain(
        'showed: A meeting form (done: {\\"title\\":\\"Trailer review\\"})',
      );
      desktop.close();
      other.close();
    });
  });

  it('saves a conversation only into its own home, even for a caller from another', async () => {
    chatVendor([], says('Done.'));
    const owner = newUser();
    const stray = { ...newUser(), session: owner.session };

    await asDesktop(stray, () => write('~/Desktop.chat', { messages: [{ text: 'what they had' }] } as never));

    await asDesktop(owner, async () => {
      const desktop = conversation('tab-a');
      await until(() => desktop.data.ready);

      await asDesktop(stray, async () => {
        const other = conversation('tab-b');
        await until(() => other.data.ready);
        await other.ask('send', { text: 'From the wrong home' });
        await until(() => other.data.messages.length === 2 && answered(other.data));
        other.close();
      });
      await until(() => answered(desktop.data));
      desktop.close();
    });

    const kept = async (who: typeof owner) =>
      asDesktop(who, () => read<{ messages: { text?: string }[] }>('~/Desktop.chat', { encoding: 'json' }));
    expect((await kept(stray))?.messages).toEqual([{ text: 'what they had' }]);
    await until(() => true);
    expect((await kept(owner))?.messages[0]).toMatchObject({ text: 'From the wrong home' });
  });

  it('puts a form in the answer, ready to fill in with what sends it, and replies with what comes back', async () => {
    const vendor = chatVendor(
      [],
      says('[[say]]Which time?[[/say]][[ask_user]]A text input named "time".[[/ask_user]]'),
      says('{"role":"text-input"}'),
      says('Booked for ten.'),
    );
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
      const other = conversation('tab-b');
      await until(() => desktop.data.ready && other.data.ready);
      await desktop.ask('send', { text: 'Book it' });

      const form = () => (last(other.data) as AgentMessage).parts.find((part) => part.type === 'widget') as WidgetPart;
      await until(() => desktop.data.messages.length === 2 && !!form());
      expect(form()).toMatchObject({
        status: 'ready',
        intent: 'A text input named "time".',
        formAction: ASK_REPLY,
        once: true,
        form: {},
      });
      expect(form().nodes).toMatchObject([
        { role: 'card-body', children: [{ role: 'text-input' }] },
        { role: 'card-actions', children: [{ role: 'button', props: { type: 'submit' } }] },
      ]);

      // Any desktop of the session can answer it.
      expect(await other.ask('ack', form().id, { time: '10:00' })).toBe(true);
      await until(() => answered(desktop.data));

      expect(JSON.stringify(messagesOf(vendor.bodies, vendor.bodies.length - 1))).toContain('10:00');
      desktop.close();
      other.close();
    });
  });

  it('keeps what the user picked into their words', async () => {
    chatVendor([], says('Done.'));
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
      await until(() => desktop.data.ready);
      const selections = [{ type: 'file', value: '~/x.still', label: 'xyz' }];
      await desktop.ask('send', { text: 'generate from @xyz', selections });
      await until(() => desktop.data.messages.length === 2 && answered(desktop.data));

      expect(desktop.data.messages[0]).toMatchObject({ selections });
      desktop.close();
    });
  });

  it('runs actions on the desktop that sent the words, as the assistant, and records them', async () => {
    chatVendor([], says('[[action name=app.open]]{"app":"photos"}[[/action]]'));
    const who = newUser();

    await asDesktop(who, async () => {
      const sender = conversation('tab-a');
      const other = conversation('tab-b');
      const ranOn: string[] = [];
      const metas: unknown[] = [];
      sender.answer('app.open', (_args: unknown, meta: unknown) => {
        ranOn.push('sender');
        metas.push(meta);
      });
      other.answer('app.open', () => void ranOn.push('other'));
      await until(() => sender.data.ready && other.data.ready);

      await sender.ask('send', { text: 'Open Photos' });
      await until(() => answered(sender.data));

      expect(ranOn).toEqual(['sender']);
      expect(metas).toEqual([{ after: -1, actor: 'wedyan' }]);
      expect((last(sender.data) as AgentMessage).actions).toEqual([
        { name: 'app.open', args: { app: 'photos' }, after: -1, actor: 'wedyan', status: 'done' },
      ]);
      sender.close();
      other.close();
    });
  });

  it('joins words the router says continue a running answer to it, and stops an answer on stop', async () => {
    const vendor = chatVendor(
      [routesTo(0)],
      says('[[say]]Which one?[[/say]][[ask_user]]A choice named "pick" between a and b.[[/ask_user]]'),
      says('[{"role":"radio-group"}]'),
      says('[[ask_user]]A yes or no named "sure".[[/ask_user]]'),
      says('[{"role":"switch"}]'),
    );
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
      await until(() => desktop.data.ready);
      await desktop.ask('send', { text: 'Pick one for me' });
      // The follow-up is appended after the answer it joined, so the answer is the second message.
      const answer = () => desktop.data.messages[1] as AgentMessage | undefined;
      const forms = () => answer()?.parts.filter((part) => part.type === 'widget') ?? [];

      await until(() => forms().length === 1);
      await desktop.ask('send', { text: 'Make it b, and hurry' });
      await until(() => forms().length === 2);
      await desktop.ask('stop');
      await until(() => answer()?.status === 'stopped' && desktop.data.messages.length === 3);

      // Said rather than filled in, the words still answered the form.
      expect(forms()[0]).toMatchObject({ settled: expect.any(String), form: { said: 'Make it b, and hurry' } });

      expect(desktop.data.messages.map((message) => message.role)).toEqual(['user', 'agent', 'user']);
      expect(desktop.data.messages[2]).toMatchObject({ text: 'Make it b, and hurry', answer: answer()?.id });
      const followed = messagesOf(vendor.bodies, 2).some((message) => message.content === 'Make it b, and hurry');
      expect(followed).toBe(true);
      expect(answer()?.turn).toBe(2);
      desktop.close();
    });
  });

  it('answers a new request side by side with one still waiting, each tied to its own words', async () => {
    chatVendor(
      [routesTo('new')],
      says('[[say]]Remove the cat?[[/say]][[ask_user]]A yes or no named "sure".[[/ask_user]]'),
      says('[{"role":"switch"}]'),
      says('[[say]]Here is last week’s meeting transcript.[[/say]]'),
      says('[[say]]Removing the cat.[[/say]]'),
    );
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
      await until(() => desktop.data.ready);
      const answers = () =>
        desktop.data.messages.filter((message): message is AgentMessage => message.role === 'agent');
      const form = () => answers()[0]?.parts.find((part): part is WidgetPart => part.type === 'widget');

      await desktop.ask('send', { text: 'Remove the cat from my sofa photo' });
      await until(() => !!form());
      await desktop.ask('send', { text: 'Find me last week’s meeting transcript' });
      await until(() => answers()[1]?.status === 'done');

      // The cat is still waiting on the user while the transcript is answered.
      expect(answers()[0].status).toBe('running');
      expect(await desktop.ask('ack', form()?.id as string, { sure: true })).toBe(true);
      await until(() => answers()[0].status === 'done');

      const [cat, transcript] = desktop.data.messages.filter((message) => message.role === 'user');
      expect(answers()[0]).toMatchObject({
        to: cat.id,
        parts: [
          { text: 'Remove the cat?' },
          { type: 'widget', formAction: ASK_REPLY, form: { sure: true }, settled: expect.any(String) },
          { type: 'text', text: 'Removing the cat.' },
        ],
      });
      expect(answers()[1]).toMatchObject({
        to: transcript.id,
        parts: [{ text: 'Here is last week’s meeting transcript.' }],
      });
      expect(transcript).not.toHaveProperty('answer');
      desktop.close();
    });
  });

  it('stops only the answer it names', async () => {
    chatVendor(
      [routesTo('new')],
      says('[[ask_user]]A yes or no named "a".[[/ask_user]]'),
      says('[{"role":"switch"}]'),
      says('[[ask_user]]A yes or no named "b".[[/ask_user]]'),
      says('[{"role":"switch"}]'),
      says('Done with b.'),
    );
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
      await until(() => desktop.data.ready);
      const answers = () =>
        desktop.data.messages.filter((message): message is AgentMessage => message.role === 'agent');
      const formOf = (at: number) => answers()[at]?.parts.find((part): part is WidgetPart => part.type === 'widget');

      await desktop.ask('send', { text: 'First' });
      await until(() => !!formOf(0));
      await desktop.ask('send', { text: 'Second' });
      await until(() => !!formOf(1));

      await desktop.ask('stop', answers()[0].id);
      await desktop.ask('ack', formOf(1)?.id as string, { b: true });
      await until(() => answers().every((message) => message.status !== 'running'));

      expect(answers().map((message) => message.status)).toEqual(['stopped', 'done']);
      desktop.close();
    });
  });

  it('lets go of a document part an answer opened once the answer ends, on the desktop that granted it', async () => {
    chatVendor(
      [],
      says('[[ask_app name=doc.open]]{"path": "~/A.motion", "part": "clip", "id": "v3"}[[/ask_app]]'),
      says('Done.'),
    );
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
      const closes: unknown[] = [];
      desktop.answer('doc.open', () => ({ opened: { id: 'v3' } }));
      desktop.answer('doc.close', (args: unknown, meta: unknown) => void closes.push([args, meta]));
      await until(() => desktop.data.ready);

      await desktop.ask('send', { text: 'Fix the hero clip' });
      await until(() => answered(desktop.data) && closes.length === 1);

      expect(closes).toEqual([[{ path: '~/A.motion' }, { after: -1, actor: 'wedyan' }]]);
      desktop.close();
    });
  });

  it('refuses a second live connection with a client ID already connected, and takes it once free', async () => {
    const who = newUser();

    await asDesktop(who, async () => {
      const first = conversation('tab-a');
      await until(() => first.data.ready);

      await expect(conversation('tab-a')).rejects.toThrow('This client is already connected');
      first.close();
      await until(() => false, 50).catch(() => undefined);
      const again = conversation('tab-a');
      await until(() => again.data.ready);
      expect(again.status).toBe('pending');
      again.close();
    });
  });

  it('never runs an answer’s action on another desktop: it waits for the one that asked to come back', async () => {
    chatVendor([], later(says('[[action name=app.open]]{"app":"motion"}[[/action]]'), 150));
    const who = newUser();
    const ranOn: string[] = [];
    let done!: () => void;
    const checked = new Promise<void>((resolve) => {
      done = resolve;
    });
    // Another desktop of the session, open the whole time.
    const other = asDesktop(who, async () => {
      const desktop = conversation('tab-b');
      desktop.answer('app.open', () => void ranOn.push('tab-b'));
      await checked;
      desktop.close();
    });

    await asDesktop(who, async () => {
      const sender = conversation('tab-a');
      await until(() => sender.data.ready);
      await sender.ask('send', { text: 'Open Motion' });
      sender.close();
    });
    await until(() => false, 300).catch(() => undefined);
    expect(ranOn).toEqual([]);

    await asDesktop(who, async () => {
      const back = conversation('tab-a');
      back.answer('app.open', () => void ranOn.push('tab-a'));
      await until(() => answered(back.data));
      expect(ranOn).toEqual(['tab-a']);
      expect(last(back.data)).toMatchObject({ status: 'done', actions: [{ name: 'app.open' }] });
      back.close();
    });
    done();
    await other;
  });

  it('fails an action whose desktop doesn’t come back in time, tells the agent, and records it', async () => {
    setupConversation({ clientWait: 100 });
    const vendor = chatVendor(
      [],
      later(says('[[action name=app.open]]{"app":"motion"}[[/action]]'), 50),
      says('Okay.'),
    );
    const who = newUser();

    await asDesktop(who, async () => {
      const sender = conversation('tab-a');
      await until(() => sender.data.ready);
      await sender.ask('send', { text: 'Open Motion' });
      sender.close();
    });

    await asDesktop(who, async () => {
      await until(() => vendor.bodies.length === 2);
      expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
        role: 'user',
        content: JSON.stringify({
          feedback: {
            actions: [
              { action: 'app.open', args: { app: 'motion' }, error: 'The desktop that asked is no longer connected' },
            ],
          },
        }),
      });

      const next = conversation('tab-b');
      await until(() => next.data.ready && answered(next.data));
      expect((last(next.data) as AgentMessage).actions).toEqual([
        {
          name: 'app.open',
          args: { app: 'motion' },
          after: -1,
          actor: 'wedyan',
          status: 'failed',
          error: 'The desktop that asked is no longer connected',
        },
      ]);
      next.close();
    });
  });

  it('keeps the user’s words as soon as they are sent, before the answer ends', async () => {
    chatVendor([], later(says('Hello.'), 300));
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
      await until(() => desktop.data.ready);
      await desktop.ask('send', { text: 'Hi' });

      let kept: Conversation | undefined;
      await until(() => {
        void read(CONVERSATION_PATH, { encoding: 'json' }).then((page) => {
          kept = page as Conversation;
        });
        return kept?.messages[0]?.role === 'user';
      });
      expect(answered(desktop.data)).toBe(false);
      expect(kept?.messages[0]).toMatchObject({ role: 'user', text: 'Hi', client: 'tab-a' });
      await until(() => answered(desktop.data));
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

      const desktop = conversation('tab-a');
      await until(() => desktop.data.ready);

      expect(last(desktop.data)).toMatchObject({ role: 'agent', status: 'stopped', reason: 'Interrupted' });
      desktop.close();
    });
  });

  it('moves older messages to a numbered page once the page outgrows its size, keeping the recent turns', async () => {
    setupConversation({ pageBytes: 1500 });
    chatVendor([], ...Array.from({ length: 8 }, (_, i) => says(`Answer number ${i}, ${'with some words '.repeat(4)}`)));
    const who = newUser();

    await asDesktop(who, async () => {
      const desktop = conversation('tab-a');
      await until(() => desktop.data.ready);
      for (let i = 0; i < 8; i += 1) {
        await desktop.ask('send', { text: `Question ${i}` });
        await until(() => desktop.data.messages.at(-2)?.role === 'user' && answered(desktop.data));
        await until(() => false, 30).catch(() => undefined);
      }

      expect(desktop.data.page).toBeGreaterThan(0);
      expect(desktop.data.messages.length).toBeLessThanOrEqual(CONVERSATION_DEFAULTS.recentTurns * 2 + 2);
      const oldest = await desktop.ask('page', 1);
      expect(oldest?.[0]).toMatchObject({ role: 'user', text: 'Question 0' });
      // An answer is marked done before its page is saved: wait for the save to land.
      let kept = (await read(pagePath(), { encoding: 'json' })) as Conversation;
      for (let tries = 0; kept.page !== desktop.data.page && tries < 50; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        kept = (await read(pagePath(), { encoding: 'json' })) as Conversation;
      }
      expect(kept.page).toBe(desktop.data.page);
      desktop.close();
    });
  });

  describe('when the user comes back', () => {
    const TIME = '2026-10-29T13:00:00+07:00';
    /** What the briefing agent was given: its ask's context. */
    const briefed = (bodies: Record<string, unknown>[], index: number) => {
      const asked = messagesOf(bodies, index).find((message) => message.content?.includes('"event":"wake"'));
      return asked && (JSON.parse(asked.content!) as { context: Record<string, unknown> }).context;
    };
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    // How long the user must be away to be briefed: long enough that going idle and straight back,
    // two calls, never counts as away, even on a busy machine.
    const AWAY = 200;

    beforeEach(() => {
      // No demo arrivals unless a test brings its own.
      setupConversation({ briefAfter: AWAY, arrivalSeeds: {} });
    });

    it('delivers the demo’s arrivals once, when the user is first back from long enough away, dated, and briefs them', async () => {
      const vendor = chatVendor([], says('Welcome back, two things came in.'));
      setupConversation({
        briefAfter: AWAY,
        arrivalSeeds: {
          'Mail/m1.eml': 'From: Ana <ana@example.com>\nDate: Thu, 29 Oct 2026 06:40:00 +0700\nSubject: Shoot\n\nHi.\n',
          'Calendar/c1.ics': 'BEGIN:VEVENT\nDTSTART:20261029T030000Z\nDTEND:20261029T040000Z\nEND:VEVENT\n',
        },
      });
      const who = newUser();

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('presence', 'active');

        // A moment away isn't long enough: nothing lands yet, so nothing is missed.
        await desktop.ask('presence', 'idle');
        await desktop.ask('presence', 'active');
        await pause(100);
        expect(await exists('~/Mail/m1.eml')).toBe(false);
        expect(desktop.data.messages).toHaveLength(0);

        await desktop.ask('presence', 'idle');
        await pause(AWAY + 50);
        await desktop.ask('presence', 'active', { time: TIME });
        await until(() => desktop.data.messages.length === 1 && answered(desktop.data));
        const { arrived } = briefed(vendor.bodies, 0) as { arrived: Array<{ path: string }> };
        expect(arrived.map(({ path }) => path).sort()).toEqual(['~/Calendar/c1.ics', '~/Mail/m1.eml']);

        const today = new Date();
        expect(await read('~/Mail/m1.eml', { encoding: 'text' })).toContain(
          `Date: ${today.toUTCString().slice(0, 16)}`,
        );
        const invite = (await read('~/Calendar/c1.ics', { encoding: 'text' })) as string;
        const day = today.toISOString().slice(0, 10).replaceAll('-', '');
        expect(invite).toContain(`DTSTART:${day}T030000Z`);
        expect(invite).toContain(`DTEND:${day}T040000Z`);

        // Coming back again delivers nothing more: the user's own changes stay.
        await write('~/Mail/m1.eml', 'Read and filed.');
        await desktop.ask('presence', 'idle');
        await pause(AWAY + 50);
        await desktop.ask('presence', 'active');
        await pause(100);
        expect(await read('~/Mail/m1.eml', { encoding: 'text' })).toBe('Read and filed.');
        // Kept on the page, so a later room doesn't deliver them again either.
        expect(await read(CONVERSATION_PATH, { encoding: 'json' })).toHaveProperty('delivered');
        desktop.close();
      });
    });

    it('bundles the demo’s mail, invite and receipt as its arrivals', () => {
      expect(Object.keys(CONVERSATION_DEFAULTS.arrivalSeeds).sort()).toEqual([
        'Calendar/c1.ics',
        'Mail/m1.eml',
        'Mail/m2.eml',
        'Orders/o1.receipt',
      ]);
    });

    it('briefs after the user’s own briefAfter, over the server’s', async () => {
      setupConversation({});
      chatVendor([], says('Rendering it.'), says('Welcome back.'));
      const who = newUser();

      await asDesktop(who, async () => {
        await write(PROFILE_PATH, { userName: 'Nanang', briefAfter: 0 } as never);
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('presence', 'active');
        await desktop.ask('send', { text: 'Render it' });
        await until(() => answered(desktop.data));
        await desktop.ask('presence', 'idle');
        await desktop.ask('presence', 'active', { time: TIME });
        await until(() => desktop.data.messages.length === 3 && answered(desktop.data));

        expect(last(desktop.data)).toMatchObject({ event: 'wake', status: 'done' });
        desktop.close();
      });
    });

    /**
     * Leaves two answers unacknowledged: the render, slow, and the mail, asked while it runs and so
     * the latest. Their model turns come first.
     */
    const twoAnswers = async (desktop: ReturnType<typeof conversation>) => {
      await desktop.ask('send', { text: 'Render it' });
      await until(() => desktop.data.messages.length === 2);
      await desktop.ask('send', { text: 'Any mail?' });
      await until(
        () =>
          desktop.data.messages.length === 4 &&
          desktop.data.messages.every((message) => message.role === 'user' || !isRunning(message)),
      );
    };
    const twoTurns = () => [later(says('The render is queued.'), 300), says('Ana mailed you.')];
    const older = (asked: Asked) => asked.unacknowledged.find((answer) => !answer.latest)!.id;
    const latest = (asked: Asked) => asked.unacknowledged.find((answer) => answer.latest)!.id;

    it('takes any words as acknowledging the answer just before them, without asking the router', async () => {
      const vendor = chatVendor([], says('Hello.'), says('Hi.'));
      const who = newUser();

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('send', { text: 'Hi' });
        await until(() => answered(desktop.data));
        await desktop.ask('send', { text: 'Make it shorter' });
        await until(() => desktop.data.messages.length === 4 && answered(desktop.data));

        expect((desktop.data.messages[1] as AgentMessage).acked).toBeDefined();
        expect(vendor.asides).toHaveLength(0);
        desktop.close();
      });
    });

    it('asks the router about older answers, and the assistant about unclear ones', async () => {
      const vendor = chatVendor(
        [routesTo('new'), judged((asked) => ({ unclear: [older(asked)] }))],
        ...twoTurns(),
        says('Including the render?'),
      );
      const who = newUser();

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await twoAnswers(desktop);
        await desktop.ask('send', { text: 'Copy that', context: { time: TIME } });
        await until(() => desktop.data.messages.length === 6 && answered(desktop.data));

        const [, render, , mail] = desktop.data.messages as AgentMessage[];
        expect(mail.acked).toBeDefined();
        expect(render.acked).toBeUndefined();
        expect(contextOf(vendor.bodies, 2)).toEqual({ time: TIME, unclear: ['wedyan: said "The render is queued."'] });
        desktop.close();
      });
    });

    it('leaves the latest answer unacknowledged when the words show the user missed it', async () => {
      chatVendor(
        [routesTo('new'), judged((asked) => ({ acks: [older(asked)], missed: [latest(asked)] }))],
        ...twoTurns(),
        says('I said Ana mailed you.'),
      );
      const who = newUser();

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await twoAnswers(desktop);
        await desktop.ask('send', { text: 'What did you say?' });
        await until(() => desktop.data.messages.length === 6 && answered(desktop.data));

        const [, render, , mail] = desktop.data.messages as AgentMessage[];
        expect(render.acked).toBeDefined();
        expect(mail.acked).toBeUndefined();
        desktop.close();
      });
    });

    it('puts off what the user leaves for later, and brings it back in the next briefing', async () => {
      const vendor = chatVendor(
        [routesTo('new'), judged((asked) => ({ later: [older(asked)] }))],
        ...twoTurns(),
        says('See you later.'),
        says('Welcome back, your render is still waiting.'),
      );
      const who = newUser();

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('presence', 'active');
        await twoAnswers(desktop);
        await desktop.ask('send', { text: 'I need to go, will watch it later' });
        await until(() => desktop.data.messages.length === 6 && answered(desktop.data));

        const [, render, , mail] = desktop.data.messages as AgentMessage[];
        expect(render.deferred).toBeDefined();
        expect(render.acked).toBeUndefined();
        expect(mail.acked).toBeDefined();

        await desktop.ask('presence', 'idle');
        await pause(AWAY + 50);
        await desktop.ask('presence', 'active', { time: TIME });
        await until(() => desktop.data.messages.length === 7 && answered(desktop.data));

        const { later: putOff, unseen } = briefed(vendor.bodies, 3) as { later: string[]; unseen: string[] };
        expect(putOff).toEqual(['wedyan: said "The render is queued."']);
        expect(unseen).not.toContain('wedyan: said "The render is queued."');
        expect(render.briefed).toBeDefined();
        desktop.close();
      });
    });

    it('tells the user a background job ended, on the desktop that ran it, by the briefer without the router', async () => {
      setupConversation({ briefAfter: AWAY, arrivalSeeds: {}, briefer: 'photos' });
      const vendor = chatVendor([], says('Your render is done, let me know if you want to play it.'));
      const who = newUser();
      const job = { title: 'the Wedyan promo render', path: '~/Motions/Wedyan promo/Renders/promo.mp4' };

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('finished', job);
        await until(() => desktop.data.messages.length === 1 && answered(desktop.data));

        expect(last(desktop.data)).toMatchObject({ event: 'job', status: 'done', agent: 'photos' });
        expect(vendor.bodies[0].model).toBe('photos-m');
        expect(contextOf(vendor.bodies, 0)).toEqual({ event: 'job', job });
        desktop.close();
      });
    });

    it('tells the briefing what is still at work, apart from what waits on the user', async () => {
      const vendor = chatVendor([], later(says('Episode 12 of 30 is scripted.'), 1000), says('Welcome back.'));
      const who = newUser();

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('presence', 'active');
        await desktop.ask('send', { text: 'Script all 30 episodes' });
        await until(() => desktop.data.messages.length === 2);

        await desktop.ask('presence', 'idle');
        await pause(AWAY + 50);
        await desktop.ask('presence', 'active', { time: TIME });
        await until(() => desktop.data.messages.length === 3 && answered(desktop.data));

        const { working, waiting } = briefed(vendor.bodies, 1) as { working: string[]; waiting: string[] };
        expect(working).toHaveLength(1);
        expect(waiting).toEqual([]);
        desktop.close();
      });
    });

    it('leaves unclear answers be when the user would rather it weren’t proactive', async () => {
      const vendor = chatVendor(
        [routesTo('new'), judged((asked) => ({ unclear: [older(asked)] }))],
        ...twoTurns(),
        says('Okay.'),
      );
      const who = newUser();

      await asDesktop(who, async () => {
        await write(PROFILE_PATH, { userName: 'Nanang', proactive: false } as never);
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await twoAnswers(desktop);
        await desktop.ask('send', { text: 'Copy that', context: { time: TIME } });
        await until(() => desktop.data.messages.length === 6 && answered(desktop.data));

        expect(contextOf(vendor.bodies, 2)).toEqual({ time: TIME });
        desktop.close();
      });
    });

    it('briefs the user on the desktop in use again, once every desktop was away long enough', async () => {
      const vendor = chatVendor(
        [],
        says('Rendering it.'),
        says('[[say]]Welcome back, the render is done.[[/say]][[action name=app.open]]{"app":"motion"}[[/action]]'),
      );
      const who = newUser();

      await asDesktop(who, async () => {
        const first = conversation('tab-a');
        const second = conversation('tab-b');
        const ranOn: string[] = [];
        first.answer('app.open', () => void ranOn.push('first'));
        second.answer('app.open', () => void ranOn.push('second'));
        await until(() => first.data.ready && second.data.ready);
        await first.ask('presence', 'active');
        await second.ask('presence', 'active');
        await first.ask('send', { text: 'Render the short drama' });
        await until(() => answered(first.data));

        // One desktop idle is not away, while the other is in use.
        await first.ask('presence', 'idle');
        expect(first.data.away).toBeUndefined();
        await second.ask('presence', 'idle');
        expect(first.data.away).toBeDefined();
        await pause(AWAY + 50);
        await second.ask('presence', 'active', { time: TIME });
        await until(() => first.data.messages.length === 3 && answered(first.data));

        const briefing = last(first.data) as AgentMessage;
        expect(briefing).toMatchObject({ role: 'agent', event: 'wake', status: 'done' });
        expect(briefing.to).toBeUndefined();
        expect(ranOn).toEqual(['second']);
        expect(first.data.away).toBeUndefined();
        expect(briefed(vendor.bodies, 1)).toEqual({
          time: TIME,
          event: 'wake',
          awayMinutes: 0,
          arrived: [],
          unseen: ['user: Render the short drama', 'wedyan: said "Rendering it."'],
          later: [],
          waiting: [],
          working: [],
          progress: [],
        });
        first.close();
        second.close();
      });
    });

    it('briefs on what landed in the inboxes while the user was away, and not what was there before', async () => {
      const vendor = chatVendor([], says('Welcome back.'));
      const who = newUser();

      await asDesktop(who, async () => {
        await write('~/Mail/before.mail', { from: 'Rudi', subject: 'Old news' } as never);
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('presence', 'active');
        await desktop.ask('presence', 'idle');
        // Past the second the user went away in, however finely the index keeps times.
        await pause(1100);
        await write('~/Mail/m1.mail', { from: 'Ana', subject: 'Notes on the shoot schedule' } as never);
        await pause(20);
        await write('~/Orders/o1.receipt', { item: 'Lavalier mic', status: 'Delivered' } as never);
        await desktop.ask('presence', 'active', { time: TIME });
        await until(() => desktop.data.messages.length === 1 && answered(desktop.data));

        expect(last(desktop.data)).toMatchObject({ event: 'wake', status: 'done' });
        const { arrived } = briefed(vendor.bodies, 0) as { arrived: Array<{ path: string; name: string }> };
        expect(arrived.map(({ path, name }) => ({ path, name }))).toEqual([
          { path: '~/Orders/o1.receipt', name: 'o1.receipt' },
          { path: '~/Mail/m1.mail', name: 'm1.mail' },
        ]);
        desktop.close();
      });
    });

    it('briefs each unacknowledged answer once, and not when the user wasn’t away long enough', async () => {
      chatVendor([], says('Hello.'), says('Welcome back.'));
      const who = newUser();

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('presence', 'active');
        await desktop.ask('send', { text: 'Hi' });
        await until(() => answered(desktop.data));

        await desktop.ask('presence', 'idle');
        await desktop.ask('presence', 'active');
        await pause(100);
        expect(desktop.data.messages).toHaveLength(2);

        await desktop.ask('presence', 'idle');
        await pause(AWAY + 50);
        await desktop.ask('presence', 'active');
        await until(() => desktop.data.messages.length === 3 && answered(desktop.data));
        expect((desktop.data.messages[1] as AgentMessage).briefed).toBeDefined();

        // Neither the answer told of nor the briefing is told of again.
        await desktop.ask('presence', 'idle');
        await pause(AWAY + 50);
        await desktop.ask('presence', 'active');
        await pause(150);
        expect(desktop.data.messages).toHaveLength(3);
        desktop.close();
      });
    });

    it('counts every desktop closed as away, and remembers it for the next desktop', async () => {
      const vendor = chatVendor([], says('Rendering it.'), says('Welcome back.'));
      const who = newUser();

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('presence', 'active');
        await desktop.ask('send', { text: 'Render it' });
        await until(() => answered(desktop.data));
        desktop.close();
      });

      await asDesktop(who, async () => {
        await pause(AWAY + 50);
        const next = conversation('tab-b');
        await until(() => next.data.ready);
        expect(next.data.away).toBeDefined();
        await next.ask('presence', 'active', { time: TIME });
        await until(() => next.data.messages.length === 3 && answered(next.data));

        expect(last(next.data)).toMatchObject({ event: 'wake', status: 'done' });
        expect(briefed(vendor.bodies, 1)).toMatchObject({
          unseen: ['user: Render it', 'wedyan: said "Rendering it."'],
        });
        next.close();
      });
    });
  });

  describe('when work is handed to experts', () => {
    const DIRECTOR = '~/Agents/Director.agent';
    const CASTING = '~/Agents/Casting.agent';
    const episode = (n: number) => ({ path: `~/Motions/Lantern/Episode ${n}.stage` });

    /** The assistant's answer handing out these tasks of one batch, each as its own action. */
    const handsOut = (...tasks: Array<{ agent: string; goal: string; object: { path: string } }>) =>
      says(
        `[[say]]On it.[[/say]]${tasks
          .map((task) => `[[action name=work.assign]]${JSON.stringify({ title: 'Lantern River', ...task })}[[/action]]`)
          .join('')}`,
      );

    beforeEach(() => {
      setupKernel({
        adapter: createTestAdapter(),
        agents: {
          ...AGENTS,
          [DIRECTOR]: { name: DIRECTOR, model: 'director-m', system: 'Direct.', tools: [] },
          [CASTING]: { name: CASTING, model: 'casting-m', system: 'Cast.', tools: [] },
        },
        entry: 'assistant',
        composer: 'composer',
      });
    });

    /** A desktop of a new user who has the two experts. */
    const withExperts = async (who: ReturnType<typeof newUser>) =>
      asDesktop(who, async () => {
        await write(DIRECTOR, { name: 'Director' } as never);
        await write(CASTING, { name: 'Casting' } as never);
      });

    const taskAnswers = (conversation: Conversation) =>
      conversation.messages.filter(
        (message): message is AgentMessage => message.role === 'agent' && message.event === 'work',
      );

    it('runs an expert’s tasks one at a time, in order, each on its own, and says when the batch is done', async () => {
      const vendor = chatVendor(
        [],
        handsOut(
          { agent: DIRECTOR, goal: 'Write episode 1', object: episode(1) },
          { agent: DIRECTOR, goal: 'Write episode 2', object: episode(2) },
        ),
        later(says('Episode 1 is written.'), 300),
        says('Episode 2 is written.'),
        says('The Lantern River episodes are done.'),
      );
      const who = newUser();
      await withExperts(who);

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('send', { text: 'Write the first two episodes' });

        // The second waits behind the first: one expert, one task at a time.
        await until(() => desktop.data.work?.length === 2);
        expect(desktop.data.work?.map((task) => task.status)).toEqual(['running', 'queued']);

        await until(() => last(desktop.data)?.role === 'agent' && (last(desktop.data) as AgentMessage).event === 'job');
        await until(() => answered(desktop.data));
        expect(desktop.data.work?.map((task) => task.status)).toEqual(['done', 'done']);

        const [first, second] = taskAnswers(desktop.data);
        expect(first).toMatchObject({ task: desktop.data.work?.[0].id, agent: DIRECTOR, status: 'done' });
        expect(second).toMatchObject({ task: desktop.data.work?.[1].id, status: 'done' });
        // Each starts at the expert, with its goal and its object, and none of the conversation.
        expect(vendor.bodies[1].model).toBe('director-m');
        expect(messagesOf(vendor.bodies, 1).filter((message) => message.role === 'user')).toEqual([
          { role: 'user', content: JSON.stringify({ context: { event: 'work', object: episode(1) } }) },
          { role: 'user', content: 'Write episode 1' },
        ]);
        expect(contextOf(vendor.bodies, 3)).toEqual({ event: 'job', job: { title: 'Lantern River' } });

        // Kept on the page, for a room that comes after.
        const kept = (await read(CONVERSATION_PATH, { encoding: 'json' })) as Conversation;
        expect(kept.work?.map((task) => task.status)).toEqual(['done', 'done']);
        desktop.close();
      });
    });

    it('lets two experts work at once, but never two on one object', async () => {
      chatVendor(
        [],
        handsOut(
          { agent: DIRECTOR, goal: 'Write episode 1', object: episode(1) },
          { agent: CASTING, goal: 'Cast episode 1', object: episode(1) },
          { agent: CASTING, goal: 'Cast episode 2', object: episode(2) },
        ),
        later(says('Episode 1 is written.'), 400),
        says('Episode 1 is cast.'),
        says('Episode 2 is cast.'),
        says('Done.'),
      );
      const who = newUser();
      await withExperts(who);

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('send', { text: 'Write and cast the first two episodes' });

        await until(() => desktop.data.work?.length === 3 && desktop.data.work[0].status === 'running');
        // Casting is free, but its first task's object is the Director's for now, and its tasks keep their order.
        expect(desktop.data.work.map((task) => task.status)).toEqual(['running', 'queued', 'queued']);

        await until(() => desktop.data.work?.every((task) => task.status === 'done') === true);
        desktop.close();
      });
    });

    it('refuses work for an expert the user doesn’t have', async () => {
      const vendor = chatVendor(
        [],
        handsOut({ agent: '~/Agents/Nobody.agent', goal: 'Write episode 1', object: episode(1) }),
        says('There’s no such expert.'),
      );
      const who = newUser();
      await withExperts(who);

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('send', { text: 'Write episode 1' });
        await until(() => vendor.bodies.length === 2 && answered(desktop.data));

        expect(desktop.data.work ?? []).toEqual([]);
        expect((last(desktop.data) as AgentMessage).actions[0]).toMatchObject({
          name: 'work.assign',
          status: 'failed',
        });
        expect(JSON.stringify(vendor.bodies[1])).toContain('No expert at ~/Agents/Nobody.agent');
        desktop.close();
      });
    });

    it('lets a task hand work only to its own expert, for what it means to do next', async () => {
      const assignment = (agent: string, goal: string) =>
        `[[action name=work.assign]]${JSON.stringify({ title: 'Trailer', agent, goal, object: { path: '~/Motions/Lantern/Trailer.stage' } })}[[/action]]`;
      const vendor = chatVendor(
        [],
        handsOut({ agent: DIRECTOR, goal: 'Write episode 1', object: episode(1) }),
        says(`Writing it.${assignment(CASTING, 'Cast the trailer')}`),
        says(`I'll write the trailer next.${assignment(DIRECTOR, 'Write the trailer')}`),
        says('Done.'),
        says('Done.'),
        says('Done.'),
      );
      const who = newUser();
      await withExperts(who);

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('send', { text: 'Write episode 1' });
        await until(() => desktop.data.work?.length === 2 && desktop.data.work.every((task) => task.status === 'done'));

        expect(desktop.data.work?.map((task) => [task.agent, task.goal])).toEqual([
          [DIRECTOR, 'Write episode 1'],
          [DIRECTOR, 'Write the trailer'],
        ]);
        const [task] = taskAnswers(desktop.data);
        expect(task.actions.map((action) => action.status)).toEqual(['failed', 'done']);
        expect(JSON.stringify(vendor.bodies[2])).toContain('A task hands work only to its own expert');
        desktop.close();
      });
    });

    it('answers a question about work under way at once, from the expert at it, without stopping it', async () => {
      const vendor = chatVendor(
        [judged((asked) => ({ about: asked.running[0].id }))],
        handsOut({ agent: DIRECTOR, goal: 'Write episode 1', object: episode(1) }),
        later(says('Episode 1 is written.'), 1000),
        says('Halfway through episode 1.'),
        says('Done.'),
      );
      const who = newUser();
      await withExperts(who);

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('send', { text: 'Write episode 1' });
        await until(() => desktop.data.work?.[0]?.status === 'running');

        await desktop.ask('send', { text: 'How far are you?' });
        await until(() => vendor.bodies.length >= 3);

        // Told by the Director, from what it's doing, while the task is still at work.
        expect(vendor.bodies[2].model).toBe('director-m');
        expect(contextOf(vendor.bodies, 2)).toMatchObject({
          event: 'about',
          working: { agent: DIRECTOR, goal: 'Write episode 1' },
        });
        expect(desktop.data.work?.[0]?.status).toBe('running');
        const words = desktop.data.messages.find(
          (message) => message.role === 'user' && message.text === 'How far are you?',
        );
        expect(words).not.toHaveProperty('answer');

        await until(() => desktop.data.work?.[0]?.status === 'done');
        desktop.close();
      });
    });

    it('starts a task cut off when the conversation was last kept over, in the next room', async () => {
      chatVendor([], says('Episode 1 is written.'), says('Done.'));
      const who = newUser();
      await withExperts(who);

      await asDesktop(who, async () => {
        await write(CONVERSATION_PATH, {
          type: 'chat',
          version: 1,
          id: 'c1',
          name: 'Desktop',
          created: '2026-10-30T00:00:00.000Z',
          updated: '2026-10-30T00:00:00.000Z',
          author: { kind: 'agent' },
          page: 0,
          messages: [],
          work: [
            {
              id: 't1',
              title: 'Lantern River',
              agent: DIRECTOR,
              goal: 'Write episode 1',
              object: episode(1),
              status: 'running',
              by: 'a1',
              client: 'tab-a',
              created: '2026-10-30T00:00:00.000Z',
            },
          ],
        } as never);
        const desktop = conversation('tab-a');
        await until(() => desktop.data.work?.[0]?.status === 'done');
        expect(taskAnswers(desktop.data)).toHaveLength(1);
        desktop.close();
      });
    });

    it('tells the briefing how far each batch got, and leaves the tasks’ own answers out of what the user missed', async () => {
      const vendor = chatVendor(
        [],
        handsOut(
          { agent: DIRECTOR, goal: 'Write episode 1', object: episode(1) },
          { agent: DIRECTOR, goal: 'Write episode 2', object: episode(2) },
        ),
        says('Episode 1 is written.'),
        later(says('Episode 2 is written.'), 1000),
        says('Welcome back.'),
        says('Done.'),
      );
      const who = newUser();
      await withExperts(who);
      setupConversation({ briefAfter: 200, arrivalSeeds: {} });

      await asDesktop(who, async () => {
        const desktop = conversation('tab-a');
        await until(() => desktop.data.ready);
        await desktop.ask('presence', 'active');
        await desktop.ask('send', { text: 'Write the first two episodes' });
        await until(() => desktop.data.work?.[1]?.status === 'running');

        await desktop.ask('presence', 'idle');
        await new Promise((resolve) => setTimeout(resolve, 250));
        await desktop.ask('presence', 'active', { time: '2026-10-30T13:00:00+07:00' });
        await until(() => vendor.bodies.length >= 4);

        const briefing = contextOf(vendor.bodies, 3) as { progress: unknown[]; unseen: string[] };
        expect(briefing.progress).toEqual([
          { title: 'Lantern River', done: 1, failed: 0, total: 2, now: [`${DIRECTOR}: Write episode 2`] },
        ]);
        expect(briefing.unseen.some((line) => line.includes('Episode 1 is written'))).toBe(false);
        await until(() => desktop.data.work?.[1]?.status === 'done');
        desktop.close();
      });
    });
  });
});
