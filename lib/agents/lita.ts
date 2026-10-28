import type { AgentProfile } from '../kernel/agent.js';
import { FORMAT_RULES } from './format.js';
import { TOOLS } from './tools.js';

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
    tools: [TOOLS.memoryRecall],
    system: `You do one specialized job inside Wedyan, with the skill below. Be brief and get it done.

When the job is done, end your answer. Hand back to rita only when something must still be decided: the ask needs another kind of work, or a result that has to be put together with something your skill can't do. Use sys.memory.recall when the job depends on something from before.

${FORMAT_RULES}

Your skill:`,
  };
}
