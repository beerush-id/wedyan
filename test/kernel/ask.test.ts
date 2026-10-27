import { IRPC_BASE_CONTEXT, withContext } from '@irpclib/irpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askWedyan } from '../../lib/kernel/agent.h.js';
import { setupKernel } from '../../lib/kernel/agent.js';
import { AGENTS, createTestAdapter } from './fixtures.js';
import { calls, messagesOf, mockVendor, says } from './vendor.js';

// askWedyan runs over real IRPC (stub and handler in one process). Only the model provider is mocked.

describe('askWedyan', () => {
  beforeEach(() => {
    setupKernel({
      adapter: createTestAdapter(),
      agents: AGENTS,
      entry: 'assistant',
      sys: { 'sys.fs.read': () => ({ content: 'hello' }) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams the ask to the caller and settles when it ends', async () => {
    mockVendor(says('[[say]]Good ', 'morning.[[/say]]'));

    const final = await withContext(() => askWedyan({ text: 'Hi' }));

    expect(final).toMatchObject({ status: 'done', agent: 'assistant', turn: 1 });
    expect(final.parts).toEqual([{ type: 'text', chunks: ['Good morning.'], text: 'Good morning.', spoken: true }]);
  });

  it('asks the caller to run each action by name, with its anchor', async () => {
    mockVendor(says('[[say]]Opening Photos.[[/say]][[action name=app.open]]{"app":"photos"}[[/action]]'));
    const runs: unknown[] = [];

    const final = await withContext(async () => {
      const call = askWedyan({ text: 'Open Photos' });
      call.answer('app.open', (args: unknown, meta: unknown) => {
        runs.push([args, meta]);
        return { opened: true };
      });
      return await call;
    });

    expect(runs).toEqual([[{ app: 'photos' }, { after: 0 }]]);
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

  it('asks the caller for every other call, by its own name', async () => {
    const vendor = mockVendor(
      calls(
        { id: 'c1', name: 'app__photos__open', args: { album: 'cats' } },
        { id: 'c2', name: 'ask_user', args: { question: 'Which one?' } },
      ),
      says('Opened.'),
    );

    await withContext(async () => {
      const call = askWedyan({ text: 'Show my cats' });
      call.answer('app.photos.open', (args: { album: string }) => ({ opened: args.album }));
      call.answer('ask_user', () => 'The orange one');
      await call;
    });

    expect(messagesOf(vendor.bodies, 1).slice(-2)).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: '{"opened":"cats"}' },
      { role: 'tool', tool_call_id: 'c2', content: '"The orange one"' },
    ]);
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
    const vendor = mockVendor(calls({ id: 'c1', name: 'app__photos__open', args: {} }), says('Both done.'));

    await withContext(async () => {
      const call = askWedyan({ text: 'Open photos' });
      call.answer('app.photos.open', async () => {
        await call.ask('followUp', 'Also the mail.');
        return { opened: true };
      });
      await call;
    });

    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({ role: 'user', content: 'Also the mail.' });
  });

  it('stops the ask when the caller closes the call', async () => {
    const vendor = mockVendor(calls({ id: 'c1', name: 'app__photos__open', args: {} }), says('Never sent.'));

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
    const vendor = mockVendor(calls({ id: 'c1', name: 'app__photos__open', args: {} }), says('Never sent.'));
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
