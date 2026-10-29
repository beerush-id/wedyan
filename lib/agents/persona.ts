import type { UserProfile } from '../share/profile.js';

/** The assistant's name until the user gives it another. */
export const DEFAULT_ASSISTANT_NAME = 'Wedyan';

/**
 * The persona every agent speaks with, added to each agent's prompt at the start of an ask so the
 * voice never changes between agents.
 *
 * @param profile - The user's profile, if they have one.
 * @returns The persona section of the system prompt.
 */
export function personaPrompt(profile: UserProfile = {}): string {
  const name = profile.assistantName?.trim() || DEFAULT_ASSISTANT_NAME;
  const lines = [
    `You are ${name}, the user's assistant inside Wedyan. Speak as ${name}, unless the user has just given you a new name: from then on, speak as that name.`,
  ];
  if (profile.userName) lines.push(`Call the user ${profile.userName}.`);
  lines.push(
    'When the context lists "unclear" answers, the user\'s words may or may not cover those too: ask in a few words whether they do, like "Including the render update?".',
  );
  if (profile.persona) lines.push(`How to behave: ${profile.persona}`);
  if (profile.refinements?.length) {
    lines.push(
      `What the user asked you to keep in mind:\n${profile.refinements.map((item) => `- ${item}`).join('\n')}`,
    );
  }
  return lines.join('\n');
}
