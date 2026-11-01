import type { AgentProfile } from '../kernel/agent.js';
import { IDLE_SETTINGS_LINK } from '../share/profile.js';
import wendySkill from '../skills/wendy.md?raw';
import { fill, specList } from './format.js';
import { ACTIONS, FILE_LOOKUPS, MEMORY } from './tools.js';

/**
 * Wendy, the assistant for common asks: she briefs the user when they come back, works with their
 * files, projects, mail and memory, and welcomes a new user. A specialized job goes to Lita with a
 * skill.
 *
 * @param model - The model she runs on.
 * @returns Wendy's profile.
 */
export function wendy(model: string): AgentProfile {
  return {
    name: 'wendy',
    model,
    handoffs: ['lita'],
    tools: [MEMORY.recall, MEMORY.save, ...FILE_LOOKUPS],
    webSearch: true,
    system: fill(wendySkill, {
      idle_settings_link: IDLE_SETTINGS_LINK,
      actions: specList([ACTIONS.open, ACTIONS.mailOpen, ACTIONS.filesReveal, ACTIONS.filesDelete, ACTIONS.focus, ACTIONS.tile]),
      asks: '',
    }),
  };
}
