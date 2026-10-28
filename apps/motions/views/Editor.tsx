import { canCaptureVideo, type VideoStageAria } from '@airlib/aria';
import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $static, $use, For, onCleanup, onMount, Show, setup, template } from '@airlib/react';
import { Button, EmptyState, Stage, TimelineEditor, Toggle, Tooltip } from '@airlib/react-aui';
import { createTimeline, type Timeline } from '@airlib/react/timeline';
import { documentAt, follow } from '@/lib/documents/store.js';
import type { MotionAsset, StageDocument, StillDocument } from '@/lib/documents/types.js';
import { Clips } from './Clips.js';
import { download, type RenderedVideo, renderMp4 } from './export.js';
import { SnapIcon } from './icons.js';
import { castsOf, type Project } from './library.js';
import { type MotionsSession, sessionCtx } from './session.js';

const STAGE_LABELS = { play: 'Play', pause: 'Pause', seek: 'Seek', fullscreen: 'Full screen' };

/** Where turning HTML-in-Canvas on lives, for people whose Chrome doesn't have it yet. */
const CAPTURE_FLAG = 'chrome://flags/#canvas-draw-element';

/** How many stages render together unless told otherwise: four frames per screen refresh. */
const RENDER_STAGES = 4;

type ComposeViewProps = {
  project: Project;
  source: StageDocument;
  path: string;
  /** Opens a document, by path, in its own view. */
  open: (path: string) => void;
};

/**
 * Compose: one stage of a project put together as video. The project's assets and casts on glass,
 * the stage on black — so its colours are judged against nothing — and its clips laid out in time
 * on glass beneath. The layout follows the stage's own shape: a wide stage above a wide timeline,
 * a tall one in a column of its own. Stage and timeline follow one timeline, so playing either
 * moves both. Rendering swaps the stage for capturing ones that show each frame as it's encoded.
 */
export const ComposeView = setup<ComposeViewProps>((props) => {
  const source = $static(() => props.source);
  const project = $static(() => props.project);
  const stage = source.composition.props;
  const portrait = stage.height > stage.width;
  const timeline = createTimeline({ frameRate: source.composition.options.frameRate });
  timeline.hydrate(source.composition);

  // The window and its dock follow what's open here: this stage's timeline, the clips picked on it,
  // and its render, started from the window's toolbar.
  const session = sessionCtx.get() as MotionsSession;
  Object.assign(session, {
    stage: $static(() => props.path),
    timeline,
    clips: [],
    status: '',
    rendering: false,
    render: () => {
      session.download = undefined;
      if (!canCaptureVideo()) {
        session.status = `Rendering needs HTML-in-Canvas: open ${CAPTURE_FLAG} in Chrome, enable it, and relaunch.`;
        return;
      }
      session.status = '';
      timeline.pause();
      session.rendering = true;
    },
    download: undefined,
  });
  onCleanup(() => {
    if (session.timeline !== timeline) return;
    Object.assign(session, { stage: undefined, timeline: undefined, clips: [], status: '', rendering: false, render: undefined, download: undefined });
  });

  const finish = (result?: RenderedVideo) => {
    session.rendering = false;
    session.status = result ? describe(result) : '';
    session.download = result ? () => download(result.file, `${source.name}.mp4`) : undefined;
    if (result) download(result.file, `${source.name}.mp4`);
  };

  return () => (
    <div
      className="wedyan-compose"
      data-shape={portrait ? 'portrait' : 'landscape'}
      style={{ '--wedyan-stage-ratio': `${stage.width} / ${stage.height}`, '--wedyan-stage-aspect': stage.width / stage.height } as never}
    >
      <div className="wedyan-compose-layout">
        <Sources project={project} open={props.open} />
        <section className="wedyan-compose-preview" aria-label="Preview">
          <Show when={() => !session.rendering} fallback={() => <MotionRender source={source} finish={finish} />}>
            {() => (
              <Stage label={source.name} timeline={timeline} width={stage.width} height={stage.height} labels={STAGE_LABELS}>
                <Clips timeline={timeline} />
              </Stage>
            )}
          </Show>
        </section>
        <section className="wedyan-compose-timeline aui-glass-panel" aria-label="Timeline">
          <TimelineEditor
            label={`Clips in ${source.name}`}
            timeline={timeline}
            value={$bind(session, 'clips')}
            multiple
            snap={$use(() => session.snap)}
            playheadLabel="Playhead"
            zoom={56}
          >
            {/* Whether dragging snaps, beside the ruler it snaps along. */}
            <TimelineEditor.Snippet for="corner">
              {() => (
                <Toggle aria-label="Snap" variant="text" size="xs" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(session, 'snap')}>
                  <SnapIcon />
                  <Tooltip>Snap</Tooltip>
                </Toggle>
              )}
            </TimelineEditor.Snippet>
          </TimelineEditor>
        </section>
      </div>
    </div>
  );
}, 'ComposeView');

