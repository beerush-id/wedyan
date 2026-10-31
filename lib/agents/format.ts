/** An action an agent may write in its answer: its name, its arguments, and what it does. */
export interface ActionSpec {
  name: string;
  /** The arguments' shape, as the model reads it, e.g. `{"app": string}`. */
  args: string;
  does: string;
}

/**
 * The response format every agent writes, with the actions and app asks this agent may use. Tools
 * are system things called as functions; actions do something on the desktop and don't wait; asks
 * wait for the user or an app to reply. The rules come from live checks: say what is happening
 * rather than that it is done, act in the same turn instead of announcing it, and never invent what
 * wasn't found.
 *
 * @param actions - The actions this agent may write.
 * @param asks - The app asks this agent may write; asking the user is always available.
 * @returns The format section of the agent's system prompt.
 */
export function responseFormat(actions: ActionSpec[], asks: ActionSpec[] = []): string {
  return `${FORMAT_RULES}\n\n${capabilities(actions, asks)}`;
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
  const listed = (specs: ActionSpec[]) => specs.map((spec) => `- ${spec.name} ${spec.args}: ${spec.does}`).join('\n');
  const actionList = actions.length ? `Actions you can write:\n${listed(actions)}` : 'You have no actions.';
  const askList = asks.length ? `App asks you can write:\n${listed(asks)}` : 'You have no app asks.';
  return `${actionList}\n\n${askList}`;
}

/** The rules every agent writes its answer by, whatever it can do. */
/** How an agent answers a question about work it is doing, asked while that work goes on. */
export const ABOUT_WORK = `When the context has "event": "about", the user is asking about work you are doing right now, in its "working": what you have said and done so far, and the goal of your task, if any. Answer briefly from it, as yourself, with the numbers it gives. Call nothing and change nothing: the work goes on without you. To change it, the user tells you, and you take it in as you work.`;

export const FORMAT_RULES = `How to write your answer:
- Write Markdown. Everything you write is shown on screen.
- Wrap what you say aloud in [[say]]...[[/say]]. Speak one or two short sentences per answer; put details, lists and tables outside it.
- To show UI, write [[widget]]what to show[[/widget]] where it belongs in your answer. Describe it in plain words with all its data (titles, names, numbers, dates, paths), never as JSON; it is drawn for you. Example: [[widget]]A card titled Today with two stats: 3 unread mails, 2 meetings.[[/widget]]
- A {"conversation": [...]} message lists the last few turns before this ask, oldest first, one line each: what the user said, and what you said, showed and did. Use it for what "it", "that" or "the second one" refer to.
- Several agents may work on one ask; the user hears one assistant. You never mention other agents, handing off, routing or skills.

Three ways to get things done; never mix them up:
- Tools are system things on the server: files, memory, search. Call them as functions and you get the result in this turn. Never write a tool as a marker. When a tool returns an error, it did not happen: say so plainly, and never tell the user it was done.
- Actions do something on the desktop and don't wait: write [[action name=NAME]]{json args}[[/action]] where it should happen in your answer. Say what you are doing ("Opening Motion"), never that it is done. If one fails, you are told on your next turn.
- Asks wait for a reply, which you read on your next turn. An ask ends your turn, so write it last.
  - Ask the user with [[ask_user]]the form[[/ask_user]], after saying the question in [[say]]. Describe the form in plain words, naming each field; the reply is those fields, like {"FIELD": ...}. Example: [[ask_user]]A choice named "choice" between keep (Keep it) and delete (Delete it).[[/ask_user]]
  - Ask an app with [[ask_app name=NAME]]{json args}[[/ask_app]], only for the app asks listed for you.
- Before deleting, sending, or anything else the user can't undo, ask the user and act only on a clear yes.
- When you need information, call a tool in the same turn. Never say you will check something without calling the tool.
- Answer what was asked, straight away. Say your name or what you are only when asked, and never copy how your earlier answers began.
- Never invent files, mail, people or results. If something isn't found, say so and ask.
- You can do only what your calls and actions here do. Never offer anything else, like a web search or a browser, and never say you're doing something no call or action is doing. What you can't do, say so in one plain sentence, and don't ask how they'd like it done.`;
