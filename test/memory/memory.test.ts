import { createContextStore, IRPCRouter, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { read } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MemoDocument } from '../../lib/documents/types.js';
import { memory, recall, save } from '../../lib/memory/memory.h.js';
import { setupMemory } from '../../lib/memory/memory.js';
import { embed, fakeVectors } from './fakes.js';

// r2-file runs for real on local R2 and D1. Only Vectorize and Workers AI, external services, are faked.

/** Runs as a user unique to this run, so tests never share a home, even with what local R2 kept. */
const asUser = <T>(fn: () => Promise<T>) => {
  const user = `u-${crypto.randomUUID().slice(0, 8)}`;
  return withContext(createContextStore(), () => {
    fsContext.set({ ownerId: user, homeDir: `/users/${user}` });
    return fn();
  });
};

describe('memory', () => {
  let vectors: ReturnType<typeof fakeVectors>;

  beforeAll(async () => {
    const env = await resolveBinding<{ BUCKET: never; DB: never }>(undefined, { remoteBindings: false });
    implement({ bucket: env.BUCKET, indexer: env.DB });
  });

  beforeEach(() => {
    vectors = fakeVectors();
    setupMemory({ vectors, embed });
  });

  it('saves a memo the user can open, as a memo document under ~/Memos', async () => {
    await asUser(async () => {
      const saved = await save({ text: 'Takes coffee black, never tea.', kind: 'preference', tags: ['drinks'] });

      expect(saved).toEqual({
        path: '~/Memos/Takes coffee black, never tea.memo',
        name: 'Takes coffee black, never tea',
        kind: 'preference',
      });
      const memo = (await read(saved.path, { encoding: 'json' })) as MemoDocument;
      expect(memo).toMatchObject({
        type: 'memo',
        version: 1,
        name: 'Takes coffee black, never tea',
        kind: 'preference',
        tags: ['drinks'],
        body: 'Takes coffee black, never tea.',
        author: { kind: 'agent' },
      });
      expect(memo.created).toBe(memo.updated);
    });
  });

  it('names a memo by its name, and never overwrites another of the same name', async () => {
    await asUser(async () => {
      const first = await save({ text: 'Ana leads casting.', kind: 'person', name: 'Ana' });
      const second = await save({ text: 'Ana prefers calls over mail.', kind: 'person', name: 'Ana' });

      expect(first.path).toBe('~/Memos/Ana.memo');
      expect(second.path).toMatch(/^~\/Memos\/Ana \w+\.memo$/);
      expect(((await read(first.path, { encoding: 'json' })) as MemoDocument).body).toBe('Ana leads casting.');
    });
  });

  it('indexes each memo by its path, in the memory scope', async () => {
    await asUser(async () => {
      const saved = await save({ text: 'Budget for episode 2 is approved.', kind: 'fact' });

      const [entry] = [...vectors.stored.values()];
      expect(vectors.stored.size).toBe(1);
      expect(entry.metadata).toMatchObject({ path: saved.path, scope: 'memory', kind: 'fact' });
    });
  });

  it('recalls what was saved by meaning, closest first, with its text and where it lives', async () => {
    await asUser(async () => {
      await save({ text: 'Takes coffee black, never tea.', kind: 'preference' });
      await save({ text: 'The cat is called Miso.', kind: 'fact' });

      const found = await recall({ query: 'what does the user drink, coffee or tea?', limit: 1 });

      expect(found).toEqual([
        {
          path: '~/Memos/Takes coffee black, never tea.memo',
          name: 'Takes coffee black, never tea',
          scope: 'memory',
          kind: 'preference',
          text: 'Takes coffee black, never tea.',
          score: expect.any(Number),
        },
      ]);
    });
  });

  it('recalls within a scope when asked to', async () => {
    await asUser(async () => {
      await save({ text: 'The cat is called Miso.', kind: 'fact' });

      expect(await recall({ query: 'cat', scope: 'files' })).toEqual([]);
      expect(await recall({ query: 'cat', scope: 'memory' })).toHaveLength(1);
    });
  });

  it('never recalls another user’s memories, though they share the index', async () => {
    await asUser(async () => {
      await save({ text: 'The cat is called Miso.', kind: 'fact' });
    });

    await asUser(async () => {
      await save({ text: 'The cat is called Miso.', kind: 'fact' });
      expect(vectors.stored.size).toBe(2);
      expect(await recall({ query: 'cat' })).toHaveLength(1);
    });
  });

  it('recalls a memo saved just now, before the index has processed it', async () => {
    vectors.lag = true;
    await asUser(async () => {
      await save({ text: 'Prefers short answers in the morning.', kind: 'preference' });

      const found = await recall({ query: 'morning answers' });

      expect(found).toMatchObject([
        {
          path: '~/Memos/Prefers short answers in the morning.memo',
          name: 'Prefers short answers in the morning',
          scope: 'memory',
          kind: 'preference',
          text: 'Prefers short answers in the morning.',
        },
      ]);
    });
  });

  it('lists a memo once, when the index has it too', async () => {
    await asUser(async () => {
      await save({ text: 'The cat is called Miso.', kind: 'fact' });

      expect(await recall({ query: 'cat' })).toHaveLength(1);
    });
  });

  it('offers save and recall as tools that take one flat object', () => {
    const [saveTool, recallTool] = new IRPCRouter(memory.transport!)
      .getTools()
      .filter((tool) => tool.name.startsWith('memory.'));

    expect([saveTool.name, recallTool.name]).toEqual(['memory.save', 'memory.recall']);
    expect(saveTool.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        text: { type: 'string' },
        kind: { enum: ['note', 'preference', 'person', 'project', 'fact'] },
        name: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['text'],
    });
    expect(recallTool.inputSchema).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' }, scope: { enum: ['memory', 'files', 'all'] } },
      required: ['query'],
    });
    expect(recallTool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('refuses fields it doesn’t know, rather than saving the memo wrongly', async () => {
    await asUser(async () => {
      const nested = { text: 'Likes tea.', options: { kind: 'preference' } };
      await expect(save(nested as never)).rejects.toThrow();
      expect(vectors.stored.size).toBe(0);
    });
  });
});
