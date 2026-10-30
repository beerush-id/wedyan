import { AIAdapter, type ImageOutput, MuseDriver } from '@irpclib/ai-kit/worker';
import { createContextStore, withContext } from '@irpclib/irpc';
import { mutable } from '@irpclib/irpc/core';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { fsContext } from '@irpclib/r2-file/context';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EVERYONE_LIMIT,
  setupUsage,
  spend,
  type UsageDatabase,
  UsageDriver,
  VIDEO_NEEDS_KEY,
  VISITOR_LIMIT,
} from '../../lib/server/usage.js';

// Counts run for real on local D1; only the model provider's host is mocked.

const LIMITS = {
  chat: { visitor: 2, everyone: 1000 },
  media: { visitor: 1, everyone: 1000 },
  speech: { visitor: 1, everyone: 1000 },
};

let db: UsageDatabase & { exec(query: string): Promise<unknown> };

beforeAll(async () => {
  const env = await resolveBinding<{ DB: typeof db }>(undefined, { remoteBindings: false });
  db = env.DB;
});

/** Runs `fn` as a visitor of their own. */
function asVisitor<T>(fn: () => Promise<T>, visitor = crypto.randomUUID()): Promise<T> {
  return withContext(createContextStore(), () => {
    fsContext.set({ ownerId: visitor, homeDir: `/users/${visitor}` });
    return fn();
  });
}

describe('the day’s limits', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lets a visitor spend up to their limit, then refuses them', async () => {
    setupUsage(db, LIMITS);

    await asVisitor(async () => {
      await spend('chat');
      await spend('chat');
      await expect(spend('chat')).rejects.toThrow(VISITOR_LIMIT);
    });
  });

  it('counts each visitor apart, and each kind apart', async () => {
    setupUsage(db, LIMITS);

    await asVisitor(async () => {
      await spend('media');
      await expect(spend('media')).rejects.toThrow(VISITOR_LIMIT);
      await spend('chat');
    });
    await asVisitor(() => spend('media'));
  });

  it('refuses even a new visitor once everyone’s limit is reached', async () => {
    setupUsage(db, LIMITS);
    await asVisitor(() => spend('speech'));

    // Everyone's count is already past 0, however many visitors made it.
    setupUsage(db, { ...LIMITS, speech: { visitor: 1000, everyone: 0 } });
    await expect(asVisitor(() => spend('speech'))).rejects.toThrow(EVERYONE_LIMIT);
  });

  it('never loses a count to calls made at once', async () => {
    setupUsage(db, { ...LIMITS, chat: { visitor: 3, everyone: 1000 } });

    const results = await asVisitor(() => Promise.allSettled(Array.from({ length: 6 }, () => spend('chat'))));

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(3);
  });

  it('gives a visitor a new day’s limit', async () => {
    setupUsage(db, LIMITS);
    const visitor = crypto.randomUUID();
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T23:00:00Z') });

    await asVisitor(() => spend('media'), visitor);
    await expect(asVisitor(() => spend('media'), visitor)).rejects.toThrow(VISITOR_LIMIT);

    vi.setSystemTime(new Date('2026-11-02T01:00:00Z'));
    await asVisitor(() => spend('media'), visitor);
  });

  it('stops a call before it reaches a provider, and says why', async () => {
    setupUsage(db, { ...LIMITS, media: { visitor: 0, everyone: 1000 } });
    const provider = vi.spyOn(globalThis, 'fetch');
    const adapter = new AIAdapter()
      .use(new UsageDriver())
      .use(new MuseDriver({ apiKey: 'k', baseUrl: 'https://api.meta.test/v1' }));

    const drawing = asVisitor(
      () =>
        new Promise<void>((resolve, reject) => {
          void adapter.draw({ prompt: 'A lantern' } as never, {
            state: mutable({} as { data?: ImageOutput }),
            resolve,
            reject,
          });
        }),
    );

    await expect(drawing).rejects.toThrow(VISITOR_LIMIT);
    expect(provider).not.toHaveBeenCalled();
  });

  it('refuses video on the server’s keys', () => {
    setupUsage(db, LIMITS);

    expect(() => new UsageDriver().film()).toThrow(VIDEO_NEEDS_KEY);
  });
});
