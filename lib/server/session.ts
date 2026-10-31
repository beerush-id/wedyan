import { decodeCookies, setCookieContext, withContext } from '@airlib/react';
import type { FsContext } from '@irpclib/r2-file/context';
import { userSession } from '@/lib/share/cookie.js';

/** A session id is a UUID; anything else is refused, since it becomes part of a path. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How long a short id is, in hex: 64 bits, far past any collision among a demo's visitors. */
const SHORT_ID_LENGTH = 16;

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
 * The public name of a session's user: what its home, its Durable Object, its live calls and its
 * mail address go by. The session id is the login, so it's never used for any of those. One way, so
 * knowing the name gives nothing back, and hex, so it survives an email address's lowercasing.
 *
 * @param session - The session id.
 * @returns The user's short id.
 */
export async function shortIdOf(session: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(session));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, SHORT_ID_LENGTH);
}

/**
 * The user a request belongs to, from its cookie, for code that runs before any call's scope does.
 *
 * @param request - The request.
 * @returns The user's short id, or undefined without a valid session.
 */
export async function userOf(request: Request): Promise<string | undefined> {
  const session = await withContext(() => {
    setCookieContext(decodeCookies(request.headers.get('cookie') ?? ''));
    return currentSession();
  });
  return session ? shortIdOf(session) : undefined;
}

/**
 * A user's filesystem scope: their own home, and no access outside it.
 *
 * @param user - The user's short id.
 * @returns The scope to set as `fsContext`.
 */
export function homeOf(user: string): FsContext {
  return { ownerId: user, homeDir: `/users/${user}`, accessRules: [] };
}
