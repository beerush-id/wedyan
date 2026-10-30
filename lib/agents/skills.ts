import motionsSkill from '@/apps/motions/SKILL.md?raw';
import photosSkill from '@/apps/photos/SKILL.md?raw';
import type { AgentSkill } from '../kernel/agent.js';
import type { Callable, SkillFile } from '../share/skills.js';
import { capabilities } from './format.js';
import { ACTIONS_BY_NAME, TOOLS_BY_NAME } from './tools.js';

/**
 * The skills Lita can be handed, one per app, read from each app's `SKILL.md` on the server. Rita
 * picks one by name; the kernel resolves the name here, so a skill is never chosen by the client.
 */
export const SKILLS: Record<string, AgentSkill> = Object.fromEntries(
  [photosSkill, motionsSkill].map((text) => {
    const skill = parseSkill(text);
    return [skill.name, skill];
  }),
);

/**
 * Reads a `SKILL.md`: a frontmatter of `key: value` lines with the skill's `name`, a one-line
 * `description` for the one routing, and the `tools` and `actions` it uses as comma-separated
 * names; then the body, which is the skill's prompt.
 *
 * @param text - The file's content.
 * @returns The skill, its prompt followed by the actions it may write.
 * @throws When the name or description is missing, or a tool or action name is unknown.
 */
export function parseSkill(text: string): AgentSkill {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.trim());
  const meta = Object.fromEntries(
    (match?.[1] ?? '').split('\n').flatMap((line) => {
      const colon = line.indexOf(':');
      return colon > 0 ? [[line.slice(0, colon).trim(), line.slice(colon + 1).trim()]] : [];
    }),
  );
  const { name, description } = meta;
  if (!name || !description) throw new Error('A skill needs a name and a description');

  const tools = names(meta.tools);
  const actions = names(meta.actions);
  const tool = tools.find((each) => !TOOLS_BY_NAME[each]);
  if (tool) throw new Error(`Skill ${name} names an unknown tool: ${tool}`);
  const action = actions.find((each) => !ACTIONS_BY_NAME[each]);
  if (action) throw new Error(`Skill ${name} names an unknown action: ${action}`);
  return skillOf(name, description, match?.[2] ?? '', tools, actions);
}

/**
 * Reads one of the user's own skills (`~/Skills/<Name>.skill`), as an app's skill reads. A tool or
 * action it names that doesn't exist, or no longer does, grants nothing, rather than failing the ask.
 *
 * @param file - The skill's file.
 * @returns The skill, its instructions followed by the actions it may write.
 */
export function userSkill(file: SkillFile): AgentSkill {
  return skillOf(file.name, file.description, file.instructions ?? '', file.tools ?? [], file.actions ?? []);
}

/**
 * Everything a skill may be granted, for the desktop to offer when the user makes one: every
 * server tool and desktop action there is, by name, with what it does.
 */
export const CALLABLES: { tools: Callable[]; actions: Callable[] } = {
  tools: Object.values(TOOLS_BY_NAME).map(({ name, description }) => ({ name, hint: description ?? '' })),
  actions: Object.values(ACTIONS_BY_NAME).map(({ name, does }) => ({ name, hint: does })),
};

/** A skill from its parts: its prompt followed by the actions it may write, with the tools there are. */
function skillOf(name: string, description: string, body: string, tools: string[], actions: string[]): AgentSkill {
  const granted = actions.flatMap((action) => (ACTIONS_BY_NAME[action] ? [ACTIONS_BY_NAME[action]] : []));
  return {
    name,
    description,
    tools: tools.flatMap((tool) => (TOOLS_BY_NAME[tool] ? [TOOLS_BY_NAME[tool]] : [])),
    system: `${body.trim()}\n\n${capabilities(granted)}`,
  };
}

/** The names in a comma-separated frontmatter value. */
function names(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
