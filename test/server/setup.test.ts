import { createContextStore, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { write } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAgents } from '../../lib/agents/index.js';
import { homeOf } from '../../lib/server/session.js';
import { loadPersona, loadUserAgents } from '../../lib/server/setup.js';

const AGENTS = createAgents();

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

  it('adds the user’s own agents from ~/Agents, skipping files that aren’t agents', async () => {
    const agents = await asSession(async () => {
      await write('~/Agents/Animation.agent', {
        type: 'agent',
        version: 1,
        id: 'animation',
        name: 'Kai',
        description: 'Animates titles and clips.',
        created: '…',
        updated: '…',
        author: { kind: 'user' },
        skills: ['motions'],
      });
      await write('~/Agents/Notes.agent', { type: 'memo' });
      await write('~/Agents/readme.txt', 'Not an agent.');
      return loadUserAgents(AGENTS);
    });

    expect(Object.keys(agents).filter((name) => !(name in AGENTS))).toEqual(['~/Agents/Animation.agent']);
    expect(agents.rita.handoffs).toContain('~/Agents/Animation.agent');
  });

  it('gives an agent the user’s own skills its file names, with only the tools and actions that exist', async () => {
    const agents = await asSession(async () => {
      await write('~/Skills/Teacher.skill', {
        type: 'skill',
        version: 1,
        id: 'teacher',
        name: 'Teacher',
        description: 'Explains a topic step by step.',
        created: '…',
        updated: '…',
        author: { kind: 'user' },
        instructions: '## How to teach\n\nOne idea at a time.',
        tools: ['r2-file.read', 'no.such.tool'],
        actions: ['app.open'],
      });
      await write('~/Agents/Editor.agent', {
        type: 'agent',
        version: 1,
        id: 'editor',
        name: 'Ivo',
        description: 'Edits each stage.',
        created: '…',
        updated: '…',
        author: { kind: 'user' },
        skills: ['motions', '../Skills/Teacher.skill', '../Skills/Missing.skill'],
      });
      return loadUserAgents(AGENTS);
    });

    const ivo = agents['~/Agents/Editor.agent'];
    expect(ivo.system).toContain('One idea at a time.');
    expect(ivo.system).toContain('app.open');
    const tools = ivo.tools.map((tool) => tool.name);
    expect(tools).toContain('r2-file.read');
    expect(tools).not.toContain('no.such.tool');
    // The user's own skills are their agents', never offered to Lita.
    expect(agents.rita.system).not.toContain('Explains a topic step by step.');
  });

  it('runs with Wedyan’s agents alone when there is no ~/Agents', async () => {
    expect(await asSession(() => loadUserAgents(AGENTS))).toBe(AGENTS);
  });
});
