import { $static, onCleanup, Show, Snippet, setup } from '@airlib/react';
import { createTimeline } from '@airlib/react/timeline';
import { EmptyState, Stage } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import type { StageDocument } from '@/lib/documents/types.js';
import { ComposeIcon } from '../../icons.js';
import { type Composer, composerCtx } from '../context.js';
import { mediaLoader } from '../media.js';
import { Clips } from './Clips.js';
import { Nodes } from './Nodes.js';
import { Prompt } from './Prompt.js';
import { Properties } from './Properties.js';
import { Rendering } from './Rendering.js';
import { Sources } from './Sources.js';
import { TimelinePanel } from './TimelinePanel.js';

const STAGE_LABELS = { play: 'Play', pause: 'Pause', seek: 'Seek', fullscreen: 'Full screen' };

/** The preview's media: buffered as it opens, so scrubbing anywhere is quick. */
const previewMedia = mediaLoader({ autobuffer: true });

/** Compose, or what it says while the project has no stage to put together. */
export const Compose = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <Show
      when={() => composer.stage}
      fallback={() => (
        <EmptyState title="No stage yet" description="Add a stage in Direct to put it together here.">
          <EmptyState.Snippet for="icon">{() => <ComposeIcon />}</EmptyState.Snippet>
        </EmptyState>
      )}
    >
      {() => <ComposeStage />}
    </Show>
  );
}, 'Compose');

/**
 * One stage put together as video: the project's sources on glass, the stage on black — so its
 * colours are judged against nothing — the picked clip's properties beside it, and its clips laid
 * out in time on glass beneath. The layout follows the stage's own shape. Rendering swaps the stage
 * for capturing ones that show each frame as it's encoded.
 */
const ComposeStage = setup(() => {
  const composer = composerCtx.get() as Composer;

  // Compose shows one stage for as long as it's open: another is picked from Direct, which closes it.
  const composition = $static(() => composer.stage?.composition) as StageDocument['composition'];
  // The timeline controls the stage's composition in place: every edit lands in the document.
  const timeline = createTimeline({ source: composition });
  const size = () => composition.props;

  Object.assign(composer, { timeline, clips: [], node: '', snap: false, status: '', rendering: false });
  onCleanup(() => Object.assign(composer, { clips: [], node: '', status: '', rendering: false }));

  return () => (
    <div
      className="wedyan-compose"
      data-shape={size().height > size().width ? 'portrait' : 'landscape'}
      style={{ '--wedyan-stage-ratio': `${size().width} / ${size().height}`, '--wedyan-stage-aspect': size().width / size().height } as never}
    >
      <div className="wedyan-compose-layout">
        {/* The sources show while the sidebar does; the layout follows which panels are there. */}
        <Show when={() => composer.sidebar}>{() => <Sources />}</Show>
        <WindowPanel surface="solid" role="region" aria-label="Preview" className="wedyan-compose-preview">
          <Show when={() => !composer.rendering} fallback={() => <Rendering />}>
            {() => (
              <Stage label={composer.stage?.name} timeline={timeline} width={size().width} height={size().height} media={previewMedia} labels={STAGE_LABELS}>
                <Clips timeline={timeline} />
              </Stage>
            )}
          </Show>
        </WindowPanel>
        <Properties />
        <TimelinePanel />
        {/* How the picked clip's source was made, beside the timeline, while a generated clip is picked. */}
        <Snippet>
          {() =>
            composer.generativeClip() && (
              <WindowPanel role="region" aria-label="Prompt" className="wedyan-compose-group wedyan-compose-prompt">
                <Prompt />
              </WindowPanel>
            )
          }
        </Snippet>
        {/* What's nested in the picked clip, in the same place, while an HTML clip is picked. */}
        <Snippet>
          {() =>
            composer.hostClip()?.type === 'html' && (
              <WindowPanel role="region" aria-label="Elements" className="wedyan-compose-group wedyan-compose-prompt">
                <Nodes />
              </WindowPanel>
            )
          }
        </Snippet>
      </div>
    </div>
  );
}, 'ComposeStage');
