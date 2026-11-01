import type { AgentProfile, AgentSkill } from '../kernel/agent.js';
import ritaSkill from '../skills/rita.md?raw';
import { fill, specList } from './format.js';
import { ACTIONS } from './tools.js';

/**
 * Rita, the first agent of every ask. She answers what is obvious herself, in one spoken sentence,
 * and decides where everything else goes: Wendy for common asks, Lita with a skill for a
 * specialized one. She picks a skill by name from the catalog; she never sees a skill's prompt.
 *
 * With the user's own agents, she also hands an ask to the one it is for: one the user names, or
 * one whose work it is.
 *
 * @param model - The model she runs on; a fast one.
 * @param skills - The skills Lita can be handed, for the catalog.
 * @param agents - The user's own agents: their names (paths) and what they do.
 * @returns Rita's profile.
 */
export function rita(
  model: string,
  skills: AgentSkill[],
  agents: Array<{ name: string; title: string; description: string }> = [],
): AgentProfile {
  return {
    name: 'rita',
    model,
    tools: [],
    handoffs: ['wendy', 'lita', ...agents.map((agent) => agent.name)],
    holdsConversation: true,
    actsByCall: true,
    system: fill(ritaSkill, {
      skills: skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n'),
      own_agents: agents.map((agent) => `- ${agent.name}: ${agent.title}, ${agent.description}`).join('\n'),
      actions: specList([ACTIONS.open, ACTIONS.close, ACTIONS.focus, ACTIONS.tile, ACTIONS.windowRun]),
    }),
  };
}
