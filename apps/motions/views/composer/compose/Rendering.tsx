import type { VideoStageAria } from '@airlib/aria';
import { $static, onMount, setup, snapshot } from '@airlib/react';
import { createTimeline } from '@airlib/react/timeline';
import { Button, Stage, toast } from '@airlib/react-aui';
import type { StageDocument } from '@/lib/documents/types.js';
import { download } from '@/lib/systems/download.js';
import { type Composer, composerCtx } from '../context.js';
import { type RenderedVideo, renderMp4 } from '../export.js';
import { mediaLoader } from '../media.js';
import { sampleClip } from '../sampling.js';
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

  // How it ended shows in a toast too: a render runs on its own, and the window may be out of sight.
  const finish = (result: RenderedVideo) => {
    const file = `${source.name}.mp4`;
    composer.rendering = false;
    composer.status = describe(result);
    download(result.file, file);
    toast.success(`${file} is rendered and downloaded. ${composer.status}.`);
  };
  const fail = (error: Error) => {
    composer.rendering = false;
    // Cancelling is the user's own doing: nothing to tell.
    composer.status = stop.signal.aborted ? '' : `Rendering failed: ${error.message}`;
    if (!stop.signal.aborted) toast.error(`${source.name} couldn't be rendered: ${error.message}`);
  };

  onMount(() => {
    composer.status = 'Rendering…';
    renderMp4(stage, renderMedia, ({ done, total }) => (composer.status = `Rendering ${done} of ${total} frames`), stop.signal)
      .then(finish, fail)
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
        sample={sampleClip}
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
