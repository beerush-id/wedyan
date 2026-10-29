import type { ChatTool } from '@irpclib/ai-kit';
import type { AgentProfile, AgentSkill } from '../kernel/agent.js';
import type { AgentFile } from '../share/agents.js';
import type { UserProfile } from '../share/profile.js';
import { ENTRY, SPECIALIST } from './index.js';
import { personaPrompt } from './persona.js';
import { rita } from './rita.js';

/** One of the user's own agents: its file, and its path, which is its name and its actor. */
export type UserAgent = { path: string; file: AgentFile };

/**
 * Adds the user's own agents to Wedyan's for one ask. Each runs on the specialist engine with the
 * skills its file names and speaks as itself; the router learns who they are and may hand an ask
 * to one. Skills it names that don't exist grant nothing.
 *
 * @param agents - Wedyan's agents.
 * @param skills - The skills there are, by name.
 * @param own - The user's own agents.
 * @param profile - The user's profile, for how every agent speaks to them.
 * @returns The agents the ask runs with.
 */
export function withUserAgents(
  agents: Record<string, AgentProfile>,
  skills: Record<string, AgentSkill>,
  own: UserAgent[],
  profile?: UserProfile,
): Record<string, AgentProfile> {
  if (!own.length) return agents;
  const engine = agents[SPECIALIST];
  const router = agents[ENTRY];
  const listed = own.map(({ path, file }) => ({ name: path, title: file.name, description: file.description }));

  return {
    ...agents,
    ...Object.fromEntries(own.map((agent) => [agent.path, userAgentProfile(agent, engine, skills, profile)])),
    [ENTRY]: { ...router, ...rita(router.model, Object.values(skills), listed) },
  };
}

/** One of the user's own agents as the loop runs it: the engine, with its skills and its own persona. */
function userAgentProfile(
  { path, file }: UserAgent,
  engine: AgentProfile,
  skills: Record<string, AgentSkill>,
  profile?: UserProfile,
): AgentProfile {
  const granted = file.skills.flatMap((name) => (skills[name] ? [skills[name]] : []));
  // Skills may share a tool; a model is offered each once.
  const tools = new Map<string, ChatTool>(
    [...engine.tools, ...granted.flatMap((skill) => skill.tools)].map((tool) => [tool.name, tool]),
  );

  return {
    ...engine,
    name: path,
    skilled: false,
    system: [engine.system, ...granted.map((skill) => skill.system)].join('\n\n'),
    tools: [...tools.values()],
    persona: personaPrompt(profile, file),
  };
}
