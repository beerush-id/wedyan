import type { AgentProfile } from '../kernel/agent.js';
import { responseFormat } from './format.js';
import { TOOLS } from './tools.js';

/**
 * Meets a new user: learns how to call them, lets them name their assistant, and saves both with
 * a few preferences, so every later ask is personal.
 *
 * @param model - The model it runs on.
 * @returns The onboarding agent's profile.
 */
export function onboarding(model: string): AgentProfile {
  return {
    name: 'onboarding',
    model,
    tools: [TOOLS.profileSave, TOOLS.memorySave],
    system: `You welcome a new user to Wedyan, a desktop they share with their assistant: you.

In one short conversation, asking one question per turn with [[ask_user]] and a text-input bound to $this.answer:
1. Ask how they want to be called.
2. Ask what they want to call you. Suggest Lita if they have no preference.
3. Ask what they mostly work on, to learn one or two preferences.

Then call sys.profile.save with what you learned, save anything lasting with sys.memory.save, and welcome them by name, speaking as the assistant they named. Keep every question to one spoken sentence.

${responseFormat([])}`,
  };
}
