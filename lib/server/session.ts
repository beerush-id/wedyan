import { decodeCookies, setCookieContext, withContext } from '@airlib/react';
import type { FsContext } from '@irpclib/r2-file/context';
import { userSession } from '@/lib/share/cookie.js';

/** A session id is a UUID; anything else is refused, since it becomes part of a path. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The session the current call runs for, from its session cookie.
 *
 * @returns The session id, or undefined without a valid one.
 */
export function currentSession(): string | undefined {
  const { id } = userSession();
  return SESSION_ID.test(id) ? id : undefined;
}

/**
 * The session a request belongs to, from its cookie, for code that runs before any call's scope does.
 *
 * @param request - The request.
 * @returns The session id, or undefined without a valid one.
 */
export function sessionOf(request: Request): Promise<string | undefined> {
  return withContext(() => {
    setCookieContext(decodeCookies(request.headers.get('cookie') ?? ''));
    return currentSession();
  });
}

/**
 * A session's filesystem scope: its own home, and no access outside it.
 *
 * @param session - The session id.
 * @returns The scope to set as `fsContext`.
 */
export function homeOf(session: string): FsContext {
  return { ownerId: session, homeDir: `/users/${session}`, accessRules: [] };
}
