import { setup, Snippet } from '@airlib/react';
import { type Composer, composerCtx } from '../context.js';
import { clipAssignee } from './assignee.js';
import { AssigneeAvatar } from './assignment.js';

/** Who the picked clip is assigned to, over what can be changed on it. */
export const Assigned = setup(() => {
  const composer = composerCtx.get() as Composer;
  const agent = () => {
    const segment = composer.hostClip();
    return segment && clipAssignee(composer, segment);
  };

  return () => (
    <Snippet data={agent}>
      {(assignee) =>
        assignee ? (
          <div className="wedyan-compose-assignee">
            <span>Assigned to</span>
            <span className="wedyan-compose-assignee-agent">
              <AssigneeAvatar assignee={assignee} size="xs" />
              <span>{assignee.name}</span>
            </span>
          </div>
        ) : null
      }
    </Snippet>
  );
}, 'Assigned');
