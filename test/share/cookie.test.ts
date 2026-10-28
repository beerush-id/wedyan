import { createContextStore, withContext } from '@irpclib/irpc';
import { COOKIE_JAR_WRITABLE, decodeCookies, setCookieContext, setScope } from '@irpclib/irpc/core';
import { describe, expect, it } from 'vitest';
import { issueSession, SESSION_COOKIE, userSession } from '../../lib/share/cookie.js';

/**
 * Runs inside a request carrying `cookie`, the way the HTTP router does: its cookie jar decoded
 * into the request's scope and writable.
 */
function inRequest<T>(cookie: string, fn: () => T): { result: T; setCookies: string[] } {
  let result: T | undefined;
  let setCookies: string[] = [];
  withContext(createContextStore(), () => {
    const jar = decodeCookies(cookie);
    setCookieContext(jar);
    setScope(COOKIE_JAR_WRITABLE, true);
    result = fn();
    setCookies = [...jar.encode()];
  });
  return { result: result as T, setCookies };
}

/** The `Set-Cookie` line for the session; AirLib names its cookies itself, so it's found by name. */
const sessionHeader = (setCookies: string[]) => setCookies.find((line) => line.includes(`${SESSION_COOKIE}=`));

const ID = '6f1d3c2a-8b4e-4f7a-9c1d-2e3f4a5b6c7d';
const STARTED = '2026-10-28T09:00:00.000Z';

describe('userSession', () => {
  it('starts empty, before a session is issued', () => {
    const { result } = inRequest('', () => ({ ...userSession() }));

    expect(result).toEqual({ id: '', started: '' });
  });

  it('issues the session as a cookie the browser keeps for 30 days', () => {
    const { setCookies } = inRequest('', () => {
      const session = userSession();
      session.id = ID;
      session.started = STARTED;
    });

    const header = sessionHeader(setCookies);
    expect(header).toBeDefined();
    expect(header).toMatch(/path=\//i);
    expect(header).toMatch(/samesite=lax/i);
    expect(header).toMatch(/secure/i);
    expect(header).toMatch(/max-age=2592000/i);
  });

  it('issues a session on the first visit, and keeps the one the browser already has', () => {
    const first = inRequest('', () => {
      issueSession();
      return { ...userSession() };
    });
    expect(first.result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(first.result.started)).not.toBeNaN();

    const pair = sessionHeader(first.setCookies)?.split(';')[0] ?? '';
    const next = inRequest(pair, () => {
      issueSession();
      return { ...userSession() };
    });
    expect(next.result).toEqual(first.result);
    expect(sessionHeader(next.setCookies)).toBeUndefined();
  });

  it('reads back, in the next request, the session the browser sends', () => {
    const { setCookies } = inRequest('', () => {
      const session = userSession();
      session.id = ID;
      session.started = STARTED;
    });
    const pair = sessionHeader(setCookies)?.split(';')[0] ?? '';

    const { result } = inRequest(pair, () => ({ ...userSession() }));

    expect(result).toEqual({ id: ID, started: STARTED });
  });
});
