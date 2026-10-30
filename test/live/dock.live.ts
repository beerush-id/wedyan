import { writeFileSync } from 'node:fs';
import { AIAdapter } from '@irpclib/ai-kit/worker';
import type { IRPCData } from '@irpclib/irpc';
import { createContextStore, IRPCRouter, SESSION_STORE, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { transport as fileTransport, read, write } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { beforeAll, describe, expect, it } from 'vitest';
import { BRIEFER, COMPOSER, createAgents, DEFAULT_MODELS, ENTRY, OPEN_MODELS } from '../../lib/agents/index.js';
import { SKILLS } from '../../lib/agents/skills.js';
import type { StillDocument } from '../../lib/documents/types.js';
import { type SysHandler, setupKernel } from '../../lib/kernel/agent.js';
import { type AgentMessage, conversation } from '../../lib/kernel/chat.h.js';
import { setupConversation } from '../../lib/kernel/chat.js';
import { picturesOf, type ServerEnv, withModels } from '../../lib/server/setup.js';
import { setupStills } from '../../lib/server/stills.js';
import { addAttempts, applyRequest } from '../../lib/share/stills.js';
import { PROVIDERS } from './beat.js';

/*
 * A user with a still open asks the dock "make her angry": the conversation, the agents, the files
 * and the models for real, the desktop only a client of the conversation and the window only the
 * still it holds. Her still is made first, the same way. `DOCK_OUT` names a folder to copy both
 * pictures into, to look at.
 */

const SESSION = 'dock-live-session';

let env: ServerEnv;

beforeAll(async () => {
  env = await resolveBinding<ServerEnv>(undefined, { remoteBindings: false });
  implement({ bucket: env.BUCKET as never, indexer: env.DB as never });
  SESSION_STORE.key(SESSION);
});

describe.skipIf(!PROVIDERS.meta.key)('the dock, on data, live', () => {
  it('makes her angry, in the still the user has open', { timeout: 300_000 }, async () => {
    // The server's own models: Muse (Image included), Baseten when its key is set, the drive last.
    const adapter = withModels(new AIAdapter(), {
      meta: PROVIDERS.meta.key,
      baseten: PROVIDERS.baseten.key || undefined,
    });
    const made: IRPCData[] = [];
    const stills = setupStills(adapter, picturesOf(env));
    const watched: SysHandler = (args, ask) => {
      made.push(args);
      return stills(args, ask);
    };
    setupKernel({
      adapter,
      agents: createAgents(PROVIDERS.baseten.key ? OPEN_MODELS : DEFAULT_MODELS),
      entry: ENTRY,
      composer: COMPOSER,
      skills: SKILLS,
      routers: [new IRPCRouter(fileTransport)],
      sys: { 'sys.still.generate': watched },
    });
    setupConversation({ briefer: BRIEFER });

    const user = `u-${crypto.randomUUID().slice(0, 8)}`;
    const path = '~/People/Ayla/Head.still';

    await withContext(createContextStore([[SESSION, crypto.randomUUID()]]), async () => {
      fsContext.set({ ownerId: user, homeDir: `/users/${user}` });
      // Her still, made the way any still is, before the user opens it.
      await stills(
        {
          path,
          prompt:
            'Portrait of Ayla, a young lighthouse keeper’s daughter: freckles, windswept dark hair, warm lantern light, facing the camera, flat illustration',
          aspect: '1:1',
          batch: 1,
        },
        { agent: '~/Agents/Image.agent', desktop: async () => undefined },
      );

      // The window: the still it shows, held as data, and saved when it changes.
      const window = { still: (await read<StillDocument>(path, { encoding: 'json' })) as StillDocument };
      const first = window.still.chosen;

      // The desktop: a client of the conversation, answering what it's asked.
      const chat = conversation('dock-tab');
      const acted: string[] = [];
      chat.answer('doc.attempts', async (args: { path: string; request: never; attempts: never[] }) => {
        if (args.path !== path) return { added: false };
        applyRequest(window.still, args.request);
        addAttempts(window.still, args.attempts);
        await write(path, window.still as never);
        return { added: true };
      });
      for (const name of ['app.open', 'app.photos.show', 'desktop.tile', 'desktop.focus']) {
        chat.answer(name, (args: unknown) => void acted.push(`${name} ${JSON.stringify(args)}`));
      }
      chat.answer('ask_user', (form: unknown) => {
        acted.push(`ask_user ${JSON.stringify(form).slice(0, 160)}`);
        return { answer: 'Yes.' };
      });

      const started = Date.now();
      while (!chat.data.ready) await new Promise((resolve) => setTimeout(resolve, 50));
      await chat.ask('send', {
        text: 'Make her angry',
        context: { time: '2026-10-30T13:00:00+07:00', activeWindow: { app: 'photos', file: path } },
      });
      const answer = () => chat.data.messages.findLast((message): message is AgentMessage => message.role === 'agent');
      while (!['done', 'error', 'stopped'].includes(answer()?.status ?? '') && Date.now() - started < 240_000) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const message = answer();
      const said = (message?.parts ?? [])
        .map((part) => (part.type === 'text' ? (part.text ?? part.chunks.join('')) : `[widget: ${part.intent}]`))
        .join(' ');
      if (process.env.DOCK_OUT) {
        for (const [name, attempt] of [
          ['Head', window.still.attempts.find(({ id }) => id === first)],
          ['Angry', window.still.attempts.at(-1)],
        ] as const) {
          if (!attempt) continue;
          const image = await read(`~/People/Ayla/${attempt.src}`, { encoding: 'base64' });
          writeFileSync(`${process.env.DOCK_OUT}/${name}.webp`, Buffer.from(image ?? '', 'base64'));
        }
      }
      process.stdout.write(
        [
          '\n=== the dock',
          `in ${Math.round((Date.now() - started) / 1000)} s, answered by ${message?.agent}${message?.skill ? ` with ${message.skill}` : ''}: ${message?.status}${message?.reason ? ` (${message.reason})` : ''}`,
          `said: ${said}`,
          `sys.still.generate called with: ${made.map((args) => JSON.stringify(args)).join(' | ') || 'never'}`,
          `actions it wrote: ${message?.actions.map((action) => `${action.name} ${action.status}`).join(', ') || 'none'}`,
          `the desktop ran: ${acted.join(' | ') || 'nothing'}`,
          `the window's still: ${window.still.attempts.length} attempts, chosen ${window.still.chosen}, prompt "${window.still.prompt}", references ${JSON.stringify(window.still.references)}`,
          '',
        ].join('\n'),
      );
      expect(message?.status).toBe('done');
      expect(window.still.attempts.length).toBeGreaterThan(1);
      chat.close();
    });
  });
});
