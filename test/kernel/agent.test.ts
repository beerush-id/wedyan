import { mutable, withContext } from '@airlib/react';
import type { ToolCall } from '@irpclib/ai-kit';
import type { IRPCData } from '@irpclib/irpc';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskAction } from '../../lib/kernel/agent.h.js';
import { type AgentLoopOptions, type AskState, type LoopSnapshot, runAgentLoop } from '../../lib/kernel/agent.js';
import { AGENTS, createTestAdapter } from './fixtures.js';
import { calls, messagesOf, mockVendor, responses, says, sse, toolCall } from './vendor.js';

// Only the model provider is mocked. The adapter, driver, parser, writer and loop all run for real.

/** Each part as one line: its text, or the widget's role. */
const partsOf = (state: AskState) => state.parts.map((part) => (part.type === 'text' ? part.text : part.role));

function setup(overrides: Partial<AgentLoopOptions> = {}) {
  const adapter = createTestAdapter();
  const state = mutable<AskState>({ status: 'idle', agent: '', turn: 0, parts: [] });
  const resolved: ToolCall[] = [];
  const results: Record<string, IRPCData | undefined> = { 'sys.fs.read': { content: 'hello' } };
  const options = {
    adapter,
    agents: AGENTS,
    entry: 'router',
    input: 'Read my note',
    state,
    resolve: async (call: ToolCall) => {
      resolved.push(call);
      return results[call.name];
    },
    ...overrides,
  };
  // Each run gets its own context, so the loop's subscriptions never leak into other tests.
  return { state, resolved, run: () => withContext(() => runAgentLoop(options)) };
}

