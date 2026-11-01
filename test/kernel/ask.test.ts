import { HTTPTransport } from '@irpclib/http';
import { createPackage, getContext, IRPC_BASE_CONTEXT, IRPC_STORE, IRPCRouter, withContext } from '@irpclib/irpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askWedyan } from '../../lib/kernel/agent.h.js';
import { ACTOR_KEY, AGENT_ACTOR, setupKernel } from '../../lib/kernel/agent.js';
import { AGENTS, createTestAdapter } from './fixtures.js';
import { calls, messagesOf, mockVendor, says } from './vendor.js';

// askWedyan runs over real IRPC (stub and handler in one process). Only the model provider is mocked.

/** A package whose tools agents call by `files.<function>`, like r2-file's. */
const transport = new HTTPTransport({ endpoint: '/irpc' });
const files = createPackage({ name: 'files', version: '1.0.0' }).use(transport);
const read = files.declare<(path: string, options?: { encoding?: string }) => Promise<string>>('read', {
  mcp: { args: ['path', 'options'] },
});
const reads: unknown[][] = [];
/** Who each read ran as, for the server's guards. */
const actors: unknown[] = [];
files.construct(read, async (...args) => {
  reads.push(args);
  actors.push(getContext(ACTOR_KEY));
  return `content of ${args[0]}`;
});

