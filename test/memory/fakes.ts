import type { VectorStore } from '../../lib/memory/memory.js';

// Vectorize and Workers AI are external services, so memory's tests fake both.

/** An embedding that counts a few words, so related text lands close together. */
const WORDS = ['coffee', 'tea', 'cat', 'drama', 'budget'];

/** Embeds by counting `WORDS`, one vector per text. */
export const embed = async (texts: string[]) =>
  texts.map((text) => [1, ...WORDS.map((word) => text.toLowerCase().split(word).length - 1)]);

/**
 * Vectorize's query, upsert, delete and describe over an in-memory list, with cosine similarity and
 * equality filters. Like Vectorize, a write is only searchable once processed: `lag` holds writes back.
 */
export function fakeVectors(): VectorStore & {
  stored: Map<string, { values: number[]; metadata?: Record<string, unknown>; at: number }>;
  lag: boolean;
} {
  const stored = new Map<string, { values: number[]; metadata?: Record<string, unknown>; at: number }>();
  let processedUpTo = 0;
  const cosine = (a: number[], b: number[]) => {
    const dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
    const norm = (v: number[]) => Math.sqrt(v.reduce((sum, value) => sum + value * value, 0));
    return dot / (norm(a) * norm(b));
  };
  const fake = {
    stored,
    lag: false,
    async upsert(vectors: Parameters<VectorStore['upsert']>[0]) {
      const at = Date.now();
      for (const { id, values, metadata } of vectors) stored.set(id, { values, metadata, at });
      if (!fake.lag) processedUpTo = at;
      return { count: vectors.length };
    },
    async deleteByIds(ids: string[]) {
      for (const id of ids) stored.delete(id);
      return { count: ids.length };
    },
    async describe() {
      return { processedUpToDatetime: processedUpTo };
    },
    async query(values: number[], options: Parameters<VectorStore['query']>[1]) {
      const matches = [...stored.entries()]
        .filter(([, entry]) => entry.at <= processedUpTo)
        .filter(([, entry]) =>
          Object.entries(options.filter ?? {}).every(([key, value]) => entry.metadata?.[key] === value),
        )
        .map(([id, entry]) => ({ id, score: cosine(values, entry.values), metadata: entry.metadata }))
        .sort((a, b) => b.score - a.score)
        .slice(0, options.topK ?? 5);
      return { matches };
    },
  };
  return fake;
}
