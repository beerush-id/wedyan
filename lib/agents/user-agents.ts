import type { ChatTool } from '@irpclib/ai-kit';
import type { AgentProfile, AgentSkill } from '../kernel/agent.js';
import type { AgentFile } from '../share/agents.js';
import type { UserDetails } from '../share/profile.js';
import { SKILL_EXTENSION, userSkillPath } from '../share/skills.js';
import { ENTRY, SPECIALIST } from './index.js';
import { personaPrompt } from './persona.js';
import { rita } from './rita.js';
import { ACTIONS, DOCUMENT_ASKS } from './tools.js';

/** One of the user's own agents: its file, and its path, which is its name and its actor. */
export type UserAgent = { path: string; file: AgentFile };

/**
 * Adds the user's own agents to Wedyan's for one ask. Each runs on the specialist engine with the
 * skills its file names and speaks as itself; the router learns who they are and may hand an ask
 * to one. Skills it names that don't exist grant nothing.
 *
 * @param agents - Wedyan's agents.
 * @param skills - The skills there are: the apps' by name, the user's own by their path in the home.
 * @param own - The user's own agents.
 * @param user - The user's profile and settings, for how every agent speaks to them.
 * @returns The agents the ask runs with.
 */
export function withUserAgents(
  agents: Record<string, AgentProfile>,
  skills: Record<string, AgentSkill>,
  own: UserAgent[],
  user?: UserDetails,
): Record<string, AgentProfile> {
  if (!own.length) return agents;
  const engine = agents[SPECIALIST];
  const router = agents[ENTRY];
  const listed = own.map(({ path, file }) => ({ name: path, title: file.name, description: file.description }));

  return {
    ...agents,
    ...Object.fromEntries(own.map((agent) => [agent.path, userAgentProfile(agent, engine, skills, own, user)])),
    // Lita is handed the apps' skills only; the user's own are their agents'.
    [ENTRY]: {
      ...router,
      ...rita(
        router.model,
        Object.entries(skills).flatMap(([key, skill]) => (key.endsWith(SKILL_EXTENSION) ? [] : [skill])),
        listed,
      ),
    },
  };
}

/**
 * How the user's own agents work inside a document open on the desktop, like a person in the same
 * file: open one part, write it whole, let go. Shown to every one of them, whatever their skills.
 */
const DOCUMENT_WORK = `Working inside a document open on the desktop:
${[...Object.values(DOCUMENT_ASKS), ACTIONS.docClose].map((spec) => `- ${spec.name} ${spec.args}: ${spec.does}`).join('\n')}
Write doc.open and doc.update as app asks, [[ask_app name=doc.open]]{...}[[/ask_app]], and doc.close as an action. Open a part before writing it, and work only on parts you were given.`;

/** One of the user's own agents as the loop runs it: the engine, with its skills and its own persona. */
function userAgentProfile(
  { path, file }: UserAgent,
  engine: AgentProfile,
  skills: Record<string, AgentSkill>,
  own: UserAgent[],
  user?: UserDetails,
): AgentProfile {
  // The apps' skills by name; the user's own by their path, as the agent's file names them.
  const granted = file.skills.flatMap((name) => {
    const skill = skills[userSkillPath(path, name) ?? name];
    return skill ? [skill] : [];
  });
  // Skills may share a tool; a model is offered each once.
  const tools = new Map<string, ChatTool>(
    [...engine.tools, ...granted.flatMap((skill) => skill.tools)].map((tool) => [tool.name, tool]),
  );
  // Who else there is, by path: whom it can hand work to, or name for what it leaves to others.
  const others = own.filter((agent) => agent.path !== path);
  const roster = others.length
    ? `The user's other experts, by path:\n${others.map((agent) => `- ${agent.path}: ${agent.file.name}, ${agent.file.description}`).join('\n')}`
    : '';

  return {
    ...engine,
    name: path,
    skilled: false,
    system: [engine.system, ...granted.map((skill) => skill.system), DOCUMENT_WORK, roster]
      .filter(Boolean)
      .join('\n\n'),
    tools: [...tools.values()],
    persona: personaPrompt(user, file),
  };
}
