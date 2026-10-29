import { AIAdapter, type ImageContext, type ImageOutput, MuseDriver } from '@irpclib/ai-kit/worker';
import { createContextStore, withContext } from '@irpclib/irpc';
import { mutable } from '@irpclib/irpc/core';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { exists, read, stat } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DriveDriver } from '../../lib/server/drive-driver.js';

// r2-file runs for real on local R2 and D1; only the providers' hosts are mocked.

beforeAll(async () => {
  const env = await resolveBinding<{ BUCKET: never; DB: never }>(undefined, { remoteBindings: false });
  implement({ bucket: env.BUCKET, indexer: env.DB });
});

/** Runs `fn` in a home of its own. */
function inHome<T>(fn: () => Promise<T>): Promise<T> {
  const user = `u-${crypto.randomUUID().slice(0, 8)}`;
  return withContext(createContextStore(), () => {
    fsContext.set({ ownerId: user, homeDir: `/users/${user}` });
    return fn();
  });
}

/** A draw a provider has served with `url`. */
function served(url: string, payload: Record<string, unknown>): ImageContext {
  return {
    state: { data: { id: 'out-1', status: 'pending', input: payload, url } as ImageOutput },
    input: payload as never,
    payload: payload as never,
    rollbacks: new Set(),
  };
}

/** Answers fetches to the hosts by URL, recording what was fetched. */
function mockHosts(routes: Record<string, () => Response>) {
  const fetched: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new Request(input instanceof Request ? input : String(input), init).url;
    fetched.push(url);
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    return route ? route[1]() : new Response('not found', { status: 404 });
  });
  return fetched;
}

const webp = () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'Content-Type': 'image/webp' } });

describe('drive driver', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a hosted result in the saveTo folder, named by its id, and points the output at it', async () => {
    mockHosts({ 'https://cdn.test/': webp });

    await inHome(async () => {
      const ctx = served('https://cdn.test/1.webp?sig=abc', { prompt: 'A lantern', saveTo: '~/Motions/Lantern/Hero/' });
      await new DriveDriver().draw(ctx);

      expect(ctx.state.data.url).toBe('~/Motions/Lantern/Hero/out-1.webp');
      expect(await stat('~/Motions/Lantern/Hero/out-1.webp')).toMatchObject({ size: 4, type: 'image/webp' });

      // A call that fails after its file was kept leaves nothing behind.
      for (const rollback of ctx.rollbacks) await rollback();
      expect(await exists('~/Motions/Lantern/Hero/out-1.webp')).toBe(false);
    });
  });

  it('writes a result that came inline as a data URL', async () => {
    const fetched = mockHosts({});

    await inHome(async () => {
      const ctx = served('data:image/png;base64,iVBORw0K', { prompt: 'A lantern', saveTo: '~/Pictures' });
      await new DriveDriver().draw(ctx);

      expect(ctx.state.data.url).toBe('~/Pictures/out-1.png');
      expect(await read('~/Pictures/out-1.png', { encoding: 'base64' })).toBe('iVBORw0K');
      expect(fetched).toEqual([]);
    });
  });

  it('leaves a result as the provider served it without saveTo, or when it is already in the drive', async () => {
    const fetched = mockHosts({ 'https://cdn.test/': webp });

    await inHome(async () => {
      const unsaved = served('https://cdn.test/1', { prompt: 'A lantern' });
      const kept = served('~/Pictures/out-1.webp', { prompt: 'A lantern', saveTo: '~/Pictures' });
      await new DriveDriver().draw(unsaved);
      await new DriveDriver().draw(kept);

      expect(unsaved.state.data.url).toBe('https://cdn.test/1');
      expect(kept.state.data.url).toBe('~/Pictures/out-1.webp');
      expect(fetched).toEqual([]);
    });
  });

  it('fails the call when the result can’t be kept, keeping nothing', async () => {
    mockHosts({ 'https://cdn.test/': () => new Response('gone', { status: 403 }) });

    await inHome(async () => {
      const ctx = served('https://cdn.test/1.jpg', { prompt: 'A lantern', saveTo: '~/Pictures' });
      await expect(new DriveDriver().draw(ctx)).rejects.toThrow();
      expect(await exists('~/Pictures/out-1.jpg')).toBe(false);
      expect(ctx.state.data.url).toBe('https://cdn.test/1.jpg');
    });
  });

  it('keeps what a provider drew when it is last in the adapter, as the server sets it up', async () => {
    mockHosts({
      'https://api.meta.test/v1/images/generations': () =>
        new Response(JSON.stringify({ created: 1, data: [{ url: 'https://cdn.test/2.webp' }] })),
      'https://cdn.test/': webp,
    });
    const adapter = new AIAdapter()
      .use(new MuseDriver({ apiKey: 'k', baseUrl: 'https://api.meta.test/v1' }))
      .use(new DriveDriver());

    await inHome(async () => {
      const state = mutable({} as { data?: ImageOutput });
      await new Promise<void>((resolve, reject) => {
        void adapter.draw({ prompt: 'A lantern', saveTo: '~/Pictures' } as never, { state, resolve, reject });
      });

      expect(state.data?.url).toBe(`~/Pictures/${state.data?.id}.webp`);
      expect(await exists(state.data?.url ?? '')).toBe(true);
    });
  });
});
