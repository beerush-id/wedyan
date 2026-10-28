import { cookies } from '@airlib/react';

/** The visitor's session: who their files and memories belong to, and when it began. */
export interface UserSession {
  /** A random UUID, issued on the first page load; empty until then. */
  id: string;
  /** When the session was issued, as an ISO date, so an expired one can be cleaned up. */
  started: string;
}

/** The cookie the session lives in. */
export const SESSION_COOKIE = 'wedyan_session';

/** How long a session lasts in the browser: 30 days. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * The visitor's session cookie, the same on the page and on the server. Reading it parses the
 * cookie; writing it sets the cookie, through `Set-Cookie` on the server. Call it inside a request
 * scope: a route guard, `setup()`, or an IRPC handler.
 *
 * @returns The session, empty until one is issued.
 */
export function userSession(): UserSession {
  return cookies<UserSession>(
    SESSION_COOKIE,
    { id: '', started: '' },
    { path: '/', secure: true, sameSite: 'Lax', maxAge: SESSION_MAX_AGE },
  );
}

/**
 * Gives the visitor a session if they have none yet; one they already have is kept. Run by the
 * root route's guard, so the first page load sets the cookie before anything calls the server.
 */
export function issueSession(): void {
  const session = userSession();
  if (session.id) return;
  session.id = crypto.randomUUID();
  session.started = new Date().toISOString();
}
