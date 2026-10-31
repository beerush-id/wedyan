import type { VideoStageAria } from '@airlib/aria';
import { $static, onMount, setup, snapshot } from '@airlib/react';
import { createTimeline } from '@airlib/react/timeline';
import { Button, Stage } from '@airlib/react-aui';
import type { StageDocument } from '@/lib/documents/types.js';
import { download } from '@/lib/systems/download.js';
import { type Composer, composerCtx } from '../context.js';
import { type RenderedVideo, renderMp4 } from '../export.js';
import { mediaLoader } from '../media.js';
import { Clips } from './Clips.js';

/** A render's media: the files themselves, at their own sharpness. */
const renderMedia = mediaLoader();

/**
 * A render in progress: one capturing stage, on its own copy of the stage's timeline, whose every
 * frame is encoded, with a way to stop it; how far it is shows in the toolbar. A stage draws text
 * only as the browser paints it, so one stage, at the size it's seen, is one that's always painted.
 */
export const Rendering = setup(() => {
  const composer = composerCtx.get() as Composer;
  const source = $static(() => composer.stage) as StageDocument;
  const stop = new AbortController();

  // A render is of the composition as it is when the render starts.
  const { composition } = snapshot(source);
  const timeline = createTimeline({ frameRate: composition.options.frameRate });
  timeline.hydrate(composition);
  let stage: VideoStageAria;

  const finish = (result?: RenderedVideo) => {
    composer.rendering = false;
    composer.status = result ? describe(result) : '';
    if (result) download(result.file, `${source.name}.mp4`);
  };

  onMount(() => {
    composer.status = 'Rendering…';
    renderMp4(stage, renderMedia, ({ done, total }) => (composer.status = `Rendering ${done} of ${total} frames`), stop.signal)
      .then(finish)
      .catch((error) => {
        if (!stop.signal.aborted) console.error(error);
        finish();
      })
      .finally(() => timeline.destroy());

    return () => stop.abort();
  });

  return () => (
    <div className="wedyan-motions-render">
      <Stage
        label={`Rendering ${source.name}`}
        timeline={timeline}
        width={composition.props.width}
        height={composition.props.height}
        capture
        media={renderMedia}
        controls={false}
        controller={(controller) => {
          stage = controller;
        }}
      >
        <Clips timeline={timeline} />
      </Stage>
      <Button size="sm" variant="text" onClick={() => stop.abort()}>
        Cancel
      </Button>
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
