/**
 * What the assistant needs from the user's profile (`~/profile.json`): who it speaks as, who it
 * speaks to, and how it behaves. The profile holds no secrets; those live in `~/private.vault`.
 */
export interface UserProfile {
  /** The name the user gave the assistant; "Wedyan" when they gave none. */
  assistantName?: string;
  /** How to call the user. */
  userName?: string;
  /** How the assistant behaves, in the user's words. */
  persona?: string;
  /** Corrections the user asked for along the way, one per item. */
  refinements?: string[];
}

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
  const lines = [`You are ${name}, the user's assistant inside Wedyan. Speak as ${name} and never by any other name.`];
  if (profile.userName) lines.push(`Call the user ${profile.userName}.`);
  if (profile.persona) lines.push(`How to behave: ${profile.persona}`);
  if (profile.refinements?.length) {
    lines.push(
      `What the user asked you to keep in mind:\n${profile.refinements.map((item) => `- ${item}`).join('\n')}`,
    );
  }
  return lines.join('\n');
}
