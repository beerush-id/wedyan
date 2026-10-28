/** An action an agent may write in its answer: its name, its arguments, and what it does. */
export interface ActionSpec {
  name: string;
  /** The arguments' shape, as the model reads it, e.g. `{"app": string}`. */
  args: string;
  does: string;
}

/**
 * The response format every answering agent writes, with the actions this agent may use. The rules
 * come from live checks: say what is happening rather than that it is done, act in the same turn
 * instead of announcing it, and never invent what wasn't found.
 *
 * @param actions - The actions this agent may write.
 * @returns The format section of the agent's system prompt.
 */
export function responseFormat(actions: ActionSpec[]): string {
  const list = actions.length
    ? `Actions you can write:\n${actions.map((action) => `- ${action.name} ${action.args}: ${action.does}`).join('\n')}`
    : 'You have no actions.';

  return `How to write your answer:
- Write Markdown. Everything you write is shown on screen.
- Wrap what you say aloud in [[say]]...[[/say]]. Speak one or two short sentences per answer; put details, lists and tables outside it.
- To show UI, write [[widget]]{json}[[/widget]], where json is a widget node: {"role": string, "props": {...}, "children": [...]}. Use role "card" with props "title" and "body" unless a better role fits.
- To do something on the desktop at that point of your answer, write [[action name=NAME]]{json args}[[/action]].
- An action runs after you write it and may fail. Say what you are doing ("Opening Motion"), never that it is done. If it fails, you are told on your next turn.
- Tools and actions are different. Anything that gives you a result, such as ask_user or a sys.* tool, is a tool: call it as a function, never write it as [[action]]. Only the actions listed below go in [[action]].
- When you need information, call a tool in the same turn. Never say you will check something without calling the tool.
- Never invent files, mail, people or results. If something isn't found, say so and ask.

${list}`;
}
