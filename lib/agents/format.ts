/** An action an agent may write in its answer: its name, its arguments, and what it does. */
export interface ActionSpec {
  name: string;
  /** The arguments' shape, as the model reads it, e.g. `{"app": string}`. */
  args: string;
  does: string;
}

/**
 * The response format every answering agent writes, with the actions and app asks this agent may
 * use. Tools are system things called as functions; actions do something on the desktop and don't
 * wait; asks wait for the user or an app to reply. The rules come from live checks: say what is
 * happening rather than that it is done, act in the same turn instead of announcing it, and never
 * invent what wasn't found.
 *
 * @param actions - The actions this agent may write.
 * @param asks - The app asks this agent may write; asking the user is always available.
 * @returns The format section of the agent's system prompt.
 */
export function responseFormat(actions: ActionSpec[], asks: ActionSpec[] = []): string {
  const listed = (specs: ActionSpec[]) => specs.map((spec) => `- ${spec.name} ${spec.args}: ${spec.does}`).join('\n');
  const actionList = actions.length ? `Actions you can write:\n${listed(actions)}` : 'You have no actions.';
  const askList = asks.length ? `App asks you can write:\n${listed(asks)}` : 'You have no app asks.';

  return `How to write your answer:
- Write Markdown. Everything you write is shown on screen.
- Wrap what you say aloud in [[say]]...[[/say]]. Speak one or two short sentences per answer; put details, lists and tables outside it.
- To show UI, write [[widget]]{json}[[/widget]], where json is a widget node: {"role": string, "props": {...}, "bindings": [...], "children": [...]}. Use role "card" with props "title" and "body" unless a better role fits.

Three ways to get things done; never mix them up:
- Tools are system things on the server: files, memory, search. Call them as functions and you get the result in this turn. Never write a tool as a marker.
- Actions do something on the desktop and don't wait: write [[action name=NAME]]{json args}[[/action]] where it should happen in your answer. Say what you are doing ("Opening Motion"), never that it is done. If one fails, you are told on your next turn.
- Asks wait for a reply, which you read on your next turn. An ask ends your turn, so write it last.
  - Ask the user with [[ask_user]]{widget}[[/ask_user]], after saying the question in [[say]]. The widget is the body of a form the user fills in. Bind each input to a field of the form with "bindings": [{"prop": "value", "state": "$this.FIELD", "writable": true}]; the reply is those fields, like {"FIELD": ...}. Use a radio-group with radio children for a choice, a switch for yes or no, and a text-input for free text. Example: [[ask_user]]{"role": "radio-group", "bindings": [{"prop": "value", "state": "$this.choice", "writable": true}], "children": [{"role": "radio", "props": {"value": "keep"}, "children": ["Keep it"]}, {"role": "radio", "props": {"value": "delete"}, "children": ["Delete it"]}]}[[/ask_user]]
  - Ask an app with [[ask_app name=NAME]]{json args}[[/ask_app]], only for the app asks listed below.
- Before deleting, sending, or anything else the user can't undo, ask the user and act only on a clear yes.
- When you need information, call a tool in the same turn. Never say you will check something without calling the tool.
- Never invent files, mail, people or results. If something isn't found, say so and ask.

${actionList}

${askList}`;
}
