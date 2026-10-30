import { createContextStore, SESSION_STORE, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import '../../lib/kernel/document.js';

// The server side of the document tests, in process: r2-file and the presence room for real on
// local R2 and D1.

const SESSION = 'document-test-session';

/** Sets up r2-file on local R2 and D1, and the session store, once per test file. */
export async function setupDocuments(): Promise<void> {
  const env = await resolveBinding<{ BUCKET: never; DB: never }>(undefined, { remoteBindings: false });
  implement({ bucket: env.BUCKET, indexer: env.DB });
  SESSION_STORE.key(SESSION);
}

/** Runs `fn` as one of a new user's desktops, in their session and home. */
export function asUser() {
  const user = `u-${crypto.randomUUID().slice(0, 8)}`;
  const session = crypto.randomUUID();
  return <T>(fn: () => Promise<T>) =>
    withContext(createContextStore([[SESSION, session]]), () => {
      fsContext.set({ ownerId: user, homeDir: `/users/${user}` });
      return fn();
    });
}
