import { createContextStore, withContext } from '@irpclib/irpc';
import { COOKIE_JAR_WRITABLE, decodeCookies, setCookieContext, setScope } from '@irpclib/irpc/core';
import { describe, expect, it, vi } from 'vitest';
import { currentSession, homeOf, shortIdOf, userOf } from '../../lib/server/session.js';
import { userSession } from '../../lib/share/cookie.js';
import { AirDurableLink, default as entry } from '../../server/worker.js';

// The Cloudflare entry alone: the built app behind it and Cloudflare's container class stand in.
const app = vi.hoisted(() => ({
  fetch: vi.fn(async (_request: Request, _env: unknown, _signal?: AbortSignal) => new Response('served')),
  isCall: (url: URL) => url.pathname.startsWith('/wrpc-'),
  userOf: (_request: Request): Promise<string | undefined> => Promise.resolve(undefined),
}));
vi.mock('../../dist/server/worker.js', () => ({ default: app }));
vi.mock('@cloudflare/containers', () => ({ Container: class {} }));

const ID = '6f1d3c2a-8b4e-4f7a-9c1d-2e3f4a5b6c7d';

/** The `Cookie` header a browser sends back after the session was issued with `id`. */
function cookieFor(id: string): string {
  let pair = '';
  withContext(createContextStore(), () => {
    const jar = decodeCookies('');
    setCookieContext(jar);
    setScope(COOKIE_JAR_WRITABLE, true);
    userSession().id = id;
    pair = [...jar.encode()][0]?.split(';')[0] ?? '';
  });
  return pair;
}

/** The session of a call carrying `cookie`, with its jar decoded the way the engine does it. */
function sessionWith(cookie: string): string | undefined {
  let session: string | undefined;
  withContext(createContextStore(), () => {
    setCookieContext(decodeCookies(cookie));
    session = currentSession();
  });
  return session;
}

describe('session', () => {
  it('reads the session from the call’s session cookie', () => {
    expect(sessionWith(cookieFor(ID))).toBe(ID);
  });

  it('has no session without the cookie, or with an id that is not a UUID', () => {
    expect(sessionWith('')).toBeUndefined();
    expect(sessionWith(cookieFor('../../admin'))).toBeUndefined();
  });

  it('confines a user to their own home, and nothing outside it', () => {
    expect(homeOf('a6f3')).toEqual({ ownerId: 'a6f3', homeDir: '/users/a6f3', accessRules: [] });
  });

  it('names a user apart from their session: the same each time, safe in an address, and one way', async () => {
    const user = await shortIdOf(ID);

    expect(await shortIdOf(ID)).toBe(user);
    expect(user).toMatch(/^[0-9a-f]{16}$/);
    expect(ID.replaceAll('-', '')).not.toContain(user);
    expect(await shortIdOf('7a2e4d3b-9c5f-4a8b-8d2e-3f4a5b6c7d8e')).not.toBe(user);
  });

  it('reads a request’s user before any call’s scope exists', async () => {
    const request = (cookie: string) => new Request('https://wedyan.test/', { headers: { cookie } });

    expect(await userOf(request(cookieFor(ID)))).toBe(await shortIdOf(ID));
    expect(await userOf(request(''))).toBeUndefined();
    expect(await userOf(request(cookieFor('../../admin')))).toBeUndefined();
  });
});

describe('the Cloudflare entry', () => {
  /** A Durable Object namespace that remembers which name each call was sent to. */
  function links() {
    const named: string[] = [];
    const forwarded: Request[] = [];
    const namespace = {
      idFromName: (name: string) => {
        named.push(name);
        return name;
      },
      get: () => ({
        fetch: async (request: Request) => {
          forwarded.push(request);
          return new Response('from the object');
        },
      }),
    };
    return { named, forwarded, env: { DURABLE_LINK: namespace } };
  }

  /** A request carrying `cookie` to a path. */
  const to = (path: string, cookie = '') => new Request(`https://wedyan.test${path}`, { headers: { cookie } });

  it('sends every call to the Durable Object named by its user, never by the session', async () => {
    app.userOf = userOf;
    const { named, forwarded, env } = links();

    const response = await entry.fetch(to('/wrpc-files', cookieFor(ID)), env);

    expect(await response.text()).toBe('from the object');
    expect(named).toEqual([await shortIdOf(ID)]);
    expect(forwarded).toHaveLength(1);
  });

  it('gives two sessions two objects', async () => {
    app.userOf = userOf;
    const OTHER = '7a2e4d3b-9c5f-4a8b-8d2e-3f4a5b6c7d8e';
    const { named, env } = links();

    await entry.fetch(to('/wrpc-files', cookieFor(ID)), env);
    await entry.fetch(to('/wrpc-files', cookieFor(OTHER)), env);

    expect(named).toEqual([await shortIdOf(ID), await shortIdOf(OTHER)]);
  });

  it('refuses a call without a session, reaching no object', async () => {
    app.userOf = userOf;
    const { named, env } = links();

    const response = await entry.fetch(to('/wrpc-files'), env);

    expect(response.status).toBe(401);
    expect(named).toEqual([]);
  });

  it('serves what isn’t a call on the worker', async () => {
    app.userOf = userOf;
    const { named, env } = links();

    const response = await entry.fetch(to('/images/~/cat.png?s=64', cookieFor(ID)), env);

    expect(await response.text()).toBe('served');
    expect(named).toEqual([]);
  });

  it('serves a call over HTTP inside the object, with the object’s bindings', async () => {
    app.fetch.mockClear();
    const env = { BUCKET: 'bucket' };
    const link = new AirDurableLink({}, env);

    const response = await link.fetch(to('/wrpc-files', cookieFor(ID)));

    expect(await response.text()).toBe('served');
    expect(app.fetch.mock.calls[0]?.[1]).toBe(env);
  });
});
