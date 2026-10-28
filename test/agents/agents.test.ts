import { mutable } from '@airlib/react';
import { AIAdapter, OpenAIDriver } from '@irpclib/ai-kit/worker';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgents, ENTRY } from '../../lib/agents/index.js';
import type { AskState } from '../../lib/kernel/agent.h.js';
import { runAgentLoop } from '../../lib/kernel/agent.js';
import { calls, mockVendor, says } from '../kernel/vendor.js';

const AGENTS = createAgents({ router: { model: 'router-m', effort: 'minimal' }, agents: { model: 'agents-m' } });

/** The provider's tool-name rule once the driver has encoded dots: letters, digits, _, - and one dot. */
const PROVIDER_NAME = /^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)?$/;

describe('agents', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts every ask at an agent that exists', () => {
    expect(AGENTS[ENTRY]).toBeDefined();
  });

  it('hands off only to agents that exist, never to itself', () => {
    for (const agent of Object.values(AGENTS)) {
      for (const target of agent.handoffs ?? []) {
        expect(AGENTS[target], `${agent.name} → ${target}`).toBeDefined();
        expect(target).not.toBe(agent.name);
      }
    }
  });

  it('lets the router reach every specialist', () => {
    const specialists = Object.keys(AGENTS).filter((name) => name !== ENTRY);
    expect([...(AGENTS[ENTRY].handoffs ?? [])].sort()).toEqual(specialists.sort());
  });

  it('gives each agent unique tool names the provider accepts once encoded', () => {
    for (const agent of Object.values(AGENTS)) {
      const names = agent.tools.map((tool) => tool.name);
      expect(new Set(names).size, agent.name).toBe(names.length);
      for (const name of names) expect(name.replace(/\./g, '__'), name).toMatch(PROVIDER_NAME);
    }
  });

  it('gives each kind of agent its model and effort', () => {
    expect(AGENTS.router).toMatchObject({ model: 'router-m', effort: 'minimal' });
    expect(AGENTS.lita.model).toBe('agents-m');
    expect(AGENTS.lita.effort).toBeUndefined();
  });

  it('teaches every agent the response format', () => {
    for (const agent of Object.values(AGENTS)) {
      expect(agent.system, agent.name).toContain('[[say]]');
      expect(agent.system, agent.name).toContain('never that it is done');
    }
  });

  it('routes a photo ask to the photos agent, which then works with its own prompt and tools', async () => {
    const vendor = mockVendor(
      calls({ id: 'h1', name: 'handoff', args: { agent: 'photos', brief: 'Find the cat photo.' } }),
      says('[[say]]Here it is.[[/say]]'),
    );
    const state = mutable<AskState>({ status: 'idle', agent: '', turn: 0, parts: [] });
    const adapter = new AIAdapter().use(
      new OpenAIDriver({
        name: 'meta',
        baseUrl: 'https://api.meta.test/v1',
        apiKey: 'k',
        models: ['router-m', 'agents-m'],
      }),
    );

    await runAgentLoop({
      adapter,
      agents: AGENTS,
      entry: ENTRY,
      input: 'Find my cat photo',
      state,
      resolve: async () => undefined,
    });

    const toolNames = (body: Record<string, unknown>) =>
      ((body.tools as Array<{ function: { name: string } }>) ?? []).map((tool) => tool.function.name);
    expect(vendor.bodies[0]).toMatchObject({ model: 'router-m' });
    expect(toolNames(vendor.bodies[0])).toEqual(['handoff']);
    expect(vendor.bodies[1]).toMatchObject({ model: 'agents-m' });
    expect(toolNames(vendor.bodies[1])).toContain('sys__photos__search');
    expect(state).toMatchObject({ status: 'done', agent: 'photos' });
  });
});
