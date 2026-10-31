import type { AgentFile } from '../share/agents.js';
import type { UserDetails } from '../share/profile.js';

/** The assistant's name until the user gives it another. */
export const DEFAULT_ASSISTANT_NAME = 'Wedyan';

/**
 * The persona an agent speaks with, added to its prompt at the start of an ask. Wedyan's engines
 * all speak as the assistant, so the voice never changes between them; one of the user's own
 * agents speaks as itself, beside the assistant. What the user asked to keep in mind holds for all.
 *
 * @param user - The user's profile and settings, as far as they have any.
 * @param agent - The user's own agent it is for; the assistant's when unset.
 * @returns The persona section of the system prompt.
 */
export function personaPrompt(
  user: UserDetails = {},
  agent?: Pick<AgentFile, 'name' | 'description' | 'persona'>,
): string {
  const name = user.assistantName?.trim() || DEFAULT_ASSISTANT_NAME;
  const lines = agent
    ? [
        `You are ${agent.name}, one of the user's own agents inside Wedyan, working beside ${name}, their assistant. What you do: ${agent.description}`,
      ]
    : [
        `You are ${name}, the user's assistant inside Wedyan. Speak as ${name}, unless the user has just given you a new name: from then on, speak as that name.`,
      ];
  if (user.userName) lines.push(`Call the user ${user.userName}.`);
  lines.push(
    'When the context lists "unclear" answers, the user\'s words may or may not cover those too: ask in a few words whether they do, like "Including the render update?".',
  );
  const behavior = agent ? agent.persona : user.persona;
  if (behavior) lines.push(`How to behave: ${behavior}`);
  if (user.refinements?.length) {
    lines.push(`What the user asked you to keep in mind:\n${user.refinements.map((item) => `- ${item}`).join('\n')}`);
  }
  return lines.join('\n');
}
