import { AIAdapter } from '@irpclib/ai-kit/worker';
import { createContextStore, IRPCRouter, SESSION_STORE, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { transport as fileTransport } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { beforeAll, describe, expect, it } from 'vitest';
import { BRIEFER, COMPOSER, createAgents, DEFAULT_MODELS, ENTRY } from '../../lib/agents/index.js';
import { SKILLS } from '../../lib/agents/skills.js';
import type { WidgetPart } from '../../lib/kernel/agent.h.js';
import { setupKernel } from '../../lib/kernel/agent.js';
import { type AgentMessage, conversation } from '../../lib/kernel/chat.h.js';
import { setupConversation } from '../../lib/kernel/chat.js';
import { withModels } from '../../lib/server/setup.js';
import { PROVIDERS } from './beat.js';

/*
 * A conversation over several turns, on real models, the desktop only a client: a form is settled
 * with facts the model never saw, another is left waiting, and later turns ask about both. What's
 * printed is the transcript, to read; what's asserted is what must hold.
 */

const SESSION = 'turns-live-session';

/** The facts the first form settles with: nothing in the words gives them away. */
const SETTLED = { title: 'Trailer review', date: '2026-11-01', time: '10:00', location: 'Room 2', id: 'evt_9' };

beforeAll(async () => {
  const env = await resolveBinding<{ BUCKET: never; DB: never }>(undefined, { remoteBindings: false });
  implement({ bucket: env.BUCKET, indexer: env.DB });
  SESSION_STORE.key(SESSION);
});

describe.skipIf(!PROVIDERS.meta.key)('several turns, on data, live', () => {
  it('keeps a settled form as a fact, and an unsettled one as waiting', { timeout: 300_000 }, async () => {
    const adapter = withModels(new AIAdapter(), { meta: PROVIDERS.meta.key });
    setupKernel({
      adapter,
      agents: createAgents(DEFAULT_MODELS),
      entry: ENTRY,
      composer: COMPOSER,
      skills: SKILLS,
      routers: [new IRPCRouter(fileTransport)],
      sys: {},
    });
    setupConversation({ briefer: BRIEFER });

    const user = `u-${crypto.randomUUID().slice(0, 8)}`;
    await withContext(createContextStore([[SESSION, crypto.randomUUID()]]), async () => {
      fsContext.set({ ownerId: user, homeDir: `/users/${user}` });
      const chat = conversation('turns-tab');
      for (const name of ['app.open', 'desktop.tile', 'desktop.focus']) chat.answer(name, () => undefined);
      chat.answer('ask_user', () => ({ time: '10:00', title: 'Trailer review', choice: 'confirm' }));
      while (!chat.data.ready) await new Promise((resolve) => setTimeout(resolve, 50));

      const transcript = ['\n=== several turns'];
      const answers = () => chat.data.messages.filter((message): message is AgentMessage => message.role === 'agent');

      /** One turn: the words, and the answer they got. */
      const turn = async (text: string): Promise<string> => {
        const started = Date.now();
        const before = answers().length;
        await chat.ask('send', { text, context: { time: '2026-10-31T09:00:00+07:00' } });
        while (
          (answers().length === before || answers().some(({ status }) => ['idle', 'running'].includes(status))) &&
          Date.now() - started < 60_000
        ) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const message = answers().at(-1) as AgentMessage;
        const said = message.parts
          .map((part) => (part.type === 'text' ? (part.text ?? part.chunks.join('')) : `[widget: ${part.intent}]`))
          .join(' ');
        const took = ((Date.now() - started) / 1000).toFixed(1);
        transcript.push(`\nuser: ${text}`, `${message.agent} (${message.status}, ${took} s): ${said}`);
        process.stdout.write(`${transcript.splice(0).join('\n')}\n`);
        return said;
      };

      /** The form the latest answer showed. */
      const shownForm = () =>
        answers()
          .at(-1)
          ?.parts.find((part): part is WidgetPart => part.type === 'widget');

      await turn('Show me a card saying “Trailer review, tomorrow”. Just the card, no need to look anything up.');
      const first = shownForm();
      transcript.push(`(form shown: ${first?.status ?? 'none'})`);
      expect(first).toBeTruthy();

      expect(await chat.ask('ack', first?.id as string, SETTLED)).toBe(true);
      transcript.push(`(acked: ${JSON.stringify(SETTLED)})`);

      const where = await turn('Where is that meeting?');
      const id = await turn('What’s its event id?');

      await turn('Now show me a card saying “Budget sync, Friday” too. Just the card.');
      const second = shownForm();
      transcript.push(`(card shown: ${second?.status ?? 'none'}, not settled)`);

      const settled = await turn('Which of those two is settled, and which isn’t?');
      const when = await turn('Remind me when the trailer one is.');

      expect(await chat.ask('ack', first?.id as string, { title: 'Changed' })).toBe(false);

      process.stdout.write(`${transcript.join('\n')}\n`);
      chat.close();

      expect(where).toMatch(/Room 2/i);
      expect(id).toMatch(/evt_9/);
      expect(settled).toMatch(/trailer/i);
      expect(when).toMatch(/10(:00)?/);
    });
  });
});
