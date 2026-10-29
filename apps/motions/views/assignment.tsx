import { template } from '@airlib/react';
import { Avatar, Tooltip } from '@airlib/react-aui';
import type { TimelineSegment } from '@airlib/react/timeline';
import { follow } from '@/lib/documents/store.js';

/** An agent a part is assigned to, as the app shows it: its name, and its picture when it has one. */
export type Assignee = { path: string; name: string; picture?: string };

/**
 * The agent a part is assigned to, by the path written in the part: named by its document when
 * there is one, else by its file's name, e.g. `../../Agents/Scriptwriter.agent` is "Scriptwriter".
 *
 * @param from - The path of the document the assignment is written in.
 * @param assignee - The path as written, if the part is assigned.
 * @returns The agent, or nothing when the part isn't assigned.
 */
export function assigneeAt(from: string, assignee?: string): Assignee | undefined {
  if (!assignee) return;
  const found = follow(from, assignee);
  const document = found.document as { name?: string; picture?: string } | undefined;
  const name = document?.name ?? found.path.split('/').pop()?.replace(/\.agent$/, '') ?? assignee;
  return { path: found.path, name, picture: document?.picture };
}

/**
 * The agent a clip is assigned to, by its `meta.assignee`, written by path from its stage.
 *
 * @param stage - The stage's path.
 * @param segment - The clip's segment.
 * @returns The agent, or nothing when the clip isn't assigned.
 */
export function clipAssignee(stage: string | undefined, segment: TimelineSegment): Assignee | undefined {
  const assignee = segment.meta?.assignee;
  return stage && typeof assignee === 'string' ? assigneeAt(stage, assignee) : undefined;
}

/** The agent a part is assigned to, as its avatar, named by a tooltip. */
export const AssigneeAvatar = template<{ assignee: Assignee; size?: 'xs' | 'sm' | 'md' }>(
  ({ assignee, size = 'sm' }) => (
    <Avatar size={size} alt={assignee.name} src={assignee.picture} className="wedyan-assignee">
      <Tooltip>Assigned to {assignee.name}</Tooltip>
    </Avatar>
  ),
  'AssigneeAvatar'
);
