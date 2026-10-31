import type { VideoStageAria } from '@airlib/aria';
import { $static, For, onMount, setup, snapshot } from '@airlib/react';
import { createTimeline, type Timeline } from '@airlib/react/timeline';
import { Button, Stage } from '@airlib/react-aui';
import type { StageDocument } from '@/lib/documents/types.js';
import { download } from '@/lib/systems/download.js';
import { type Composer, composerCtx } from '../context.js';
import { type RenderedVideo, renderMp4 } from '../export.js';
import { mediaLoader } from '../media.js';
import { Clips } from './Clips.js';

/** How many stages render together: four frames per screen refresh. */
const RENDER_STAGES = 4;

/** A render's media: the files themselves, at their own sharpness. */
const renderMedia = mediaLoader();

/**
 * A render in progress: several capturing stages, each on its own copy of the stage's timeline,
 * drawing consecutive frames together, which is what gets encoded. The first is shown as the
 * render's picture, the rest beside it, with a way to stop it; how far it is shows in the toolbar.
 */
export const Rendering = setup(() => {
  const composer = composerCtx.get() as Composer;
  const source = $static(() => composer.stage) as StageDocument;
  const stop = new AbortController();

  // A render is of the composition as it is when the render starts: each stage takes a copy.
  const { composition } = snapshot(source);
  const timelines = Array.from({ length: RENDER_STAGES }, () => {
    const timeline = createTimeline({ frameRate: composition.options.frameRate });
    timeline.hydrate(composition);
    return timeline;
  });
  const stages: VideoStageAria[] = [];
  const lanes = timelines.slice(1).map((timeline, at) => ({ timeline, index: at + 1 }));

  const finish = (result?: RenderedVideo) => {
    composer.rendering = false;
    composer.status = result ? describe(result) : '';
    if (result) download(result.file, `${source.name}.mp4`);
  };

  onMount(() => {
    composer.status = 'Rendering…';
    renderMp4(stages, ({ done, total }) => (composer.status = `Rendering ${done} of ${total} frames`), stop.signal)
      .then(finish)
      .catch((error) => {
        if (!stop.signal.aborted) console.error(error);
        finish();
      })
      .finally(() => {
        for (const timeline of timelines) timeline.destroy();
      });

    return () => stop.abort();
  });

  const renderStage = (timeline: Timeline, index: number) => (
    <Stage
      label={index === 0 ? `Rendering ${source.name}` : undefined}
      timeline={timeline}
      width={composition.props.width}
      height={composition.props.height}
      capture
      media={renderMedia}
      controls={false}
      controller={(controller) => {
        stages[index] = controller;
      }}
    >
      <Clips timeline={timeline} />
    </Stage>
  );

  return () => (
    <div className="wedyan-motions-render">
      {renderStage(timelines[0], 0)}
      <div className="wedyan-motions-render-foot">
        <div className="wedyan-motions-render-lanes" aria-hidden="true">
          <For each={lanes}>{(lane) => renderStage(lane.timeline, lane.index)}</For>
        </div>
        <Button size="sm" variant="text" onClick={() => stop.abort()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}, 'Rendering');

/**
 * A finished render as one line: how much it made and how fast.
 *
 * @param result - The render.
 * @returns E.g. "Rendered 120 frames, 1.4 MB, in 2.1 s".
 */
function describe(result: RenderedVideo): string {
  return `Rendered ${result.frames} frames, ${(result.file.size / 1e6).toFixed(1)} MB, in ${result.seconds.toFixed(1)} s`;
}
