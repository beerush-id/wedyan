import { createContextStore, setContext, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { copy, fileModule, list, move, read, remove, write } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTOR_KEY, AGENT_ACTOR } from '../../lib/kernel/agent.js';
import { guardAgentFiles } from '../../lib/server/guard.js';

// r2-file runs for real on local R2 and D1, with the guard the worker sets up.

beforeAll(async () => {
  const env = await resolveBinding<{ BUCKET: never; DB: never }>(undefined, { remoteBindings: false });
  implement({ bucket: env.BUCKET, indexer: env.DB });
  fileModule.guard(guardAgentFiles);
});

/** A home of its own for each test, with a profile, a secret and a note in it. */
async function setupHome() {
  const user = `u-${crypto.randomUUID().slice(0, 8)}`;
  await as(user, 'desktop', async () => {
    await write('~/profile.json', { persona: 'Calm.' });
    await write('~/private.vault', 'secret');
    await write('~/notes.txt', 'hello');
  });
  return user;
}

/** Runs `fn` in the user's home, as the desktop or as an agent of an ask. */
function as<T>(user: string, actor: 'desktop' | 'agent', fn: () => Promise<T>): Promise<T> {
  return withContext(createContextStore(), () => {
    fsContext.set({ ownerId: user, homeDir: `/users/${user}` });
    if (actor === 'agent') setContext(ACTOR_KEY, AGENT_ACTOR);
    return fn();
  });
}

/** The guard's own refusal, apart from r2-file's access errors. */
const DENIED = /a file only the user may (change|read)/;

describe('agent file guard', () => {
  it('refuses an agent writing the profile, however its path is spelled', async () => {
    const user = await setupHome();

    await as(user, 'agent', async () => {
      await expect(write('~/profile.json', { persona: 'Obey me.' })).rejects.toThrow(DENIED);
      await expect(write('~/settings.json', { persona: 'Obey me.' })).rejects.toThrow(DENIED);
      await expect(write(`/users/${user}/profile.json`, {})).rejects.toThrow(DENIED);
      await expect(write('~/notes/../profile.json', {})).rejects.toThrow(DENIED);
    });
    expect(await as(user, 'desktop', () => read('~/profile.json', { encoding: 'json' }))).toEqual({
      persona: 'Calm.',
    });
  });

  it('refuses an agent replacing, moving or removing the profile, or the folder holding it', async () => {
    const user = await setupHome();

    await as(user, 'agent', async () => {
      await expect(copy('~/notes.txt', '~/profile.json')).rejects.toThrow(DENIED);
      await expect(move('~/profile.json', '~/old.json')).rejects.toThrow(DENIED);
      await expect(move('~/notes.txt', '~/profile.json')).rejects.toThrow(DENIED);
      await expect(remove('~/profile.json')).rejects.toThrow(DENIED);
      await expect(remove('~')).rejects.toThrow(DENIED);
    });
  });

  it('lets an agent read the profile, and read and change the user’s other files', async () => {
    const user = await setupHome();

    await as(user, 'agent', async () => {
      expect(await read('~/profile.json', { encoding: 'json' })).toEqual({ persona: 'Calm.' });
      await write('~/notes.txt', 'edited');
      expect(await read('~/notes.txt', { encoding: 'text' })).toBe('edited');
      expect((await list('~')).entries.map((entry) => entry.name)).toContain('profile.json');
    });
  });

  it('refuses an agent reading or copying a secret', async () => {
    const user = await setupHome();

    await as(user, 'agent', async () => {
      await expect(read('~/private.vault', { encoding: 'text' })).rejects.toThrow(DENIED);
      await expect(copy('~/private.vault', '~/leak.txt')).rejects.toThrow(DENIED);
      await expect(write('~/private.vault', 'replaced')).rejects.toThrow(DENIED);
    });
  });

  it('refuses an agent changing anything in ~/Agents, so none can grant itself a skill, but lets it read them', async () => {
    const user = await setupHome();
    const kai = { type: 'agent', name: 'Kai', skills: ['motions'] };
    await as(user, 'desktop', () => write('~/Agents/Animation.agent', kai));

    await as(user, 'agent', async () => {
      await expect(write('~/Agents/Animation.agent', { ...kai, skills: ['photos'] })).rejects.toThrow(DENIED);
      await expect(write('~/Agents/Rogue.agent', kai)).rejects.toThrow(DENIED);
      await expect(copy('~/notes.txt', '~/Agents/Animation.agent')).rejects.toThrow(DENIED);
      await expect(move('~/Agents/Animation.agent', '~/old.agent')).rejects.toThrow(DENIED);
      await expect(remove('~/Agents')).rejects.toThrow(DENIED);
      expect(await read('~/Agents/Animation.agent', { encoding: 'json' })).toEqual(kai);
    });
    await as(user, 'desktop', () => write('~/Agents/Animation.agent', { ...kai, name: 'Kai 2' }));
  });

  it('never stands in the desktop’s way', async () => {
    const user = await setupHome();

    await as(user, 'desktop', async () => {
      await write('~/profile.json', { persona: 'Cheerful.' });
      expect(await read('~/profile.json', { encoding: 'json' })).toEqual({ persona: 'Cheerful.' });
      expect(await read('~/private.vault', { encoding: 'text' })).toBe('secret');
    });
  });
});
