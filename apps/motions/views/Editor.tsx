import { canCaptureVideo, type VideoStageAria } from '@airlib/aria';
import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $static, $use, For, onCleanup, onMount, Show, Snippet, setup, template } from '@airlib/react';
import {
  Button,
  EmptyState,
  Stage,
  TabButton,
  TabList,
  TabPanel,
  Tabs,
  TimelineEditor,
  Toggle,
  Tooltip,
} from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import { createTimeline, type Timeline, type TimelineSegment } from '@airlib/react/timeline';
import { documentAt, follow } from '@/lib/documents/store.js';
import type { MotionAsset, StageDocument, StillDocument } from '@/lib/documents/types.js';
import { Clips } from './Clips.js';
import { download, type RenderedVideo, renderMp4 } from './export.js';
import { buffers, mediaLoader } from './media.js';
import { SnapIcon } from './icons.js';
import { castsOf, type Project } from './library.js';
import { Properties } from './Properties.js';
import { type MotionsSession, sessionCtx } from './session.js';

const STAGE_LABELS = { play: 'Play', pause: 'Pause', seek: 'Seek', fullscreen: 'Full screen' };

/** Where turning HTML-in-Canvas on lives, for people whose Chrome doesn't have it yet. */
const CAPTURE_FLAG = 'chrome://flags/#canvas-draw-element';

/** How many stages render together unless told otherwise: four frames per screen refresh. */
const RENDER_STAGES = 4;

/** The preview's media: buffered as it opens, so scrubbing anywhere is quick. */
const previewMedia = mediaLoader({ autobuffer: true });

/** A render's media: the files themselves, at their own sharpness. */
const renderMedia = mediaLoader();

/**
 * How far a clip's media is through buffering, while it is, for the timeline to show on the clip.
 *
 * @param segment - The clip's segment.
 * @returns Its progress from 0 to 1, or nothing when it isn't buffering.
 */
const buffering = (segment: TimelineSegment): number | undefined => {
  const src = (segment.props as { src?: string }).src;
  const buffer = src ? buffers[src] : undefined;
  return buffer?.status === 'buffering' ? buffer.progress : undefined;
};

/**
 * A frame as a timecode: hours, minutes, seconds and the frame within its second, two digits each.
 *
 * @param frame - The frame, from the start.
 * @param frameRate - Frames a second.
 * @returns The timecode, e.g. `00:00:01:12`.
 */
const timecode = (frame: number, frameRate: number): string => {
  const seconds = Math.floor(frame / frameRate);
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, Math.round(frame % frameRate)];
  return parts.map((part) => String(part).padStart(2, '0')).join(':');
};

type ComposeViewProps = {
  project: Project;
  source: StageDocument;
  path: string;
  /** Opens a document, by path, in its own view. */
  open: (path: string) => void;
};

/**
 * Compose: one stage of a project put together as video. The project's assets and casts on glass,
 * the stage on black — so its colours are judged against nothing — the picked clip's properties
 * beside it, and its clips laid out in time on glass beneath. The layout follows the stage's own shape: a wide stage above a wide timeline,
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
      if (!canCaptureVideo()) {
        session.status = `Rendering needs HTML-in-Canvas: open ${CAPTURE_FLAG} in Chrome, enable it, and relaunch.`;
        return;
      }
      session.status = '';
      timeline.pause();
      session.rendering = true;
    },
  });
  onCleanup(() => {
    if (session.timeline !== timeline) return;
    Object.assign(session, { stage: undefined, timeline: undefined, clips: [], status: '', rendering: false, render: undefined });
  });

  const finish = (result?: RenderedVideo) => {
    session.rendering = false;
    session.status = result ? describe(result) : '';
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
        <WindowPanel surface="solid" role="region" aria-label="Preview" className="wedyan-compose-preview">
          <Show when={() => !session.rendering} fallback={() => <MotionRender source={source} finish={finish} />}>
            {() => (
              <Stage
                label={source.name}
                timeline={timeline}
                width={stage.width}
                height={stage.height}
                media={previewMedia}
                labels={STAGE_LABELS}
              >
                <Clips timeline={timeline} />
              </Stage>
            )}
          </Show>
        </WindowPanel>
        <Properties />
        <WindowPanel role="region" aria-label="Timeline" className="wedyan-compose-timeline">
          <TimelineEditor
            label={`Clips in ${source.name}`}
            timeline={timeline}
            value={$bind(session, 'clips')}
            multiple
            snap={$use(() => session.snap)}
            autofocus
            progress={buffering}
            playheadLabel="Playhead"
            zoom={56}
          >
            {/* Whether dragging snaps, beside the ruler it snaps along, then the playhead's timecode. */}
            <TimelineEditor.Snippet for="corner">
              {() => (
                <>
                  <Toggle aria-label="Snap" variant="text" size="xs" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(session, 'snap')}>
                    <SnapIcon />
                    <Tooltip>Snap</Tooltip>
                  </Toggle>
                  <Snippet>
                    {() => (
                      <span className="wedyan-compose-timecode" aria-label="Playhead timecode">
                        {timecode(timeline.state.frame, timeline.frameRate)}
                      </span>
                    )}
                  </Snippet>
                </>
              )}
            </TimelineEditor.Snippet>
          </TimelineEditor>
        </WindowPanel>
      </div>
    </div>
  );
}, 'ComposeView');

