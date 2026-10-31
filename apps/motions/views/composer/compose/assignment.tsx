import { template } from '@airlib/react';
import { Avatar, Tooltip } from '@airlib/react-aui';
import type { Assignee } from './assignee.js';

/** The agent a part is assigned to, as its avatar, named by a tooltip. */
export const AssigneeAvatar = template<{ assignee: Assignee; size?: 'xs' | 'sm' | 'md' }>(
  ({ assignee, size = 'sm' }) => (
    <Avatar size={size} alt={assignee.name} src={assignee.picture} className="wedyan-assignee">
      <Tooltip>Assigned to {assignee.name}</Tooltip>
    </Avatar>
  ),
  'AssigneeAvatar',
);
