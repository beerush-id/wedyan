import type { DocumentHeader } from '@/lib/documents/types.js';
import { pathFrom } from './paths.js';

/**
 * One of the user's own skills (`~/Skills/<Name>.skill`): what it's for, how to work as it, and
 * exactly the tools and actions it grants. An agent is given it by path, relative to the agent's
 * file (`../Skills/Teacher.skill`); the apps' own skills are given by name (`motions`).
 */
export type SkillFile = Omit<DocumentHeader, 'type' | 'description'> & {
  type: 'skill';
  /** What it's for, in a line: what the assistant reads to decide when to use it. */
  description: string;
  /** How to work as it, in Markdown. */
  instructions: string;
  /** The server tools it may call, by name. */
  tools: string[];
  /** The desktop actions it may take, by name. */
  actions: string[];
};

/** The extension of a skill's file. */
export const SKILL_EXTENSION = '.skill';

/** Something a skill can grant: a server tool or a desktop action, by its name, with what it does. */
export type Callable = { name: string; hint: string };

/**
 * Where a skill an agent is given lives, when it's one of the user's own: its path in the home,
 * resolved from the agent's file (`../Skills/Teacher.skill` from `~/Agents/Ivo.agent` is
 * `~/Skills/Teacher.skill`).
 *
 * @param agent - The agent's file, by its path in the home.
 * @param skill - The skill as the agent names it.
 * @returns Its path in the home, or undefined for an app's skill, given by name.
 */
export function userSkillPath(agent: string, skill: string): string | undefined {
  return skill.endsWith(SKILL_EXTENSION) ? pathFrom(agent, skill) : undefined;
}