/** The asset kinds drawn on the stage, as against sound. */
const PICTURE_KINDS = new Set<MotionAsset['kind']>(['image', 'still', 'video', 'take']);

/**
 * What a stage can be made from, on one panel, narrowed by kind: everything — the project's assets
 * and its casts — or only its pictures and footage, its sound, or its casts, the personas its
 * stages name. A generated asset opens in its own view.
 */
const Sources = template<{ project: Project; open: (path: string) => void }>((props) => {
  const { project, open } = props;
  const assets = project.document.assets;
  const pictures = assets.filter((asset) => PICTURE_KINDS.has(asset.kind));
  const sounds = assets.filter((asset) => !PICTURE_KINDS.has(asset.kind));
  const casts = castsOf(project);
  return (
    <WindowPanel role="region" aria-label="Sources" className="wedyan-compose-group wedyan-compose-sources">
      <Tabs size="xs" value="all">
        <TabList label="Show">
          <TabButton name="all">All</TabButton>
          <TabButton name="video">Video</TabButton>
          <TabButton name="audio">Audio</TabButton>
          <TabButton name="cast">Cast</TabButton>
        </TabList>
        <TabPanel name="all">
          {assets.length || casts.length ? (
            <ul className="wedyan-compose-tiles">
              <AssetTiles project={project} open={open} assets={assets} />
              <CastTiles casts={casts} />
            </ul>
          ) : (
            <EmptyState size="sm" title="Nothing yet" description="This project's assets and casts show here." />
          )}
        </TabPanel>
        <TabPanel name="video">
          {pictures.length ? (
            <ul className="wedyan-compose-tiles">
              <AssetTiles project={project} open={open} assets={pictures} />
            </ul>
          ) : (
            <EmptyState size="sm" title="No video yet" description="The pictures and footage this project has show here." />
          )}
        </TabPanel>
        <TabPanel name="audio">
          {sounds.length ? (
            <ul className="wedyan-compose-tiles">
              <AssetTiles project={project} open={open} assets={sounds} />
            </ul>
          ) : (
            <EmptyState size="sm" title="No audio yet" description="The music and sound this project has show here." />
          )}
        </TabPanel>
        <TabPanel name="cast">
          {casts.length ? (
            <ul className="wedyan-compose-tiles">
              <CastTiles casts={casts} />
            </ul>
          ) : (
            <EmptyState size="sm" title="No casts yet" description="The people and characters this project's stages name show here." />
          )}
        </TabPanel>
      </Tabs>
    </WindowPanel>
  );
}, 'Sources');

/** Assets as tiles of a tile list, each its picture and name; a generated one opens in its own view on a double click. */
const AssetTiles = template<{ project: Project; open: (path: string) => void; assets: MotionAsset[] }>((props) => {
  const { project, open, assets } = props;
  return (
    <>
      {assets.map((asset) => (
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
    </>
  );
}, 'AssetTiles');

/** Casts as tiles of a tile list, each its first look and name. */
const CastTiles = template<{ casts: ReturnType<typeof castsOf> }>(({ casts }) => (
  <>
    {casts.map(({ path, document }) => (
      <li key={path}>
        <button type="button" className="wedyan-compose-tile" title={document.description ?? document.name}>
          {document.looks[0] ? <img src={document.looks[0]} alt="" /> : <span className="wedyan-compose-tile-blank" />}
          <span>{document.name}</span>
        </button>
      </li>
    ))}
  </>
), 'CastTiles');

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
