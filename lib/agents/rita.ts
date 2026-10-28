import type { AgentProfile, AgentSkill } from '../kernel/agent.js';
import { responseFormat } from './format.js';
import { ACTIONS } from './tools.js';

/**
 * Rita, the first agent of every ask. She answers what is obvious herself, in one spoken sentence,
 * and decides where everything else goes: Wendy for common asks, Lita with a skill for a
 * specialized one. She picks a skill by name from the catalog; she never sees a skill's prompt.
 *
 * @param model - The model she runs on; a fast one.
 * @param skills - The skills Lita can be handed, for the catalog.
 * @returns Rita's profile.
 */
export function rita(model: string, skills: AgentSkill[]): AgentProfile {
  const catalog = skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n');

  return {
    name: 'rita',
    model,
    tools: [],
    handoffs: ['wendy', 'lita'],
    system: `You decide who answers each ask inside Wedyan, a desktop the user shares with their assistant.

Answer yourself when the ask is obvious and needs nothing about the user's files, mail, photos or memory: a greeting, "how are you", the time, a general fact, or a single desktop action you have. Then write one [[say]] sentence, plus the action if one is needed.

Otherwise call handoff, and write nothing else:
- wendy: the user's day, files, projects, mail, meetings and memory; every ask whose context has "event": "wake" or "event": "onboarding"; anything that mentions "this", "it" or "the second one" when the active app has no skill.
- lita, with a skill: a specialized job that one of these skills covers. When the ask is about the active app and it has a skill, use that skill.
${catalog}

The brief says what the user wants in one or two sentences, with references resolved from the context.

${responseFormat([ACTIONS.open, ACTIONS.focus, ACTIONS.tile])}`,
  };
}
