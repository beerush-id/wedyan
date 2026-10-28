import { createContextStore, withContext } from '@irpclib/irpc';
import { COOKIE_JAR_WRITABLE, decodeCookies, setCookieContext, setScope } from '@irpclib/irpc/core';
import { describe, expect, it } from 'vitest';
import { currentSession, homeOf } from '../../lib/server/session.js';
import { userSession } from '../../lib/share/cookie.js';

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

  it('confines a session to its own home, and nothing outside it', () => {
    expect(homeOf(ID)).toEqual({ ownerId: ID, homeDir: `/users/${ID}`, accessRules: [] });
  });
});
