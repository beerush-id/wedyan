import motionsSkill from '@/apps/motions/SKILL.md?raw';
import photosSkill from '@/apps/photos/SKILL.md?raw';
import type { AgentSkill } from '../kernel/agent.js';
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

  const tools = names(meta.tools).map((tool) => {
    if (!TOOLS_BY_NAME[tool]) throw new Error(`Skill ${name} names an unknown tool: ${tool}`);
    return TOOLS_BY_NAME[tool];
  });
  const actions = names(meta.actions).map((action) => {
    if (!ACTIONS_BY_NAME[action]) throw new Error(`Skill ${name} names an unknown action: ${action}`);
    return ACTIONS_BY_NAME[action];
  });

  return { name, description, tools, system: `${(match?.[2] ?? '').trim()}\n\n${capabilities(actions)}` };
}

/** The names in a comma-separated frontmatter value. */
function names(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
