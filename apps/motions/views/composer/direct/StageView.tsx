import { AUI_CLASS } from '@airlib/aui/utils';
import { $use, setup, untrack } from '@airlib/react';
import { Button, EmptyState, Tooltip } from '@airlib/react-aui';
import { DirectContent } from '@/components/Direct.js';
import { ComposeIcon, ScriptIcon } from '../../icons.js';
import { duration, newScript, shortDate } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';
import { ScriptAbout } from './ScriptAbout.js';
import { ScriptPane } from './ScriptPane.js';

/**
 * The picked stage: its script, beside its picture, what it is, who's in it, and a way into Compose.
 * A stage without a script says so, and offers to write one.
 */
export const StageView = setup(() => {
  const composer = composerCtx.get() as Composer;

  const write = () => {
    if (composer.stage) void newScript(composer.path, composer.stage);
  };

  return () => {
    if (composer.activeView !== 'stage') return null;
    return (
      <DirectContent>
        <ScriptPane path={$use(() => composer.stage?.script && composer.pathOf(composer.stage.script))} label="About the stage">
          <ScriptPane.Snippet for="about">{() => <StageAbout />}</ScriptPane.Snippet>
          <ScriptPane.Snippet for="actions">
            {() => (
              <Button aria-label="Open in Compose" size="sm" variant="filled" className={AUI_CLASS.CONTROL_ICON} onClick={() => (composer.mode = 'compose')}>
                <ComposeIcon />
                <Tooltip>Open in Compose</Tooltip>
              </Button>
            )}
          </ScriptPane.Snippet>
          <ScriptPane.Snippet for="empty">
            {() => (
              <EmptyState title="No script yet" description="This stage has no script.">
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
}, 'StageView');

/** What the stage is, in its aside. */
const StageAbout = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => {
    const { stage, stagePath, stages, people } = composer;
    if (!stage) return null;
    const { width, height } = stage.composition.props;
    // Its row already says how long it runs and what it shows, and the lists are what change: reading
    // through the clips or everyone listed would watch every one of them.
    const { row, casts } = untrack(() => ({
      row: stages.find(({ path }) => path === stagePath),
      casts: (stage.casts ?? []).map((cast) => people.find((person) => person.path === composer.pathOf(cast))?.name).filter(Boolean),
    }));
    return (
      <ScriptAbout
        picture={row?.thumbnail ?? composer.motion?.cover}
        ratio={`${width} / ${height}`}
        document={stage}
        facts={[
          { label: 'Length', value: duration(row?.duration ?? 0) },
          { label: 'Size', value: `${width} × ${height}` },
          ...(casts.length ? [{ label: 'Casts', value: casts.join(', ') }] : []),
          { label: 'Updated', value: shortDate(stage.updated) },
        ]}
      />
    );
  };
}, 'StageAbout');
