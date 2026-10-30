import { createContextStore, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { exists, read, remove, write } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOME_SEEDS, SEED_MARKER, seedHome } from '../../lib/server/seed.js';

// r2-file runs for real on local R2 and D1.

beforeAll(async () => {
  const env = await resolveBinding<{ BUCKET: never; DB: never }>(undefined, { remoteBindings: false });
  implement({ bucket: env.BUCKET, indexer: env.DB });
});

/** A home of its own; `fn` runs in it as one of its sessions. */
function newHome() {
  const user = `u-${crypto.randomUUID().slice(0, 8)}`;
  return <T>(fn: () => Promise<T>) =>
    withContext(createContextStore(), () => {
      fsContext.set({ ownerId: user, homeDir: `/users/${user}` });
      return fn();
    });
}

const SEEDS = { 'Agents/Story.agent': '{"name":"Story"}', 'Memos/Brief.md': '# Brief' };

describe('seeding a new home', () => {
  it('writes every seed into the home once, and records it', async () => {
    const home = newHome();

    await home(async () => {
      await seedHome(crypto.randomUUID(), SEEDS);
      expect(await read('~/Agents/Story.agent', { encoding: 'json' })).toEqual({ name: 'Story' });
      expect(await read('~/Memos/Brief.md', { encoding: 'text' })).toBe('# Brief');
      expect(await exists(SEED_MARKER)).toBe(true);
    });
  });

  it('never seeds a home again, so what the user changed or removed stays as they left it', async () => {
    const home = newHome();

    await home(async () => {
      await seedHome(crypto.randomUUID(), SEEDS);
      await write('~/Memos/Brief.md', '# Mine now');
      await remove('~/Agents/Story.agent');

      // Another session of the same home, or another server process: the marker is what's checked.
      await seedHome(crypto.randomUUID(), SEEDS);
      expect(await read('~/Memos/Brief.md', { encoding: 'text' })).toBe('# Mine now');
      expect(await exists('~/Agents/Story.agent')).toBe(false);
    });
  });

  it('shares one seeding between a session’s first calls', async () => {
    const home = newHome();
    const session = crypto.randomUUID();

    await home(async () => {
      const first = seedHome(session, SEEDS);
      expect(seedHome(session, SEEDS)).toBe(first);
      await first;
    });
  });

  it('bundles the home seed from seeds/home, by its path in the home', () => {
    expect(Object.keys(HOME_SEEDS)).toEqual(
      expect.arrayContaining([
        'Agents/Animation.agent',
        'Agents/Audio.agent',
        'Agents/Editor.agent',
        'Agents/Image.agent',
        'Agents/Story.agent',
        'Agents/Video.agent',
      ]),
    );
  });
});
