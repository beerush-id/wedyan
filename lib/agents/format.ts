/** An action an agent may write in its answer: its name, its arguments, and what it does. */
export interface ActionSpec {
  name: string;
  /** The arguments' shape, as the model reads it, e.g. `{"app": string}`. */
  args: string;
  does: string;
}

/**
 * The actions and app asks an agent may write, as its prompt lists them. A skill brings its own,
 * so a skilled agent's base prompt has the rules and its skill has the lists.
 *
 * @param actions - The actions it may write.
 * @param asks - The app asks it may write.
 * @returns The lists, or a line saying there are none.
 */
export function capabilities(actions: ActionSpec[], asks: ActionSpec[] = []): string {
  const actionList = actions.length ? `Actions you can write:\n${specList(actions)}` : 'You have no actions.';
  const askList = asks.length ? `App asks you can write:\n${specList(asks)}` : 'You have no app asks.';
  return `${actionList}\n\n${askList}`;
}

/**
 * Actions or app asks as an agent's prompt lists them.
 *
 * @param specs - What it may write.
 * @returns One line for each.
 */
export function specList(specs: ActionSpec[]): string {
  return specs.map((spec) => `- ${spec.name} ${spec.args}: ${spec.does}`).join('\n');
}

/**
 * Puts what's only known at runtime into an agent's skill, in place of its `{{name}}` placeholders.
 *
 * @param skill - The skill's text.
 * @param values - What each placeholder stands for.
 * @returns The agent's system prompt.
 */
export function fill(skill: string, values: Record<string, string>): string {
  return skill.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '');
}
