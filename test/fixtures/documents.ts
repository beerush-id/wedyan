import type { ActionMeta } from '../../lib/kernel/agent.h.js';
import { answerDocuments, type BindingRules } from '../../lib/share/binding.js';

// What the document tests share on either side of the wire: a project, its rules, and a stand-in
// for the desktop's conversation that records the answers the binding registers, so the agents'
// asks can be made directly. Nothing here runs the server.

/** Waits until `check` holds, failing after `timeout` ms. */
export async function until(check: () => boolean, timeout = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export const KAI = '~/Agents/Animation.agent';
export const LUMI = '~/Agents/Image.agent';

export type Clip = { id: string; title: string; assignee?: string };
export type Project = { clips: Clip[] };

/** A project of two clips, one assigned to each agent. */
export const PROJECT: Project = {
  clips: [
    { id: 'v3', title: 'Hero', assignee: KAI },
    { id: 'v4', title: 'Closing', assignee: LUMI },
  ],
};

/** A fresh project path, so tests never share a document. */
export const projectPath = () => `~/Motions/${crypto.randomUUID()}/Project A.motion`;

/**
 * The rules a Motion window gives its project: a clip opens only for the agent it's assigned to,
 * and an agent's value is written into the clip it opened.
 */
export function clipRules(data: () => Project | undefined): BindingRules {
  return {
    open: ({ part, id, actor }) => {
      const clip = part === 'clip' ? data()?.clips.find((one) => one.id === id) : undefined;
      if (!clip) return 'Only clips can be opened';
      return clip.assignee === actor ? clip : `Assigned to ${clip.assignee}`;
    },
    update: ({ value, entity }) => {
      Object.assign(entity, value);
      return true;
    },
  };
}

/** The answers a desktop registered, called the way the server's asks reach them. */
export function desktopAnswers() {
  const answers = new Map<string, (args: never, meta: ActionMeta) => unknown>();
  answerDocuments({ answer: (name, handler) => answers.set(name, handler) });
  return (name: string, args: Record<string, unknown>, actor: string) =>
    answers.get(name)?.(args as never, { after: 0, actor });
}
