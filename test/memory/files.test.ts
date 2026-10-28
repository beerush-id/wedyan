import { createContextStore, IRPC_STORE, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { copy, move, remove, restore, write } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentIndex } from '../../lib/memory/files.js';
import { recall } from '../../lib/memory/memory.h.js';
import { setupMemory } from '../../lib/memory/memory.js';
import { embed, fakeVectors } from './fakes.js';

// r2-file runs for real on local R2 and D1, with the content index attached as the worker does.

let env: { BUCKET: never; DB: never };

beforeAll(async () => {
  env = await resolveBinding<{ BUCKET: never; DB: never }>(undefined, { remoteBindings: false });
  implement({ bucket: env.BUCKET, indexer: env.DB }).use(contentIndex());
});

/** Runs as a user unique to this run, so tests never share a home, even with what local R2 kept. */
const asUser = <T>(fn: () => Promise<T>) => {
  const user = `u-${crypto.randomUUID().slice(0, 8)}`;
  return withContext(createContextStore(), () => {
    fsContext.set({ ownerId: user, homeDir: `/users/${user}` });
    return fn();
  });
};

/** The files recall finds for a query, by path. */
const filesFor = async (query: string) =>
  (await recall({ query, scope: 'files', limit: 20 })).map((found) => found.path);

describe('content index', () => {
  let vectors: ReturnType<typeof fakeVectors>;

  beforeEach(() => {
    vectors = fakeVectors();
    setupMemory({ vectors, embed });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('indexes a written text file, so recall finds it by what it says, at its ~ path', async () => {
    await asUser(async () => {
      await write('~/notes/drinks.md', 'Coffee in the morning, tea at night.');

      const [found] = await recall({ query: 'coffee or tea', scope: 'files' });

      expect(found).toMatchObject({
        path: '~/notes/drinks.md',
        name: 'drinks.md',
        scope: 'files',
        text: 'Coffee in the morning, tea at night.',
      });
    });
  });

  it('indexes only the extensions it is given', async () => {
    await asUser(async () => {
      await write('~/data.json', { drink: 'coffee' });
      await write('~/notes.txt', 'coffee');

      expect(await filesFor('coffee')).toEqual(['~/notes.txt']);
    });
  });

  it('splits a long file into chunks, and drops the ones a shorter version no longer has', async () => {
    await asUser(async () => {
      const paragraph = `${'Budget talk. '.repeat(100)}`.trim();
      await write('~/long.md', [paragraph, paragraph, paragraph].join('\n\n'));
      const chunks = vectors.stored.size;

      await write('~/long.md', 'Budget, in short.');

      expect(chunks).toBeGreaterThan(1);
      expect(vectors.stored.size).toBe(1);
      expect([...vectors.stored.values()][0].metadata).toMatchObject({ text: 'Budget, in short.' });
    });
  });

  it('unindexes a removed file, whether deleted or trashed, and indexes it again when restored', async () => {
    await asUser(async () => {
      await write('~/gone.md', 'The cat that left.');
      await remove('~/gone.md');
      expect(await filesFor('cat')).toEqual([]);

      await write('~/cat.md', 'The cat is called Miso.');
      await remove('~/cat.md', { soft: true });
      expect(await filesFor('cat')).toEqual([]);

      await restore('~/cat.md');
      expect(await filesFor('cat')).toEqual(['~/cat.md']);
    });
  });

  it('moves a file’s index with it, and indexes a copy beside the original', async () => {
    await asUser(async () => {
      await write('~/drama.md', 'A short drama about a cat.');

      await move('~/drama.md', '~/projects/drama.md');
      expect(await filesFor('drama')).toEqual(['~/projects/drama.md']);

      await copy('~/projects/drama.md', '~/drama-copy.md');
      expect((await filesFor('drama')).sort()).toEqual(['~/drama-copy.md', '~/projects/drama.md']);
    });
  });

  it('never fails a write when indexing fails, and logs why', async () => {
    const logged = vi.spyOn(IRPC_STORE, 'error').mockImplementation(() => {});
    setupMemory({
      vectors,
      embed: async () => {
        throw new Error('embedding is down');
      },
    });

    await asUser(async () => {
      const info = await write('~/kept.md', 'Saved anyway.');
      expect(info.path).toMatch(/\/kept\.md$/);
    });
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'embedding is down' }), [
      { index: expect.stringMatching(/\/kept\.md$/) },
    ]);
  });
});