describe('agent loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ends after a turn without calls, streaming the answer into parts', async () => {
    const vendor = mockVendor(
      says('[[say]]Hello.[[/say]] [[widget]]{"role":"status","props":', '{"label":"ok"}}[[/widget]] Done.'),
    );
    const { state, run } = setup();

    await run();

    expect(state).toMatchObject({ status: 'done', agent: 'router', turn: 1 });
    expect(state.parts).toEqual([
      { type: 'text', chunks: ['Hello.'], text: 'Hello.', spoken: true },
      { type: 'widget', role: 'status', props: { label: 'ok' } },
      { type: 'text', chunks: ['Done.'], text: 'Done.', spoken: false },
    ]);
    expect(vendor.bodies[0]).toMatchObject({ model: 'router-m' });
    expect(messagesOf(vendor.bodies, 0)).toEqual([
      { role: 'system', content: 'Route.' },
      { role: 'user', content: 'Read my note' },
    ]);
  });

  it("sends the agent's reasoning effort with its turn", async () => {
    const vendor = mockVendor(says('Hi.'));
    const { run } = setup({ agents: { ...AGENTS, router: { ...AGENTS.router, effort: 'minimal' } } });

    await run();

    expect(vendor.bodies[0].reasoning_effort).toBe('minimal');
  });

  it('offers handoff only to the agents the profile names', async () => {
    const vendor = mockVendor(says('Hi.'));
    const { run } = setup();

    await run();

    const tools = vendor.bodies[0].tools as Array<{ function: { name: string; parameters: Record<string, unknown> } }>;
    expect(tools.map((tool) => tool.function.name)).toEqual(['handoff']);
    expect(tools[0].function.parameters).toMatchObject({
      properties: { agent: { enum: ['assistant', 'photos'] } },
      required: ['agent', 'brief'],
    });
  });

  it('resolves a call and feeds its result back on the next turn', async () => {
    const vendor = mockVendor(
      calls({ id: 'c1', name: 'sys__fs__read', args: { path: '~/note.txt' } }),
      says('It says hello.'),
    );
    const { state, resolved, run } = setup({ entry: 'assistant' });

    await run();

    expect(resolved).toEqual([{ id: 'c1', name: 'sys.fs.read', args: { path: '~/note.txt' } }]);
    expect(messagesOf(vendor.bodies, 1).slice(2)).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'sys__fs__read', arguments: '{"path":"~/note.txt"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"content":"hello"}' },
    ]);
    expect(state).toMatchObject({ status: 'done', turn: 2 });
    expect(partsOf(state)).toEqual(['It says hello.']);
  });

  it('tells the model when a call has no answer or fails, and keeps going', async () => {
    const vendor = mockVendor(
      calls({ id: 'c1', name: 'app__photos__open', args: {} }, { id: 'c2', name: 'sys__fs__read', args: {} }),
      says('Sorry.'),
    );
    const { state, run } = setup({
      entry: 'assistant',
      resolve: async (call: ToolCall) => {
        if (call.name === 'sys.fs.read') throw new Error('No such file');
        return undefined;
      },
    });

    await run();

    expect(messagesOf(vendor.bodies, 1).slice(3)).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: '{"error":"not available"}' },
      { role: 'tool', tool_call_id: 'c2', content: '{"error":"No such file"}' },
    ]);
    expect(state.status).toBe('done');
  });

  describe('skills', () => {
    /** A router that may hand to a specialist, who takes a skill at handoff. */
    const SKILLED: AgentLoopOptions['agents'] = {
      router: { name: 'router', model: 'router-m', system: 'Route.', tools: [], handoffs: ['specialist'] },
      specialist: {
        name: 'specialist',
        model: 'photos-m',
        system: 'Specialize.',
        tools: [{ name: 'sys.memory.recall', description: 'Recalls' }],
        handoffs: ['router'],
        skilled: true,
      },
    };
    const SKILLS: AgentLoopOptions['skills'] = {
      photos: {
        name: 'photos',
        description: 'Find and edit photos.',
        system: 'Use the photo tools.',
        tools: [{ name: 'sys.photos.search', description: 'Finds photos' }],
      },
      motions: { name: 'motions', description: 'Edit Motion projects.', system: 'Use Motion.', tools: [] },
    };
    type Tool = { function: { name: string; parameters: Record<string, unknown> } };

    it('offers the skills by name on the handoff', async () => {
      const vendor = mockVendor(says('Hi.'));
      const { run } = setup({ agents: SKILLED, skills: SKILLS });

      await run();

      const [handoff] = vendor.bodies[0].tools as Tool[];
      expect(handoff.function.parameters).toMatchObject({
        properties: { agent: { enum: ['specialist'] }, skill: { enum: ['photos', 'motions'] } },
      });
    });

    it('composes the skilled agent from its base and the skill it was handed', async () => {
      const vendor = mockVendor(
        calls({ id: 'h1', name: 'handoff', args: { agent: 'specialist', skill: 'photos', brief: 'Find the cat.' } }),
        says('Here it is.'),
      );
      const { state, run } = setup({ agents: SKILLED, skills: SKILLS });

      await run();

      expect(state).toMatchObject({ status: 'done', agent: 'specialist', skill: 'photos' });
      expect(messagesOf(vendor.bodies, 1)[0]).toEqual({
        role: 'system',
        content: 'Specialize.\n\nUse the photo tools.',
      });
      expect((vendor.bodies[1].tools as Tool[]).map((tool) => tool.function.name)).toEqual([
        'sys__memory__recall',
        'sys__photos__search',
        'handoff',
      ]);
    });

    it('refuses a handoff to a skilled agent without a skill it knows', async () => {
      const vendor = mockVendor(
        calls({ id: 'h1', name: 'handoff', args: { agent: 'specialist', skill: 'mail', brief: 'Read mail.' } }),
        says('I can answer that myself.'),
      );
      const { state, run } = setup({ agents: SKILLED, skills: SKILLS });

      await run();

      expect(state.agent).toBe('router');
      expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'h1',
        content: JSON.stringify({ error: 'specialist needs a skill: one of photos, motions' }),
      });
    });

    it('resumes a skilled agent with its skill', async () => {
      const vendor = mockVendor(says('Done.'));
      const resume: LoopSnapshot = {
        agent: 'specialist',
        skill: 'motions',
        history: [{ role: 'user', type: 'text', text: 'Cut it' }],
        asks: [{ role: 'user', type: 'text', text: 'Cut it' }],
        turn: 1,
        handoffs: 1,
      };
      const { run } = setup({ agents: SKILLED, skills: SKILLS, resume });

      await run();

      expect(messagesOf(vendor.bodies, 0)[0]).toEqual({ role: 'system', content: 'Specialize.\n\nUse Motion.' });
    });
  });

  it('adds the user’s persona to every agent’s system prompt', async () => {
    const vendor = mockVendor(
      calls({ id: 'h1', name: 'handoff', args: { agent: 'photos', brief: 'Find the cat.' } }),
      says('Here it is.'),
    );
    const { run } = setup({ persona: 'You are Mira.' });

    await run();

    expect(messagesOf(vendor.bodies, 0)[0]).toEqual({ role: 'system', content: 'Route.\n\nYou are Mira.' });
    expect(messagesOf(vendor.bodies, 1)[0]).toEqual({ role: 'system', content: 'Photos.\n\nYou are Mira.' });
  });

  it('hands off inside the same call, giving the next agent the brief and results, not the reasoning', async () => {
    const vendor = mockVendor(
      calls(
        { id: 'c1', name: 'sys__fs__read', args: { path: '~/note.txt' } },
        { id: 'c2', name: 'handoff', args: { agent: 'photos', brief: 'Find the cat photo.' } },
      ),
      says('Here is the cat.'),
    );
    const { state, resolved, run } = setup({ entry: 'assistant' });

    await run();

    expect(resolved.map((call) => call.name)).toEqual(['sys.fs.read']);
    expect(state).toMatchObject({ status: 'done', agent: 'photos', turn: 2 });
    expect(partsOf(state)).toEqual(['Here is the cat.']);
    expect(vendor.bodies[1]).toMatchObject({ model: 'photos-m' });
    expect(messagesOf(vendor.bodies, 1)).toEqual([
      { role: 'system', content: 'Photos.' },
      { role: 'user', content: 'Read my note' },
      {
        role: 'user',
        content: JSON.stringify({
          handoff: {
            from: 'assistant',
            brief: 'Find the cat photo.',
            results: [{ name: 'sys.fs.read', args: { path: '~/note.txt' }, result: { content: 'hello' } }],
          },
        }),
      },
    ]);
  });

  it('refuses a handoff to an agent the profile does not name', async () => {
    const vendor = mockVendor(calls({ id: 'c1', name: 'handoff', args: { agent: 'router', brief: 'x' } }), says('OK.'));
    const { state, run } = setup({ entry: 'assistant' });

    await run();

    expect(state.agent).toBe('assistant');
    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '{"error":"Cannot hand off to router"}',
    });
  });

  it('stops passing the ask around after the handoff limit', async () => {
    const vendor = mockVendor(
      calls({ id: 'c1', name: 'handoff', args: { agent: 'assistant', brief: 'a' } }),
      calls({ id: 'c2', name: 'handoff', args: { agent: 'photos', brief: 'b' } }),
      says('Done here.'),
    );
    const { state, run } = setup({ limits: { handoffs: 1 } });

    await run();

    expect(state.agent).toBe('assistant');
    expect(messagesOf(vendor.bodies, 2).at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'c2',
      content: '{"error":"Handoff limit reached"}',
    });
    expect(state.status).toBe('done');
  });

  it('injects follow-ups at the safe turn, after the tool results', async () => {
    const vendor = mockVendor(calls({ id: 'c1', name: 'sys__fs__read', args: {} }), says('Both done.'));
    const queue = ['Also open my mail.'];
    const { run } = setup({ entry: 'assistant', followUps: () => queue.splice(0) });

    await run();

    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({ role: 'user', content: 'Also open my mail.' });
  });

  it('keeps going when a follow-up arrives during the final turn', async () => {
    const vendor = mockVendor(says('Opening it.'), says('And the mail.'));
    const queue: string[] = [];
    let turns = 0;
    const { state, run } = setup({
      followUps: () => {
        turns += 1;
        if (turns === 1) queue.push('And my mail.');
        return queue.splice(0);
      },
    });

    await run();

    expect(messagesOf(vendor.bodies, 1).slice(-2)).toEqual([
      { role: 'assistant', content: 'Opening it.' },
      { role: 'user', content: 'And my mail.' },
    ]);
    expect(state).toMatchObject({ status: 'done', turn: 2 });
    expect(partsOf(state)).toEqual(['Opening it.', 'And the mail.']);
  });

  it('keeps the parts of every turn, in order', async () => {
    mockVendor(
      sse([{ content: '[[show]]a[[/show]]' }, { tool_calls: [toolCall('c1', 'sys__fs__read', {})] }], 'tool_calls'),
      says('[[show]]b[[/show]]'),
    );
    const { state, run } = setup({ entry: 'assistant' });

    await run();

    expect(partsOf(state)).toEqual(['a', 'b']);
  });

  it('runs actions one at a time, in order, each anchored after the part before it', async () => {
    mockVendor(
      says(
        '[[say]]Let me open Photos[[/say]][[action name=app.open]]{"app":"photos"}[[/action]]',
        '[[say]]then Motion.[[/say]][[action name=app.open]]{"app":"motion"}[[/action]]',
        '[[action name=desktop.tile]]{"windows":["photos","motion"]}[[/action]]',
      ),
    );
    const log: string[] = [];
    const { state, run } = setup({
      act: async (action: AskAction) => {
        log.push(`start ${action.name} ${JSON.stringify(action.args)} after ${action.after}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        log.push(`end ${action.name}`);
        return { ok: true };
      },
    });

    await run();

    expect(log).toEqual([
      'start app.open {"app":"photos"} after 0',
      'end app.open',
      'start app.open {"app":"motion"} after 1',
      'end app.open',
      'start desktop.tile {"windows":["photos","motion"]} after 1',
      'end desktop.tile',
    ]);
    expect(state.status).toBe('done');
  });

  it('ends the ask only after its actions have run', async () => {
    mockVendor(says('[[say]]Opening.[[/say]][[action name=app.open]]{}[[/action]]'));
    let finish: (() => void) | undefined;
    const { state, run } = setup({
      act: () =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true });
        }),
    });

    const running = run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.status).toBe('running');

    finish?.();
    await running;
    expect(state.status).toBe('done');
  });

  it('treats an action nothing answers as a no-op', async () => {
    const vendor = mockVendor(says('[[action name=app.open]]{}[[/action]]Done.'));
    const { state, run } = setup({ act: async () => undefined });

    await run();

    expect(vendor.spy).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('done');
  });

  it('skips the rest of the turn after a failed action and tells the model on the next turn', async () => {
    const vendor = mockVendor(
      says(
        '[[action name=app.open]]{"app":"motion"}[[/action]]',
        '[[action name=desktop.tile]]{}[[/action]][[say]]Tiled.[[/say]]',
      ),
      says("[[say]]Motion isn't installed.[[/say]]"),
    );
    const ran: string[] = [];
    const { state, run } = setup({
      act: async (action: AskAction) => {
        ran.push(action.name);
        if (action.name === 'app.open') throw new Error('Motion is not installed');
        return { ok: true };
      },
    });

    await run();

    expect(ran).toEqual(['app.open']);
    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'user',
      content: JSON.stringify({
        feedback: {
          actions: [
            { action: 'app.open', args: { app: 'motion' }, error: 'Motion is not installed' },
            { action: 'desktop.tile', args: {}, skipped: true },
          ],
        },
      }),
    });
    expect(state).toMatchObject({ status: 'done', turn: 2 });
  });

  it('does not run a call written as an action, and tells the model to call it', async () => {
    const vendor = mockVendor(
      says('[[say]]Reading it.[[/say]][[action name=sys.fs.read]]{"path":"~/script.md"}[[/action]]'),
      says('[[say]]Calling it properly now.[[/say]]'),
    );
    const acted: string[] = [];
    const { state, run } = setup({
      entry: 'assistant',
      act: async (action: AskAction) => {
        acted.push(action.name);
        return { ok: true };
      },
    });

    await run();

    expect(acted).toEqual([]);
    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'user',
      content: JSON.stringify({
        feedback: { invalid: ['sys.fs.read is a call, not an action: call it as a tool to get its result'] },
      }),
    });
    expect(state).toMatchObject({ status: 'done', turn: 2 });
  });

  it('tells the model about a malformed widget on the next turn', async () => {
    const vendor = mockVendor(says('[[widget]]{"title":"x"}[[/widget]]'), says('Fixed.'));
    const { state, run } = setup();

    await run();

    expect(messagesOf(vendor.bodies, 1).at(-1)).toEqual({
      role: 'user',
      content: JSON.stringify({
        feedback: { invalid: ['A widget needs a JSON object with a "role"; got: {"title":"x"}'] },
      }),
    });
    expect(state).toMatchObject({ status: 'done', turn: 2 });
  });

  it('stops while waiting on actions when the call is aborted', async () => {
    mockVendor(says('[[action name=app.open]]{}[[/action]]'));
    const controller = new AbortController();
    const { state, run } = setup({
      signal: controller.signal,
      act: () => {
        controller.abort();
        return new Promise(() => {});
      },
    });

    await run();

    expect(state).toMatchObject({ status: 'stopped', reason: 'Aborted' });
  });

  it('stops at the turn limit', async () => {
    mockVendor(
      calls({ id: 'c1', name: 'sys__fs__read', args: {} }),
      calls({ id: 'c2', name: 'sys__fs__read', args: {} }),
    );
    const { state, run } = setup({ entry: 'assistant', limits: { turns: 2 } });

    await run();

    expect(state).toMatchObject({ status: 'stopped', reason: 'Turn limit reached', turn: 2 });
  });

  it('stops when the call is aborted, passing the signal to the provider', async () => {
    const controller = new AbortController();
    const vendor = mockVendor(calls({ id: 'c1', name: 'sys__fs__read', args: {} }));
    const { state, run } = setup({
      entry: 'assistant',
      signal: controller.signal,
      resolve: async () => {
        controller.abort();
        return { content: 'x' };
      },
    });

    await run();

    expect(vendor.spy.mock.calls[0][1]?.signal).toBe(controller.signal);
    expect(state).toMatchObject({ status: 'stopped', reason: 'Aborted', turn: 1 });
  });

  it('reports an error when no driver serves the agent model', async () => {
    const vendor = mockVendor();
    const { state, run } = setup({
      agents: { ...AGENTS, router: { ...AGENTS.router, model: 'unknown-m' } },
    });

    await run();

    expect(vendor.spy).not.toHaveBeenCalled();
    expect(state).toMatchObject({ status: 'error', reason: 'No answer from unknown-m' });
  });

  it('treats commentary written without calls as the answer', async () => {
    mockVendor(responses({ text: '[[say]]Morning, Nanang.[[/say]]', phase: 'commentary' }));
    const { state, run } = setup({ adapter: createTestAdapter('responses') });

    await run();

    expect(state.status).toBe('done');
    expect(state.parts).toEqual([
      { type: 'text', chunks: ['Morning, Nanang.'], text: 'Morning, Nanang.', spoken: true },
    ]);
  });

  it('keeps commentary out of the answer when the turn makes calls', async () => {
    mockVendor(
      responses(
        { text: 'Routing this.', phase: 'commentary' },
        { call: { id: 'h1', name: 'handoff', args: { agent: 'photos', brief: 'Find the cat.' } } },
      ),
      responses({ text: '[[say]]Found it.[[/say]]' }),
    );
    const { state, run } = setup({ adapter: createTestAdapter('responses') });

    await run();

    expect(state).toMatchObject({ status: 'done', agent: 'photos' });
    expect(partsOf(state)).toEqual(['Found it.']);
  });

  it('retries an empty turn once', async () => {
    const vendor = mockVendor(responses(), responses({ text: '[[say]]Here.[[/say]]' }));
    const { state, run } = setup({ adapter: createTestAdapter('responses') });

    await run();

    expect(vendor.spy).toHaveBeenCalledTimes(2);
    expect(state).toMatchObject({ status: 'done', turn: 1 });
    expect(partsOf(state)).toEqual(['Here.']);
  });

  it('ends with a reason when the retry is empty too', async () => {
    mockVendor(responses(), responses());
    const { state, run } = setup({ adapter: createTestAdapter('responses') });

    await run();

    expect(state).toMatchObject({ status: 'error', reason: 'No answer from router-m' });
  });

  it('reports a provider failure as an error', async () => {
    mockVendor(new Response('down', { status: 503 }));
    const { state, run } = setup();

    await run();

    expect(state).toMatchObject({ status: 'error', reason: 'meta chat request failed: 503' });
  });

  it('snapshots after each turn and resumes from a snapshot', async () => {
    mockVendor(calls({ id: 'c1', name: 'sys__fs__read', args: {} }), says('Done.'));
    const snapshots: LoopSnapshot[] = [];
    const first = setup({ entry: 'assistant', onSnapshot: (snapshot: LoopSnapshot) => snapshots.push(snapshot) });
    await first.run();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({ agent: 'assistant', turn: 1, handoffs: 0 });

    const vendor = mockVendor(says('Resumed.'));
    const second = setup({ entry: 'router', resume: snapshots[0] });
    await second.run();

    expect(second.state).toMatchObject({ status: 'done', agent: 'assistant', turn: 2 });
    expect(vendor.bodies[0]).toMatchObject({ model: 'assistant-m' });
    expect(messagesOf(vendor.bodies, 0).at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '{"content":"hello"}',
    });
  });
});
