import { mutable, withContext } from '@airlib/react';
import { AIAdapter, OpenAIDriver } from '@irpclib/ai-kit/worker';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgents, ENTRY } from '../../lib/agents/index.js';
import { personaPrompt } from '../../lib/agents/persona.js';
import { parseSkill, SKILLS } from '../../lib/agents/skills.js';
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

  it('is three agents: Rita routes, Wendy assists, Lita works with a skill', () => {
    expect(Object.keys(AGENTS).sort()).toEqual(['lita', 'rita', 'wendy']);
    expect(ENTRY).toBe('rita');
    expect(AGENTS.rita.handoffs).toEqual(['wendy', 'lita']);
    expect(AGENTS.wendy.handoffs).toEqual(['lita']);
    expect(AGENTS.lita).toMatchObject({ skilled: true, handoffs: ['rita'] });
  });

  it('hands off only to agents that exist, never to itself', () => {
    for (const agent of Object.values(AGENTS)) {
      for (const target of agent.handoffs ?? []) {
        expect(AGENTS[target], `${agent.name} → ${target}`).toBeDefined();
        expect(target).not.toBe(agent.name);
      }
    }
  });

  it('gives each agent unique tool names the provider accepts once encoded', () => {
    for (const agent of [...Object.values(AGENTS), ...Object.values(SKILLS)]) {
      const names = agent.tools.map((tool) => tool.name);
      expect(new Set(names).size, agent.name).toBe(names.length);
      for (const name of names) expect(name.replace(/\./g, '__'), name).toMatch(PROVIDER_NAME);
    }
  });

  it('gives Wendy r2-file’s lookups as they are described, not a copy of them', () => {
    const files = AGENTS.wendy.tools.filter((tool) => tool.name.startsWith('r2-file.'));

    expect(files.map((tool) => tool.name).sort()).toEqual([
      'r2-file.list',
      'r2-file.read',
      'r2-file.search',
      'r2-file.stat',
    ]);
    for (const tool of files) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.parameters, tool.name).toMatchObject({ type: 'object', properties: { options: {} } });
    }
  });

  it('gives Wendy memory to save and recall, and Lita memory to recall, as the memory package describes them', () => {
    const memoryOf = (agent: (typeof AGENTS)[string]) =>
      agent.tools.filter((tool) => tool.name.startsWith('memory.')).map((tool) => tool.name);

    expect(memoryOf(AGENTS.wendy)).toEqual(['memory.recall', 'memory.save']);
    expect(memoryOf(AGENTS.lita)).toEqual(['memory.recall']);
    for (const agent of Object.values(AGENTS)) {
      expect(
        agent.tools.some((tool) => tool.name.startsWith('sys.memory.')),
        agent.name,
      ).toBe(false);
      expect(agent.system, agent.name).not.toContain('sys.memory.');
    }
  });

  it('gives each kind of agent its model and effort', () => {
    expect(AGENTS.rita).toMatchObject({ model: 'router-m', effort: 'minimal' });
    expect(AGENTS.wendy.model).toBe('agents-m');
    expect(AGENTS.lita.model).toBe('agents-m');
  });

  it('teaches every agent the response format', () => {
    for (const agent of Object.values(AGENTS)) {
      expect(agent.system, agent.name).toContain('[[say]]');
      expect(agent.system, agent.name).toContain('never that it is done');
    }
  });

  it('offers only system things as tools: the user and apps are reached by asks and actions', () => {
    for (const agent of [...Object.values(AGENTS), ...Object.values(SKILLS)]) {
      for (const tool of agent.tools) {
        expect(tool.name, agent.name).not.toMatch(/^(ask_user|app\.|desktop\.)/);
      }
    }
  });

  it('teaches the answering agents to ask the user through a widget bound to $this', () => {
    for (const agent of [AGENTS.wendy, AGENTS.lita]) {
      expect(agent.system, agent.name).toContain('[[ask_user]]');
      expect(agent.system, agent.name).toContain('$this.');
      expect(agent.system, agent.name).toContain('[[ask_app name=');
    }
  });

  it('shows Rita every skill by name and what it is for, and lets her answer obvious asks herself', () => {
    for (const skill of Object.values(SKILLS)) {
      expect(AGENTS.rita.system).toContain(`- ${skill.name}: ${skill.description}`);
    }
    expect(AGENTS.rita.system).toMatch(/answer.*yourself/i);
  });

  it('teaches every agent that a tool which returned an error did not happen', () => {
    for (const agent of Object.values(AGENTS)) {
      expect(agent.system, agent.name).toContain('returns an error, it did not happen');
    }
  });

  it('never names the agents to the user', () => {
    for (const agent of Object.values(AGENTS)) {
      expect(agent.system, agent.name).toContain('never mention');
    }
  });

  it('routes a photo ask to Lita with the photos skill, who then works with its prompt and tools', async () => {
    const vendor = mockVendor(
      calls({ id: 'h1', name: 'handoff', args: { agent: 'lita', skill: 'photos', brief: 'Find the cat photo.' } }),
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

    await withContext(() =>
      runAgentLoop({
        adapter,
        agents: AGENTS,
        entry: ENTRY,
        skills: SKILLS,
        input: 'Find my cat photo',
        state,
        resolve: async () => undefined,
      }),
    );

    const toolNames = (body: Record<string, unknown>) =>
      ((body.tools as Array<{ function: { name: string } }>) ?? []).map((tool) => tool.function.name);
    expect(vendor.bodies[0]).toMatchObject({ model: 'router-m' });
    expect(toolNames(vendor.bodies[0])).toEqual(['handoff']);
    expect(vendor.bodies[1]).toMatchObject({ model: 'agents-m' });
    expect(toolNames(vendor.bodies[1])).toContain('sys__photos__search');
    expect(state).toMatchObject({ status: 'done', agent: 'lita', skill: 'photos' });
  });
});