describe('askWedyan', () => {
  beforeEach(() => {
    reads.length = 0;
    actors.length = 0;
    setupKernel({
      adapter: createTestAdapter(),
      agents: AGENTS,
      entry: 'assistant',
      composer: 'composer',
      routers: [new IRPCRouter(transport)],
      sys: { 'sys.fs.read': () => ({ content: 'hello' }) },
    });
  });

  it('loads the user’s persona for each ask and gives it to every agent', async () => {
    let loads = 0;
    setupKernel({
      adapter: createTestAdapter(),
      agents: AGENTS,
      entry: 'assistant',
      persona: async () => {
        loads += 1;
        return 'You are Mira.';
      },
    });
    const vendor = mockVendor(says('Hi.'));

    await withContext(() => askWedyan({ text: 'Hi' }));

    expect(loads).toBe(1);
    expect(messagesOf(vendor.bodies, 0)[0]).toEqual({ role: 'system', content: 'Assist.\n\nYou are Mira.' });
  });

  it('runs a package tool through its stub, with the model’s input as the function’s arguments', async () => {
    const vendor = mockVendor(
      calls({ id: 'c1', name: 'files__read', args: { options: { encoding: 'text' }, path: '~/a.txt' } }),
      says('Read.'),
    );
    const asked = vi.fn();

    await withContext(async () => {
      const call = askWedyan({ text: 'Read a' });
      call.answer('files.read', asked);
      await call;
    });

    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '"content of ~/a.txt"',
    });
    expect(reads).toEqual([['~/a.txt', { encoding: 'text' }]]);
    expect(asked).not.toHaveBeenCalled();
  });

  it('runs every tool call of an ask as the agent actor, for the server’s guards', async () => {
    mockVendor(calls({ id: 'c1', name: 'files__read', args: { path: '~/a.txt' } }), says('Read.'));

    await withContext(() => askWedyan({ text: 'Read a' }));

    expect(actors).toEqual([AGENT_ACTOR]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams the ask to the caller and settles when it ends', async () => {
    mockVendor(says('[[narrate]]Good ', 'morning.[[/narrate]]'));

    const final = await withContext(() => askWedyan({ text: 'Hi' }));

    expect(final).toMatchObject({ status: 'done', agent: 'assistant', turn: 1 });
    expect(final.parts).toEqual([{ type: 'text', chunks: ['Good morning.'], text: 'Good morning.', spoken: true }]);
  });

  it('asks the caller to run each action by name, with its anchor', async () => {
    mockVendor(says('[[narrate]]Opening Photos.[[/narrate]][[action name=app.open]]{"app":"photos"}[[/action]]'));
    const runs: unknown[] = [];

    const final = await withContext(async () => {
      const call = askWedyan({ text: 'Open Photos' });
      call.answer('app.open', (args: unknown, meta: unknown) => {
        runs.push([args, meta]);
        return { opened: true };
      });
      return await call;
    });

    expect(runs).toEqual([[{ app: 'photos' }, { after: 0, actor: 'wedyan' }]]);
    expect(final.status).toBe('done');
  });

  it('treats an action the caller does not answer as a no-op', async () => {
    const vendor = mockVendor(says('[[action name=app.open]]{}[[/action]]Done.'));

    const final = await withContext(() => askWedyan({ text: 'Open it' }));

    expect(vendor.spy).toHaveBeenCalledTimes(1);
    expect(final.status).toBe('done');
  });

  it('tells the model when the caller fails an action', async () => {
    const vendor = mockVendor(says('[[action name=app.open]]{"app":"motion"}[[/action]]'), says('Not installed.'));

    await withContext(async () => {
      const call = askWedyan({ text: 'Open Motion' });
      call.answer('app.open', () => {
        throw new Error('Motion is not installed');
      });
      await call;
    });

    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'user',
      content: JSON.stringify({
        feedback: { actions: [{ action: 'app.open', args: { app: 'motion' }, error: 'Motion is not installed' }] },
      }),
    });
  });

  it('sends the desktop context ahead of the words', async () => {
    const vendor = mockVendor(says('Closing it.'));

    await withContext(() => askWedyan({ text: 'Close this', context: { activeWindow: 'window-files-1' } }));

    expect(messagesOf(vendor.bodies, 0).slice(1)).toEqual([
      { role: 'user', content: '{"context":{"activeWindow":"window-files-1"}}' },
      { role: 'user', content: 'Close this' },
    ]);
  });

  it('resolves server calls without asking the caller', async () => {
    const vendor = mockVendor(calls({ id: 'c1', name: 'sys__fs__read', args: { path: '~/a' } }), says('Read.'));
    const asked = vi.fn();

    await withContext(async () => {
      const call = askWedyan({ text: 'Read a' });
      call.answer('sys.fs.read', asked);
      await call;
    });

    expect(asked).not.toHaveBeenCalled();
    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '{"content":"hello"}',
    });
  });

  it('never asks the caller for a tool call: tools are the server’s', async () => {
    const vendor = mockVendor(calls({ id: 'c1', name: 'app__photos__open', args: { album: 'cats' } }), says('No.'));
    const asked = vi.fn(() => ({ opened: true }));

    await withContext(async () => {
      const call = askWedyan({ text: 'Show my cats' });
      call.answer('app.photos.open', asked);
      await call;
    });

    expect(asked).not.toHaveBeenCalled();
    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '{"error":"not available"}',
    });
  });

  it('asks the user through the form the composer makes, and gives the model the form’s fields', async () => {
    const widget = { role: 'radio-group', bindings: [{ prop: 'value', state: '$this.choice', writable: true }] };
    const vendor = mockVendor(
      says('[[narrate]]Which one?[[/narrate]][[ask_user]]A choice named "choice" between orange and grey.[[/ask_user]]'),
      says(JSON.stringify(widget)),
      says('The orange one, then.'),
    );
    const forms: unknown[] = [];

    const final = await withContext(async () => {
      const call = askWedyan({ text: 'Delete the cat photo' });
      call.answer('ask_user', (form: unknown, meta: unknown) => {
        forms.push([form, meta]);
        return { choice: 'orange' };
      });
      return await call;
    });

    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'user',
      content: JSON.stringify({ form: 'A choice named "choice" between orange and grey.' }),
    });
    expect(forms).toEqual([[[widget], { after: 0, actor: 'wedyan' }]]);
    expect(messagesOf(vendor.bodies, 2).at(-1)).toEqual({
      role: 'user',
      content: JSON.stringify({ feedback: { asks: [{ ask: 'ask_user', reply: { choice: 'orange' } }] } }),
    });
    expect(final.status).toBe('done');
  });

  it('asks with a form of several nodes, as a list', async () => {
    const fields = [{ role: 'text-input' }, { role: 'switch' }];
    mockVendor(says('[[ask_user]]A name and a yes or no.[[/ask_user]]'), says(JSON.stringify(fields)), says('Thanks.'));
    const forms: unknown[] = [];

    await withContext(async () => {
      const call = askWedyan({ text: 'Ask me' });
      call.answer('ask_user', (form) => {
        forms.push(form);
        return { name: 'Ana', yes: true };
      });
      await call;
    });

    expect(forms).toEqual([fields]);
  });

  it('stops putting forms to the user when replies don’t help, and has the agent say what it needs', async () => {
    const form = () => says('[[ask_user]]A field named time.[[/ask_user]]');
    const composed = () => says('{"role":"text-input"}');
    const vendor = mockVendor(
      form(),
      composed(),
      form(),
      composed(),
      form(),
      composed(),
      form(),
      says('[[narrate]]I still need a time for it.[[/narrate]]'),
    );
    const asked = vi.fn(() => ({ time: 'whenever' }));

    await withContext(async () => {
      const call = askWedyan({ text: 'Set up a meeting' });
      call.answer('ask_user', asked);
      await call;
    });

    expect(asked).toHaveBeenCalledTimes(3);
    expect(vendor.bodies).toHaveLength(8);
    expect(JSON.stringify(messagesOf(vendor.bodies, 7).at(-1))).toContain('asked the user enough');
  });

  it('never asks the user with a form the composer couldn’t make, and tells the model', async () => {
    const vendor = mockVendor(
      says('[[ask_user]]A choice between orange and grey.[[/ask_user]]'),
      says('Pick one.'),
      says('Pick one, please.'),
      says('Sorry, which one?'),
    );
    vi.spyOn(IRPC_STORE, 'error').mockImplementation(() => {});
    const asked = vi.fn();

    await withContext(async () => {
      const call = askWedyan({ text: 'Delete the cat photo' });
      call.answer('ask_user', asked);
      await call;
    });

    expect(asked).not.toHaveBeenCalled();
    expect(messagesOf(vendor.bodies, 3).at(-1)).toEqual({
      role: 'user',
      content: JSON.stringify({
        feedback: {
          actions: [
            {
              action: 'ask_user',
              args: 'A choice between orange and grey.',
              error: 'The composer\'s answer isn\'t JSON: "Pick one, please."',
            },
          ],
        },
      }),
    });
  });

  it('asks an app by name and gives the model its reply', async () => {
    const vendor = mockVendor(
      says('[[ask_app name=app.photos.selection]]{"album":"cats"}[[/ask_app]]'),
      says('Two are selected.'),
    );

    await withContext(async () => {
      const call = askWedyan({ text: 'What did I select?' });
      call.answer('app.photos.selection', () => ['a.jpg', 'b.jpg']);
      await call;
    });

    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'user',
      content: JSON.stringify({
        feedback: { asks: [{ ask: 'app.photos.selection', args: { album: 'cats' }, reply: ['a.jpg', 'b.jpg'] }] },
      }),
    });
  });

  it('tells the model when nothing answers an ask', async () => {
    const vendor = mockVendor(says('[[ask_app name=app.mail.unread]]{}[[/ask_app]]'), says('No mail app.'));

    await withContext(() => askWedyan({ text: 'Any mail?' }));

    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'user',
      content: JSON.stringify({
        feedback: { asks: [{ ask: 'app.mail.unread', args: {}, error: 'not available' }] },
      }),
    });
  });

  it('tells the model a call is not available when the caller has no answer for it', async () => {
    const vendor = mockVendor(calls({ id: 'c1', name: 'app__mail__open', args: {} }), says('No mail app.'));

    const final = await withContext(() => askWedyan({ text: 'Open mail' }));

    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '{"error":"not available"}',
    });
    expect(final.status).toBe('done');
  });

  it('takes in a follow-up sent while the ask runs, at the next safe turn', async () => {
    const vendor = mockVendor(says('[[ask_app name=app.photos.selection]]{}[[/ask_app]]'), says('Both done.'));

    await withContext(async () => {
      const call = askWedyan({ text: 'Open photos' });
      call.answer('app.photos.selection', async () => {
        await call.ask('followUp', 'Also the mail.');
        return [];
      });
      await call;
    });

    expect(messagesOf(vendor.bodies, 1)).toContainEqual({ role: 'user', content: 'Also the mail.' });
  });

  it('stops the ask when the caller closes the call', async () => {
    const vendor = mockVendor(says('[[action name=app.photos.open]]{}[[/action]]'), says('Never sent.'));

    await withContext(async () => {
      const call = askWedyan({ text: 'Open photos' });
      call.answer('app.photos.open', () => {
        call.close();
        return { opened: true };
      });
      await call;
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(vendor.spy).toHaveBeenCalledTimes(1);
  });

  it('stops the ask when the call is aborted', async () => {
    const vendor = mockVendor(says('[[action name=app.photos.open]]{}[[/action]]'), says('Never sent.'));
    const controller = new AbortController();

    await withContext([[IRPC_BASE_CONTEXT.ABORT_SIGNAL, controller.signal]], async () => {
      const call = askWedyan({ text: 'Open photos' });
      call.answer('app.photos.open', () => {
        controller.abort();
        return { opened: true };
      });
      await call;
    });

    expect(vendor.spy).toHaveBeenCalledTimes(1);
  });
});
