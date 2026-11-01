import type { AgentProfile } from '../kernel/agent.js';
import litaSkill from '../skills/lita.md?raw';
import { MEMORY } from './tools.js';

/**
 * Lita, the specialist: her base profile, which the kernel completes at handoff with the skill she
 * was handed (its prompt, tools, actions and app asks). She ends the ask when the job is done, and
 * hands back to Rita only when something must still be decided.
 *
 * @param model - The model she runs on.
 * @returns Lita's base profile.
 */
export function lita(model: string): AgentProfile {
  return {
    name: 'lita',
    model,
    skilled: true,
    handoffs: ['rita'],
    tools: [MEMORY.recall],
    webSearch: true,
    actsFirst: true,
    system: litaSkill,
  };
}