describe('skills', () => {
  it('reads one skill per app from its SKILL.md', () => {
    expect(Object.keys(SKILLS).sort()).toEqual(['motions', 'photos']);
    for (const skill of Object.values(SKILLS)) {
      expect(skill.description, skill.name).toBeTruthy();
      expect(skill.system, skill.name).toContain('Actions you can write:');
    }
    expect(SKILLS.photos.tools.map((tool) => tool.name)).toContain('sys.photos.search');
  });

  it('takes its name, description, tools and actions from the frontmatter, and its prompt from the body', () => {
    const skill = parseSkill(`---
name: notes
description: Keep notes.
tools: r2-file.read, memory.recall
actions: app.open
---
Write notes plainly.`);

    expect(skill).toMatchObject({ name: 'notes', description: 'Keep notes.' });
    expect(skill.tools.map((tool) => tool.name)).toEqual(['r2-file.read', 'memory.recall']);
    expect(skill.system).toContain('Write notes plainly.');
    expect(skill.system).toContain('- app.open');
  });

  it('refuses a skill without a name or description, or naming a tool or action that does not exist', () => {
    expect(() => parseSkill('---\ndescription: x\n---\nBody')).toThrow('A skill needs a name and a description');
    expect(() => parseSkill('---\nname: a\ndescription: x\ntools: sys.nope\n---\nBody')).toThrow(
      'Skill a names an unknown tool: sys.nope',
    );
    expect(() => parseSkill('---\nname: a\ndescription: x\nactions: app.nope\n---\nBody')).toThrow(
      'Skill a names an unknown action: app.nope',
    );
  });
});

describe('persona', () => {
  it('speaks as Wedyan unless the user named the assistant', () => {
    expect(personaPrompt()).toContain('You are Wedyan');
    expect(personaPrompt({ assistantName: 'Mira' })).toContain('You are Mira');
  });

  it('carries the user’s name, how to behave, and the refinements they asked for', () => {
    const prompt = personaPrompt({
      userName: 'Nanang',
      persona: 'Calm and direct.',
      refinements: ['No emoji.', 'Times in 24h.'],
    });

    expect(prompt).toContain('Call the user Nanang.');
    expect(prompt).toContain('Calm and direct.');
    expect(prompt).toContain('- No emoji.');
    expect(prompt).toContain('- Times in 24h.');
  });
});
