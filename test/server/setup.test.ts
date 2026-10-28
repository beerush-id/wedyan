import { createContextStore, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { write } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { beforeAll, describe, expect, it } from 'vitest';
import { homeOf } from '../../lib/server/session.js';
import { loadPersona } from '../../lib/server/setup.js';

// r2-file runs for real on local R2 and D1.

/** Runs as a session unique to this run, in its own home. */
const asSession = <T>(fn: () => Promise<T>) =>
  withContext(createContextStore(), () => {
    fsContext.set(homeOf(crypto.randomUUID()));
    return fn();
  });

describe('server setup', () => {
  beforeAll(async () => {
    const env = await resolveBinding<{ BUCKET: never; DB: never }>(undefined, { remoteBindings: false });
    implement({ bucket: env.BUCKET, indexer: env.DB });
  });

  it('builds the persona from the session’s ~/profile.json', async () => {
    const persona = await asSession(async () => {
      await write('~/profile.json', { assistantName: 'Mira', userName: 'Nanang', persona: 'Calm and direct.' });
      return loadPersona();
    });

    expect(persona).toContain('You are Mira');
    expect(persona).toContain('Call the user Nanang.');
    expect(persona).toContain('Calm and direct.');
  });

  it('speaks as Wedyan when the session has no profile yet', async () => {
    const persona = await asSession(() => loadPersona());

    expect(persona).toContain('You are Wedyan');
  });
});