/**
 * What a stage can be made from, each on its own panel: the project's assets — a generated one
 * opens in its own view — and its casts, the personas its stages name.
 */
const Sources = template<{ project: Project; open: (path: string) => void }>((props) => {
  const { project, open } = props;
  const casts = castsOf(project);
  return (
    <>
      <section className="wedyan-compose-group wedyan-compose-assets aui-glass-panel" aria-labelledby="wedyan-compose-assets">
        <h3 id="wedyan-compose-assets">Assets</h3>
        <ul className="wedyan-compose-tiles">
          {project.document.assets.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                className="wedyan-compose-tile"
                title={asset.name}
                onDoubleClick={() => (asset.kind === 'still' || asset.kind === 'take') && open(follow(project.path, asset.src).path)}
              >
                <AssetPicture from={project.path} asset={asset} />
                <span>{asset.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="wedyan-compose-group wedyan-compose-casts aui-glass-panel" aria-labelledby="wedyan-compose-casts">
        <h3 id="wedyan-compose-casts">Casts</h3>
        {casts.length ? (
          <ul className="wedyan-compose-tiles">
            {casts.map(({ path, document }) => (
              <li key={path}>
                <button type="button" className="wedyan-compose-tile" title={document.description ?? document.name}>
                  {document.looks[0] ? <img src={document.looks[0]} alt="" /> : <span className="wedyan-compose-tile-blank" />}
                  <span>{document.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState size="sm" title="No casts yet" description="The people and characters this project's stages name show here." />
        )}
      </section>
    </>
  );
}, 'Sources');

/** An asset's picture: an image itself, a still's chosen attempt, or nothing for sound. */
const AssetPicture = template<{ from: string; asset: MotionAsset }>((props) => {
  const { asset, from } = props;
  let src = asset.kind === 'image' ? asset.src : undefined;
  if (asset.kind === 'still') {
    const still = documentAt<'still'>(follow(from, asset.src).path) as StillDocument | undefined;
    src = still?.attempts.find((attempt) => attempt.id === still.chosen)?.src;
  }
  return src ? <img src={src} alt="" /> : <span className="wedyan-compose-tile-blank" data-kind={asset.kind} />;
}, 'AssetPicture');

type MotionRenderProps = {
  source: StageDocument;
  /** How many stages render consecutive frames together; each adds a frame per screen refresh. Defaults to 4. */
  stages?: number;
  /** Hears the render end: what it made, or nothing when it was cancelled or failed. */
  finish: (result?: RenderedVideo) => void;
};

/**
 * A render in progress: several capturing stages, each on its own copy of the stage's timeline,
 * drawing consecutive frames together, which is what gets encoded. The first is shown as the
 * render's picture, the rest beside it, with a way to stop it; how far it is shows in the toolbar.
 */
const MotionRender = setup<MotionRenderProps>((props) => {
  const source = $static(() => props.source);
  const session = sessionCtx.get() as MotionsSession;
  const stop = new AbortController();
  const timelines = Array.from({ length: Math.max(1, $static(() => props.stages) ?? RENDER_STAGES) }, () => {
    const timeline = createTimeline({ frameRate: source.composition.options.frameRate });
    timeline.hydrate(source.composition);
    return timeline;
  });
  const stages: VideoStageAria[] = [];
  const lanes = timelines.slice(1).map((timeline, at) => ({ timeline, index: at + 1 }));

  onMount(() => {
    session.status = 'Rendering…';
    renderMp4(stages, ({ done, total }) => (session.status = `Rendering ${done} of ${total} frames`), stop.signal)
      .then((result) => props.finish(result))
      .catch((error) => {
        if (!stop.signal.aborted) console.error(error);
        props.finish();
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
      width={source.composition.props.width}
      height={source.composition.props.height}
      capture
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
        {timelines.length > 1 && (
          <div className="wedyan-motions-render-lanes" aria-hidden="true">
            <For each={lanes}>{(lane) => renderStage(lane.timeline, lane.index)}</For>
          </div>
        )}
        <Button size="sm" variant="text" onClick={() => stop.abort()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}, 'MotionRender');

/**
 * A finished render as one line: how much it made and how fast.
 *
 * @param result - The render.
 * @returns E.g. "Rendered 120 frames, 1.4 MB, in 2.1 s".
 */
function describe(result: RenderedVideo): string {
  return `Rendered ${result.frames} frames, ${(result.file.size / 1e6).toFixed(1)} MB, in ${result.seconds.toFixed(1)} s`;
}
