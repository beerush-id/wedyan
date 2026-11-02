import { canCaptureVideo } from '@airlib/aria';
import { type AnyType, createContext, effect, type history, mutable } from '@airlib/react';
import type { Timeline, TimelineSegment, TimelineTrack } from '@airlib/react/timeline';
import type { PersonTab } from '@/apps/lounge/views/session.js';
import { attemptPicture, chosenAttempt, isGenerative, settingsOf } from '@/lib/documents/generation.js';
import { parentOf, resolvePath } from '@/lib/documents/paths.js';
import { type FileRow, rowsOf } from '@/lib/documents/rows.js';
import type { GenerativeDocument, MotionDocument, StageDocument } from '@/lib/documents/types.js';
import { LOUNGE, LOUNGE_EVENT } from '@/lib/kernel/workspace.h.js';
import { dfs } from '@/lib/share/dfs.js';
import { generateSpeech, generateTakePicture } from '@/lib/share/generate.js';
import { documentAt, follow, type Project } from '../motion.js';
import type { HtmlClip, NodeKeyframe } from './composition.js';
import { findNode } from './nodes.js';
import { showAttempt } from './placement.js';

/** What a project window opens with: which project, whether it opens in Direct, and who works on it. */
export type ComposerData = { path: string; direct: boolean; animation: { model: string; effort: string } };

/** What's being edited: a clip, or an element in it. Each holds its own values and keyframes. */
export type Picked = { id: string; name?: string; props: Record<string, AnyType>; scenes: NodeKeyframe[] };

/** What Direct shows beside its list. */
export type DirectView = 'overview' | 'stage' | 'asset' | 'cast';

/** How a script shows: as Markdown draws it, or as its source, to edit. */
export type ViewMode = 'preview' | 'edit';

/** A generated image, video or sound, by path: what its generation is made again from. */
export type GenerativeSource = { path: string; source: GenerativeDocument };

/** One project window's facts, for every part of it and for its dock. */
export type Composer = {
  path: string;
  mode: 'direct' | 'compose';
  activeView: DirectView;
  /** The stage picked, by path, once one is. */
  activeStage?: string;
  /** The asset picked. */
  activeAsset?: FileRow;
  /** The cast picked, by path. */
  activeCast?: string;
  /** What the picked cast shows. */
  person?: PersonTab;
  viewMode: ViewMode;
  /** Whether the side panel shows: what the project holds in Direct, its sources in Compose. */
  sidebar: boolean;
  /** The timeline of the stage Compose last opened; only Compose and its dock read it. */
  timeline?: Timeline;
  /** What's been done to the stage open in Compose, to undo and redo. */
  stageHistory?: ReturnType<typeof history>;
  /** The clips picked on it, by id. */
  clips: string[];
  /** The track picked on it, by id: what its clips read where they don't say. Never picked with clips. */
  track: string;
  /** The element picked inside the picked clip, by id; empty, the clip itself. */
  node: string;
  /** Whether dragging on the timeline snaps clips and the playhead to what's near. */
  snap: boolean;
  /** Counts edits to keyframes, which aren't observed, for what reads them. */
  edits: number;
  /** What the stage's render says now. */
  status: string;
  /** Whether something's being generated, so a second press doesn't make it twice. */
  generating: boolean;
  rendering: boolean;
  /** Read by the stage listing, which runs again as it changes. */
  version: number;

  /** The project's `.motion`, once it has arrived. */
  readonly motion: MotionDocument | undefined;
  /** The project with where it is, once it has arrived. */
  readonly project: Project | undefined;
  /** The project's stages in playing order. Every list here is from one listing, which reads no file. */
  readonly stages: FileRow[];
  /** What the project's stages are made from. */
  readonly assets: FileRow[];
  /** Who's in the project. */
  readonly casts: FileRow[];
  /** Everyone who could be. */
  readonly people: FileRow[];
  /** The project's pictures: its images and stills, which what's generated can be made from. */
  readonly pictures: FileRow[];
  /** The agents work can be assigned to. */
  readonly agents: FileRow[];
  /** Where the stage picked is, or the project's first until one is. */
  readonly stagePath: string | undefined;
  /** The stage picked, or the project's first until one is. */
  readonly stage: StageDocument | undefined;
  /** Where a path written in the project leads. Stages live beside their `.motion`, so theirs too. */
  pathOf(written: string): string;
  /** The clip picked on the timeline, when it's the only one. */
  hostClip(): TimelineSegment | undefined;
  /** The track picked on the timeline. */
  pickedTrack(): TimelineTrack | undefined;
  /** What's being edited: the track picked, or the element picked inside the clip, else the clip. A clip's time is its own; a track has none. */
  picked(): Picked | undefined;
  /**
   * Shows an edit to a clip: on what reads its keyframes, and on the stage, which draws a frame only
   * as the timeline reaches it, so while paused it draws the frame again.
   */
  edited(): void;
  /** Takes back the last change to the stage, and shows it. */
  undo(): void;
  /** Puts back what was taken back, and shows it. */
  redo(): void;
  /** The clip picked, when it's the only one and shows a generated image, video or sound. */
  generativeClip(): (GenerativeSource & { segment: TimelineSegment }) | undefined;
  /** The asset picked, when it's generated. */
  generativeAsset(): GenerativeSource | undefined;
  /** Makes a new attempt of a generated document, which shows in its clip; `status` says how it went. */
  generate(generated: GenerativeSource): void;
  /** Starts rendering the stage open in Compose, or says in `status` why it can't. */
  render(): void;
  /**
   * Says a file is being written here, so hearing of it doesn't list the project again: a listing
   * that ran before the project saved would drop the file's row.
   *
   * @param file - The file's home path.
   */
  writing(file: string): void;
  /**
   * Puts a row this desktop is adding in the listing, which needs no asking again for it: the
   * project only holds a file once it's saved, so a listing can't have it yet.
   *
   * @param row - The new row.
   * @returns The row as it's listed, live.
   */
  add(row: FileRow): FileRow;
  /** Takes a row back out of the listing, for a file that couldn't be added. */
  drop(row: FileRow): void;
};

