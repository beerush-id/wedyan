import { AIAdapter, type ImageContext, type ImageOutput, MuseDriver } from '@irpclib/ai-kit/worker';
import { createContextStore, withContext } from '@irpclib/irpc';
import { mutable } from '@irpclib/irpc/core';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { exists, read, stat, write } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import type { ImageWorkerEnv } from '@irpclib/r2-image/worker';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODELS } from '../../lib/agents/index.js';
import type { StillDocument } from '../../lib/documents/types.js';
import { stillDescribe } from '../../lib/kernel/stills.h.js';
import { DriveDriver } from '../../lib/server/drive-driver.js';
import { generateImage, IMAGE_MODEL } from '../../lib/server/images.js';
import { DESCRIBE_PROMPTS, setupStills } from '../../lib/server/stills.js';
import { imageUrl } from '../../lib/share/image.js';
import { openLink } from '../../lib/share/links.js';
import { responses, says } from '../kernel/vendor.js';

// r2-file and R2 Image run for real on local R2 and D1; only the providers' hosts and the resizer's
// are mocked.

/** Where the resizer answers in these tests. */
const RESIZER = 'http://resizer.test/';

let pictures: ImageWorkerEnv;

beforeAll(async () => {
  const env = await resolveBinding<{ BUCKET: never; DB: never }>(undefined, { remoteBindings: false });
  implement({ bucket: env.BUCKET, indexer: env.DB });
  pictures = { IMAGES: env.BUCKET, RESIZER: RESIZER as ImageWorkerEnv['RESIZER'] };
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

const KAI = '~/Agents/Animation.agent';

/** Muse drawing at the generations endpoint, and editing with references at the edits one, each a new image. */
function museDraws() {
  let drawn = 0;
  const image = () => new Response(JSON.stringify({ created: 1, data: [{ url: `https://cdn.test/${++drawn}.webp` }] }));
  return mockHosts({
    'https://api.meta.test/v1/images/generations': image,
    'https://api.meta.test/v1/images/edits': image,
    'https://cdn.test/': webp,
  });
}

describe('sys.still.generate', () => {
  const adapter = new AIAdapter()
    .use(new MuseDriver({ apiKey: 'k', baseUrl: 'https://api.meta.test/v1' }))
    .use(new DriveDriver());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a still, makes its attempts beside it, chooses the first, and gives the agent what to show', async () => {
    museDraws();
    const generate = setupStills(adapter, pictures);

    await inHome(async () => {
      const result = (await generate(
        { path: '~/People/Ayla/Head.still', prompt: 'Ayla, a lighthouse keeper’s daughter', batch: 2, aspect: '1:1' },
        { agent: KAI, desktop: async () => undefined },
      )) as { open: string; attempts: Array<{ id: string; url: string }> };

      const still = (await read('~/People/Ayla/Head.still', { encoding: 'json' })) as StillDocument;
      expect(still).toMatchObject({ type: 'still', name: 'Head', prompt: 'Ayla, a lighthouse keeper’s daughter' });
      expect(still.settings).toMatchObject({ aspect: '1:1', batch: 2 });
      expect(still.attempts).toHaveLength(2);
      expect(still.chosen).toBe(still.attempts[0].id);
      // Each image kept beside it, by path from the still.
      for (const attempt of still.attempts) {
        expect(attempt.src).toBe(`Head/${attempt.id}.webp`);
        expect(await exists(`~/People/Ayla/${attempt.src}`)).toBe(true);
      }
      expect(result.attempts.map(({ url }) => url)).toEqual(
        still.attempts.map((attempt) => imageUrl(`~/People/Ayla/${attempt.src}`, { size: 512 })),
      );
      expect(result.open).toBe(openLink('~/People/Ayla/Head.still'));
    });
  });

  it('makes a pose from the head’s chosen image, sent inline since the drive is private', async () => {
    museDraws();
    const spied = vi.mocked(globalThis.fetch);
    const generate = setupStills(adapter, pictures);
    const ask = { agent: KAI, desktop: async () => undefined };

    await inHome(async () => {
      await generate({ path: '~/People/Ayla/Head.still', prompt: 'Ayla, face' }, ask);
      await generate({ path: '~/People/Ayla/Smile.still', prompt: 'Ayla smiling', references: ['Head.still'] }, ask);

      const [, init] = spied.mock.calls.find(([input]) => String(input).endsWith('/images/edits')) ?? [];
      const body = JSON.parse(String(init?.body)) as { images: Array<{ image_url: string }> };
      expect(body.images[0].image_url).toMatch(/^data:image\/webp;base64,/);
    });
  });

  it('leaves the still as it was when no image came back, and tells the agent', async () => {
    museDraws();
    const generate = setupStills(adapter, pictures);
    const asked: unknown[] = [];

    await inHome(async () => {
      await generate(
        { path: '~/People/Ayla/Head.still', prompt: 'Ayla, face' },
        { agent: KAI, desktop: async () => undefined },
      );
      const before = (await read('~/People/Ayla/Head.still', { encoding: 'json' })) as StillDocument;

      // No model serves this one: nothing comes back.
      const nothing = setupStills(new AIAdapter().use(new DriveDriver()), pictures);
      const result = await nothing(
        { path: '~/People/Ayla/Head.still', prompt: 'Ayla, angry' },
        {
          agent: KAI,
          desktop: async (action) => {
            asked.push(action);
            return { added: true };
          },
        },
      );

      expect(result).toMatchObject({ error: expect.stringContaining('No image came back') });
      expect(asked).toEqual([]);
      expect(await read('~/People/Ayla/Head.still', { encoding: 'json' })).toEqual(before);
    });
  });

  it('hands the attempts to a desktop editing the still, writing nothing over its copy', async () => {
    museDraws();
    const generate = setupStills(adapter, pictures);
    const asked: unknown[] = [];

    await inHome(async () => {
      await generate(
        { path: '~/People/Ayla/Head.still', prompt: 'Ayla, face' },
        { agent: KAI, desktop: async () => undefined },
      );
      const before = (await read('~/People/Ayla/Head.still', { encoding: 'json' })) as StillDocument;
      await generate(
        { path: '~/People/Ayla/Head.still' },
        {
          agent: KAI,
          desktop: async (action) => {
            asked.push(action);
            return { added: true };
          },
        },
      );

      expect(asked).toMatchObject([{ name: 'doc.attempts', args: { path: '~/People/Ayla/Head.still' }, ask: true }]);
      // The desktop saves them with its edits; the server didn't write the still.
      const still = (await read('~/People/Ayla/Head.still', { encoding: 'json' })) as StillDocument;
      expect(still.attempts).toEqual(before.attempts);
    });
  });
});

