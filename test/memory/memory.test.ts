import { createContextStore, IRPCRouter, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { read } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MemoDocument } from '../../lib/documents/types.js';
import { memory, recall, save } from '../../lib/memory/memory.h.js';
import { setupMemory, type VectorStore } from '../../lib/memory/memory.js';

// r2-file runs for real on local R2 and D1. Only Vectorize and Workers AI, external services, are faked.

/** An embedding that counts a few words, so related text lands close together. */
const WORDS = ['coffee', 'tea', 'cat', 'drama', 'budget'];
const embed = async (texts: string[]) =>
  texts.map((text) => [1, ...WORDS.map((word) => text.toLowerCase().split(word).length - 1)]);

/** Vectorize's query and upsert over an in-memory list, with cosine similarity and equality filters. */
function fakeVectors(): VectorStore & {
  stored: Map<string, { values: number[]; metadata?: Record<string, unknown> }>;
} {
  const stored = new Map<string, { values: number[]; metadata?: Record<string, unknown> }>();
  const cosine = (a: number[], b: number[]) => {
    const dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
    const norm = (v: number[]) => Math.sqrt(v.reduce((sum, value) => sum + value * value, 0));
    return dot / (norm(a) * norm(b));
  };
  return {
    stored,
    async upsert(vectors) {
      for (const { id, values, metadata } of vectors) stored.set(id, { values, metadata });
      return { count: vectors.length };
    },
    async query(values, options) {
      const matches = [...stored.entries()]
        .filter(([, entry]) =>
          Object.entries(options.filter ?? {}).every(([key, value]) => entry.metadata?.[key] === value),
        )
        .map(([id, entry]) => ({ id, score: cosine(values, entry.values), metadata: entry.metadata }))
        .sort((a, b) => b.score - a.score)
        .slice(0, options.topK ?? 5);
      return { matches };
    },
  };
}

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
      const saved = await save('Takes coffee black, never tea.', { kind: 'preference', tags: ['drinks'] });

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

  it('names a memo by its option, and never overwrites another of the same name', async () => {
    await asUser(async () => {
      const first = await save('Ana leads casting.', { kind: 'person', name: 'Ana' });
      const second = await save('Ana prefers calls over mail.', { kind: 'person', name: 'Ana' });

      expect(first.path).toBe('~/Memos/Ana.memo');
      expect(second.path).toMatch(/^~\/Memos\/Ana \w+\.memo$/);
      expect(((await read(first.path, { encoding: 'json' })) as MemoDocument).body).toBe('Ana leads casting.');
    });
  });

  it('indexes each memo by its path, in the memory scope', async () => {
    await asUser(async () => {
      const saved = await save('Budget for episode 2 is approved.', { kind: 'fact' });

      const [entry] = [...vectors.stored.values()];
      expect(vectors.stored.size).toBe(1);
      expect(entry.metadata).toMatchObject({ path: saved.path, scope: 'memory', kind: 'fact' });
    });
  });

  it('recalls what was saved by meaning, closest first, with its text and where it lives', async () => {
    await asUser(async () => {
      await save('Takes coffee black, never tea.', { kind: 'preference' });
      await save('The cat is called Miso.', { kind: 'fact' });

      const found = await recall('what does the user drink, coffee or tea?', { limit: 1 });

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
      await save('The cat is called Miso.', { kind: 'fact' });

      expect(await recall('cat', { scope: 'files' })).toEqual([]);
      expect(await recall('cat', { scope: 'memory' })).toHaveLength(1);
    });
  });

  it('never recalls another user’s memories, though they share the index', async () => {
    await asUser(async () => {
      await save('The cat is called Miso.', { kind: 'fact' });
    });

    await asUser(async () => {
      await save('The cat is called Miso.', { kind: 'fact' });
      expect(vectors.stored.size).toBe(2);
      expect(await recall('cat')).toHaveLength(1);
    });
  });

  it('offers save and recall as tools, with their arguments named', () => {
    const tools = new IRPCRouter(memory.transport!).getTools().filter((tool) => tool.name.startsWith('memory.'));

    expect(tools.map((tool) => tool.name)).toEqual(['memory.save', 'memory.recall']);
    expect(Object.keys(tools[0].inputSchema.properties as object)).toEqual(['text', 'options']);
    expect(Object.keys(tools[1].inputSchema.properties as object)).toEqual(['query', 'options']);
    expect(tools[1].annotations).toMatchObject({ readOnlyHint: true });
  });

  it('tells the model the type of each argument, options being an object of known fields', () => {
    const [saveTool, recallTool] = new IRPCRouter(memory.transport!)
      .getTools()
      .filter((tool) => tool.name.startsWith('memory.'));

    expect(saveTool.inputSchema).toMatchObject({
      properties: {
        text: { type: 'string' },
        options: {
          type: 'object',
          properties: {
            kind: { enum: ['note', 'preference', 'person', 'project', 'fact'] },
            name: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['text'],
    });
    expect(recallTool.inputSchema).toMatchObject({
      properties: {
        query: { type: 'string' },
        options: { type: 'object', properties: { scope: { enum: ['memory', 'files', 'all'] } } },
      },
      required: ['query'],
    });
  });

  it('refuses options that are not an object, rather than saving the memo wrongly', async () => {
    await asUser(async () => {
      await expect(save('Likes tea.', '{"kind":"preference"}' as never)).rejects.toThrow();
      expect(vectors.stored.size).toBe(0);
    });
  });
});
