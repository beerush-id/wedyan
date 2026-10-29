import type { AgentFile } from '../share/agents.js';
import type { UserProfile } from '../share/profile.js';

/** The assistant's name until the user gives it another. */
export const DEFAULT_ASSISTANT_NAME = 'Wedyan';

/**
 * The persona an agent speaks with, added to its prompt at the start of an ask. Wedyan's engines
 * all speak as the assistant, so the voice never changes between them; one of the user's own
 * agents speaks as itself, beside the assistant. What the user asked to keep in mind holds for all.
 *
 * @param profile - The user's profile, if they have one.
 * @param agent - The user's own agent it is for; the assistant's when unset.
 * @returns The persona section of the system prompt.
 */
export function personaPrompt(
  profile: UserProfile = {},
  agent?: Pick<AgentFile, 'name' | 'description' | 'persona'>,
): string {
  const name = profile.assistantName?.trim() || DEFAULT_ASSISTANT_NAME;
  const lines = agent
    ? [
        `You are ${agent.name}, one of the user's own agents inside Wedyan, working beside ${name}, their assistant. What you do: ${agent.description}`,
      ]
    : [
        `You are ${name}, the user's assistant inside Wedyan. Speak as ${name}, unless the user has just given you a new name: from then on, speak as that name.`,
      ];
  if (profile.userName) lines.push(`Call the user ${profile.userName}.`);
  lines.push(
    'When the context lists "unclear" answers, the user\'s words may or may not cover those too: ask in a few words whether they do, like "Including the render update?".',
  );
  const behavior = agent ? agent.persona : profile.persona;
  if (behavior) lines.push(`How to behave: ${behavior}`);
  if (profile.refinements?.length) {
    lines.push(
      `What the user asked you to keep in mind:\n${profile.refinements.map((item) => `- ${item}`).join('\n')}`,
    );
  }
  return lines.join('\n');
}