describe('still.describe', () => {
  const adapter = new AIAdapter()
    .use(new MuseDriver({ apiKey: 'k', baseUrl: 'https://api.meta.test/v1' }))
    .use(new DriveDriver());
  const FACE = 'A girl of about nine: round face, freckles across the nose, hazel eyes, black shoulder-length hair.';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Muse drawing, R2 Image's resizer resizing, and Spark describing, each request kept. */
  function served() {
    const asked: Array<{ url: string; body: string }> = [];
    let drawn = 0;
    const image = () =>
      new Response(JSON.stringify({ created: 1, data: [{ url: `https://cdn.test/${++drawn}.webp` }] }));
    const answer = () => responses({ text: FACE });
    const routes: Record<string, () => Response> = {
      'https://api.meta.test/v1/images/generations': image,
      'https://cdn.test/': webp,
      [RESIZER]: webp,
      'https://api.meta.test/v1/responses': answer,
      'https://api.meta.test/v1/chat/completions': () => says(FACE),
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input instanceof Request ? input : String(input), init);
      asked.push({ url: request.url, body: request.method === 'POST' ? await request.clone().text() : '' });
      const route = Object.entries(routes).find(([prefix]) => request.url.startsWith(prefix));
      return route ? route[1]() : new Response('not found', { status: 404 });
    });
    return asked;
  }

  it('describes the chosen image for its purpose, resized by R2 Image before Spark looks', async () => {
    const asked = served();
    const generate = setupStills(adapter, pictures);

    await inHome(async () => {
      await generate(
        { path: '~/People/Ayla/Head.still', prompt: 'Ayla, face' },
        { agent: KAI, desktop: async () => undefined },
      );
      const said = await stillDescribe('~/People/Ayla/Head.still', { type: 'face' });

      expect(said).toBe(FACE);
      // The resizer was asked for the chosen image, and Spark was shown what came back, inline.
      expect(asked.some(({ url }) => url.startsWith(RESIZER))).toBe(true);
      const described = asked.find(({ url }) => /\/(responses|chat\/completions)$/.test(url));
      expect(described?.body).toContain(DESCRIBE_PROMPTS.face.slice(0, 40));
      expect(described?.body).toContain('data:image/webp;base64,');
      expect(described?.body).toContain(DEFAULT_MODELS.agents.model);
    });
  });

  it('refuses a still with no image yet, and a path that isn’t a still', async () => {
    served();
    setupStills(adapter, pictures);

    await inHome(async () => {
      await write('~/People/Empty.still', {
        type: 'still',
        attempts: [],
        chosen: '',
      } as never);
      await expect(stillDescribe('~/People/Empty.still', { type: 'subject' })).rejects.toThrow('no image to describe');
      await expect(stillDescribe('~/People/Ayla.png', { type: 'face' })).rejects.toThrow('needs a .still');
    });
  });
});

