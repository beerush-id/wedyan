import type { TimelineSegment } from '@airlib/react/timeline';
import type { Composer } from '../context.js';

/** An agent a part is assigned to, as the app shows it: its name, and its picture when it has one. */
export type Assignee = { path: string; name: string; picture?: string };

/**
 * The agent a part is assigned to, by the path written in the part, from the agents the window lists.
 *
 * @param composer - The window's composer.
 * @param assignee - The path as written, if the part is assigned.
 * @returns The agent, or nothing when the part isn't assigned.
 */
export function assigneeAt(composer: Composer, assignee?: string): Assignee | undefined {
  if (!assignee) return;
  const path = composer.pathOf(assignee);
  const agent = composer.agents.find((each) => each.path === path);
  return { path, name: agent?.name ?? path.split('/').pop()?.replace(/\.agent$/, '') ?? assignee, picture: agent?.thumbnail };
}

/**
 * The agent a clip is assigned to, by its `meta.assignee`.
 *
 * @param composer - The window's composer.
 * @param segment - The clip's segment.
 * @returns The agent, or nothing when the clip isn't assigned.
 */
export function clipAssignee(composer: Composer, segment: TimelineSegment): Assignee | undefined {
  const assignee = segment.meta?.assignee;
  return typeof assignee === 'string' ? assigneeAt(composer, assignee) : undefined;
}