/** The composer of the window a part is in. */
export const composerCtx = createContext<Composer>();

/** Where turning HTML-in-Canvas on lives, for people whose Chrome doesn't have it yet. */
const CAPTURE_FLAG = 'chrome://flags/#canvas-draw-element';

/** Where a project window's listing looks, narrowed to what the project holds. */
const HOME = '~';

/** The files that change a project window's listing: media only lists once the project holds it. */
const LISTED_FILE = /\.(motion|stage|persona|agent|still|take)$/;

/**
 * A project window's one source of truth: the project, and what the window shows of it.
 *
 * @param path - The project's `.motion`.
 * @param direct - Whether it opens in Direct rather than Compose.
 * @returns The composer.
 */
export function createComposer(path: string, direct: boolean): Composer {
  // What this window is writing itself: it's about to hold it, so hearing of it lists nothing.
  const written = new Set<string>();

  // A track as what's picked, the same one each time, so reading it again is no change. A track has
  // no time of its own, so it has no keyframes; its values are read live.
  const tracksPicked = new WeakMap<TimelineTrack, Picked>();
  const pickedOf = (track: TimelineTrack) => {
    const held =
      tracksPicked.get(track) ??
      ({
        id: track.id,
        get name() {
          return track.name;
        },
        get props() {
          return track.props;
        },
        scenes: [],
      } as Picked);
    tracksPicked.set(track, held);
    return held;
  };

  const composer: Composer = mutable<Composer>(
    {
      path,
      mode: direct ? 'direct' : 'compose',
      activeView: 'overview',
      viewMode: 'preview',
      sidebar: true,
      clips: [],
      track: '',
      node: '',
      snap: false,
      edits: 0,
      status: '',
      generating: false,
      rendering: false,
      version: 0,

      get motion() {
        return documentAt<'motion'>(path);
      },

      get project() {
        const document = composer.motion;
        return document && { path, document };
      },

      get stages() {
        return ofKind((row) => row.kind === 'stage');
      },

      get assets() {
        return ofKind((row) => !!row.held && row.kind !== 'persona');
      },

      get pictures() {
        return ofKind((row) => !!row.held && (row.kind === 'image' || row.kind === 'still'));
      },

      get casts() {
        return ofKind((row) => !!row.held && row.kind === 'persona');
      },

      get people() {
        return ofKind((row) => row.kind === 'persona');
      },

      get agents() {
        return ofKind((row) => row.kind === 'agent');
      },

      get stagePath() {
        return composer.activeStage ?? composer.stages[0]?.path;
      },

      get stage() {
        return documentAt<'stage'>(composer.stagePath);
      },

      pathOf: (written) => resolvePath(path, written),

      render() {
        if (!canCaptureVideo()) {
          composer.status = `Rendering needs HTML-in-Canvas: open ${CAPTURE_FLAG} in Chrome, enable it, and relaunch.`;
          return;
        }
        composer.status = '';
        composer.timeline?.pause();
        composer.rendering = true;
      },

      hostClip() {
        const { timeline, clips } = composer;
        if (!timeline || clips.length !== 1) return;
        for (const track of timeline.tracks) {
          for (const segment of track.segments) if (segment.id === clips[0]) return segment;
        }
      },

      pickedTrack() {
        const { timeline, track } = composer;
        return track ? [...(timeline?.tracks ?? [])].find((each) => each.id === track) : undefined;
      },

      picked() {
        const track = composer.pickedTrack();
        if (track) return pickedOf(track);
        const host = composer.hostClip();
        const found = host && composer.node && findNode((host.props as HtmlClip).children, composer.node);
        return found ? found.node : host;
      },

      edited() {
        composer.edits += 1;
        const { timeline } = composer;
        if (timeline && timeline.status !== 'playing') void timeline.scrub(timeline.frame);
      },

      undo() {
        composer.stageHistory?.backward();
        composer.edited();
      },

      redo() {
        composer.stageHistory?.forward();
        composer.edited();
      },

      generativeClip() {
        const segment = composer.hostClip();
        const source = segment?.meta?.source;
        if (!segment || typeof source !== 'string') return;
        const found = follow(path, source);
        return isGenerative(found.document) ? { segment, path: found.path, source: found.document } : undefined;
      },

      generativeAsset() {
        const asset = composer.activeAsset;
        if (asset?.kind !== 'still' && asset?.kind !== 'take' && asset?.kind !== 'sound') return;
        const source = documentAt(asset.path);
        return isGenerative(source) ? { path: asset.path, source } : undefined;
      },

      generate(generated) {
        const { path, source } = generated;
        const making = composer.generating ? undefined : attemptsOf(generated);
        if (!making) {
          if (!composer.generating) composer.status = `Generating ${source.name} here isn't connected yet.`;
          return;
        }
        composer.generating = true;
        composer.status = `Making ${source.name}…`;
        making()
          .then((attempts) => {
            composer.status = '';
            // The clip stays where it is, as long as it is: what's new just shows in it.
            const clip = composer.generativeClip();
            const newest = attempts.at(-1);
            if (newest && clip?.path === path) showAttempt(clip.segment, path, source, newest.id);
            // Its row shows it too, here and in Sources, without listing the project again.
            const row = composer.assets.find((asset) => asset.path === path);
            if (row) row.thumbnail = attemptPicture(path, source, chosenAttempt(source));
          })
          .catch((error: Error) => {
            composer.status = error.message;
          })
          .finally(() => {
            composer.generating = false;
          });
      },

      writing(file) {
        written.add(file);
      },

      add(row) {
        const rows = rowsOf(listed);
        rows.push(row);
        return rows[rows.length - 1];
      },

      drop(row) {
        const rows = rowsOf(listed);
        rows.splice(rows.indexOf(row), 1);
      },
    },
    { recursive: false },
  );

  // Everything the window lists, in one call.
  const listed = dfs.list.with(() => {
    void composer.version;
    return [HOME, { recursive: true, scope: { holds: path } }];
  });
  const ofKind = (test: (row: FileRow) => boolean) => rowsOf(listed).filter(test).sort((a, b) => a.position - b.position);

  // What an agent writes isn't held here, so it's listed again.
  dfs.watch(HOME, ({ path: changed }) => {
    if (written.delete(changed)) return;
    if (LISTED_FILE.test(changed)) composer.version += 1;
  });

  // What another tab added, which it holds and this one can't list until the project is saved.
  LOUNGE.subscribe(({ type, data }) => {
    if (type === LOUNGE_EVENT.CREATED && data.held && parentOf(data.path) === parentOf(path)) rowsOf(listed).push(data);
  });

  // However clips get picked, the track lets go: placing one picks it without the timeline's say.
  effect(() => {
    if (composer.clips.length) composer.track = '';
  });

  // A stage edited in Compose changes only its row, which shows in Direct: it's listed again on the
  // way back, so an edit costs nothing more.
  let composing = false;
  effect(() => {
    const back = composing && composer.mode === 'direct';
    composing = composer.mode === 'compose';
    if (back) composer.version += 1;
  });

  return composer;
}

/**
 * What makes a generated document's next attempt.
 *
 * @param generated - The document, and where it is.
 * @returns What makes it; none where nothing can yet.
 */
function attemptsOf({ path, source }: GenerativeSource): (() => Promise<{ id: string }[]>) | undefined {
  if (source.type === 'still') return () => dfs.still.generate(path);
  if (source.type === 'take' && settingsOf(source).mode === 'image') return () => generateTakePicture(path);
  if (source.type === 'sound' && source.kind === 'speech') return () => generateSpeech(path);
}