describe('sys.image.generate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws one image with Wedyan’s image model and gives the agent its path in the drive', async () => {
    mockHosts({
      'https://api.meta.test/v1/images/generations': () =>
        new Response(JSON.stringify({ created: 1, data: [{ url: 'https://cdn.test/3.webp' }] })),
      'https://cdn.test/': webp,
    });
    const spied = vi.mocked(globalThis.fetch);
    const adapter = new AIAdapter()
      .use(new MuseDriver({ apiKey: 'k', baseUrl: 'https://api.meta.test/v1' }))
      .use(new DriveDriver());

    await inHome(async () => {
      const result = (await generateImage(adapter)({
        prompt: 'Mira, an old lantern maker, face',
        saveTo: '~/Motions/Lantern River/People',
        aspect: '1:1',
      })) as { path: string };

      expect(result.path).toMatch(/^~\/Motions\/Lantern River\/People\/.+\.webp$/);
      expect(await exists(result.path)).toBe(true);
      const [, init] = spied.mock.calls.find(([input]) => String(input).endsWith('/images/generations')) ?? [];
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: IMAGE_MODEL,
        prompt: 'Mira, an old lantern maker, face',
      });
    });
  });

  it('refuses a still that isn’t one, drawing nothing', async () => {
    const fetched = mockHosts({});
    const generate = setupStills(new AIAdapter().use(new DriveDriver()), pictures);
    const ask = { agent: KAI, desktop: async () => undefined };

    expect(await generate({ path: '~/People/Ayla/Head.png', prompt: 'A face' }, ask)).toMatchObject({
      error: expect.any(String),
    });
    expect(await generate({ path: '~/People/Ayla/Head.still' }, ask)).toMatchObject({
      error: 'A new still needs a prompt',
    });
    expect(fetched).toEqual([]);
  });

  it('refuses without a folder in the home to keep it in, drawing nothing', async () => {
    const fetched = mockHosts({});
    const generate = generateImage(new AIAdapter().use(new DriveDriver()));

    expect(await generate({ prompt: 'A lantern', saveTo: '/elsewhere' })).toMatchObject({ error: expect.any(String) });
    expect(await generate({ prompt: 'A lantern' })).toMatchObject({ error: expect.any(String) });
    expect(fetched).toEqual([]);
  });
});
