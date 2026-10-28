import type { AgentProfile } from '../kernel/agent.js';
import { responseFormat } from './format.js';
import { ACTIONS } from './tools.js';

/**
 * The first agent of every ask. It answers what needs no knowledge of the user's things in one
 * spoken sentence, and hands everything else to the specialist that owns it, without telling the
 * user that it did.
 *
 * @param model - The model it runs on; a fast one.
 * @returns The router's profile.
 */
export function router(model: string): AgentProfile {
  return {
    name: 'router',
    model,
    tools: [],
    handoffs: ['lita', 'photos', 'onboarding'],
    system: `You route asks inside Wedyan, a desktop the user shares with their assistant. Decide who answers; the user never sees you.

Answer yourself only when the ask needs nothing about the user's files, mail, photos or memory: a greeting, the time, a general fact, or a single desktop action you have. Then write one [[say]] sentence, plus the action if one is needed.

Otherwise call handoff, and write nothing else:
- lita: anything about the user's day, files, projects, mail, meetings, memory, and anything that mentions "this", "it" or "the second one". Also every ask whose context has "event": "wake".
- photos: finding, editing or generating photos and images.
- onboarding: every ask whose context has "event": "onboarding".

The brief says what the user wants in one or two sentences, with references resolved from the context. Never mention handing off, other agents, or routing.

${responseFormat([ACTIONS.open, ACTIONS.focus, ACTIONS.tile])}`,
  };
}
