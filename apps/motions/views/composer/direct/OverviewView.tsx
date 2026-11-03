import { $use, setup } from '@airlib/react';
import { Button, EmptyState } from '@airlib/react-aui';
import { DirectContent } from '@/components/Direct.js';
import { ScriptIcon } from '../../icons.js';
import { duration, newMotionScript, shortDate } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';
import { ScriptAbout } from './ScriptAbout.js';
import { ScriptPane } from './ScriptPane.js';

/**
 * The project itself: its whole script, beside its cover, what it is, and where it stands. A project
 * without a script says so, and offers to write one.
 */
export const OverviewView = setup(() => {
  const composer = composerCtx.get() as Composer;

  const write = () => {
    if (composer.motion) void newMotionScript(composer.path, composer.motion);
  };

  return () => {
    if (composer.activeView !== 'overview') return null;
    return (
      <DirectContent>
        <ScriptPane
          path={$use(() => composer.motion?.script && composer.pathOf(composer.motion.script.path))}
          script={$use(() => composer.motion?.script)}
          label="About the motion"
        >
          <ScriptPane.Snippet for="about">{() => <OverviewAbout />}</ScriptPane.Snippet>
          <ScriptPane.Snippet for="empty">
            {() => (
              <EmptyState title="No script yet" description="This motion has no script.">
                <EmptyState.Snippet for="icon">{() => <ScriptIcon />}</EmptyState.Snippet>
                <EmptyState.Snippet for="action">
                  {() => (
                    <Button size="sm" variant="filled" onClick={write}>
                      Write its script
                    </Button>
                  )}
                </EmptyState.Snippet>
              </EmptyState>
            )}
          </ScriptPane.Snippet>
        </ScriptPane>
      </DirectContent>
    );
  };
}, 'OverviewView');

/** What the project is, in its aside. */
const OverviewAbout = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => {
    const { motion, stages, seconds } = composer;
    if (!motion) return null;
    const made = duration(seconds);
    return (
      <ScriptAbout
        picture={motion.cover}
        ratio={motion.aspect.replace(':', ' / ')}
        document={motion}
        facts={[
          { label: 'Length', value: motion.length ? `${made} of ${duration(motion.length)}` : made },
          { label: 'Aspect', value: motion.aspect },
          { label: 'Stages', value: String(stages.length) },
          { label: 'Status', value: motion.status === 'rendered' ? 'Rendered' : 'Draft' },
          { label: 'Made by', value: motion.author.kind === 'agent' ? 'Wedyan' : 'You' },
          ...(motion.author.kind === 'agent' && motion.author.ask ? [{ label: 'Asked', value: motion.author.ask }] : []),
          { label: 'Updated', value: shortDate(motion.updated) },
        ]}
      />
    );
  };
}, 'OverviewAbout');
