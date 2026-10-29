import type { DocumentHeader } from '@/lib/documents/types.js';
import { AGENTS_PATH } from './system.js';

/**
 * One of the user's own agents (`~/Agents/<id>.agent`): who it is, how it works, and the skills
 * that grant what it may do. The user makes, names and changes them; Wedyan runs them. Its path
 * is its actor: what the kernel stamps on everything it does, and what a part's `assignee` names.
 */
export type AgentFile = Omit<DocumentHeader, 'type' | 'description'> & {
  type: 'agent';
  /** What it does, in a line: what the assistant reads to decide when it is the one to ask. */
  description: string;
  /** Its picture, shown on the parts it is assigned. */
  avatar?: string;
  /** How it works and talks, in the user's words. */
  persona?: string;
  /** The skills it has, by name: they grant exactly the tools and actions it may use. */
  skills: string[];
};

/** The extension of an agent's file. */
export const AGENT_EXTENSION = '.agent';

/**
 * Whether an actor or agent name is one of the user's own agents, by its path.
 *
 * @param name - An actor, or an agent's name.
 * @returns `true` for a path inside `~/Agents`.
 */
export function isUserAgent(name?: string): name is string {
  return !!name?.startsWith(`${AGENTS_PATH}/`);
}
