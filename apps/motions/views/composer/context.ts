import { createContext, mutable } from '@airlib/react';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import type { WindowInstance } from '@airlib/react-aui/desktop';
import type { PersonTab } from '@/apps/lounge/views/session.js';
import { FILE_TYPES } from '@/lib/documents/file-types.js';
import { isGenerative } from '@/lib/documents/generation.js';
import { resolvePath } from '@/lib/documents/paths.js';
import type { StageRow } from '@/lib/documents/stage.js';
import type { GenerativeDocument, MotionAsset, MotionDocument, StageDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { documentAt, follow, type Project, ROOT } from '../motion.js';

/** What a project window opens with: which project, and whether it opens in Direct. */
export type ComposerData = { path: string; direct: boolean };

/** What Direct shows beside its list. */
export type DirectView = 'overview' | 'stage' | 'asset' | 'cast';

/** How a script shows: as Markdown draws it, or as its source, to edit. */
export type ViewMode = 'preview' | 'edit';

/** A generated image, video or sound, by path: what its generation is made again from. */
export type GenerativeSource = { path: string; source: GenerativeDocument };

/** One project window's facts, for every part of it and for its dock. */
export type Composer = {
  window: WindowInstance;
  path: string;
  mode: 'direct' | 'compose';
  activeView: DirectView;
  /** The stage picked, by path, once one is. */
  activeStage?: string;
  /** The asset picked. */
  activeAsset?: MotionAsset;
  /** The cast picked, by path. */
  activeCast?: string;
  /** What the picked cast shows. */
  person?: PersonTab;
  viewMode: ViewMode;
  /** Whether the side panel shows: what the project holds in Direct, its sources in Compose. */
  sidebar: boolean;
  /** The timeline of the stage Compose last opened; only Compose and its dock read it. */
  timeline?: Timeline;
  /** The clips picked on it, by id. */
  clips: string[];
  /** Whether dragging on the timeline snaps clips and the playhead to what's near. */
  snap: boolean;
  /** Counts edits to keyframes, which aren't observed, for what reads them. */
  edits: number;
  /** What the stage's render says now. */
  status: string;
  rendering: boolean;
  /** Read by the stage listing, which runs again as it changes. */
  version: number;

  /** The project's `.motion`, once it has arrived. */
  readonly motion: MotionDocument | undefined;
  /** The project with where it is, once it has arrived. */
  readonly project: Project | undefined;
  /** The project's stages in playing order, from one listing: none of their files are read for this. */
  readonly stages: StageRow[];
  /** Where the stage picked is, or the project's first until one is. */
  readonly stagePath: string | undefined;
  /** The stage picked, or the project's first until one is. */
  readonly stage: StageDocument | undefined;
  /** Where a path written in the project leads. Stages live beside their `.motion`, so theirs too. */
  pathOf(written: string): string;
  /** The clip picked, when it's the only one. */
  pickedClip(): TimelineSegment | undefined;
  /** The clip picked, when it's the only one and shows a generated image, video or sound. */
  generativeClip(): (GenerativeSource & { segment: TimelineSegment }) | undefined;
  /** The asset picked, when it's generated. */
  generativeAsset(): GenerativeSource | undefined;
  /** Makes a generated document again; nothing in Motions generates yet, so it says so. */
  generate(generated: GenerativeSource): void;
};

/** The composer of the window a part is in. */
export const composerCtx = createContext<Composer>();

/**
 * A project window's one source of truth: the project, and what the window shows of it.
 *
 * @param window - The window.
 * @param path - The project's `.motion`.
 * @param direct - Whether it opens in Direct rather than Compose.
 * @returns The composer.
 */
export function createComposer(window: WindowInstance, path: string, direct: boolean): Composer {
  const composer: Composer = mutable<Composer>(
    {
      window,
      path,
      mode: direct ? 'direct' : 'compose',
      activeView: 'overview',
      viewMode: 'preview',
      sidebar: true,
      clips: [],
      snap: false,
      edits: 0,
      status: '',
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
        return [...((listed.data?.entries ?? []) as unknown as StageRow[])].sort((a, b) => a.order - b.order);
      },

      get stagePath() {
        return composer.activeStage ?? composer.stages[0]?.path;
      },

      get stage() {
        return documentAt<'stage'>(composer.stagePath);
      },

      pathOf: (written) => resolvePath(path, written),

      pickedClip() {
        const { timeline, clips } = composer;
        if (!timeline || clips.length !== 1) return;
        for (const track of timeline.tracks) {
          for (const segment of track.segments) if (segment.id === clips[0]) return segment;
        }
      },

      generativeClip() {
        const segment = composer.pickedClip();
        const source = segment?.meta?.source;
        if (!segment || typeof source !== 'string') return;
        const found = follow(path, source);
        return isGenerative(found.document) ? { segment, path: found.path, source: found.document } : undefined;
      },

      generativeAsset() {
        const asset = composer.activeAsset;
        if (asset?.kind !== 'still' && asset?.kind !== 'take') return;
        const found = follow(path, asset.src);
        return isGenerative(found.document) ? { path: found.path, source: found.document } : undefined;
      },

      generate({ source }) {
        composer.status = `Generating ${source.name} isn't connected yet.`;
      },
    },
    { recursive: false },
  );

  // Every stage naming this project, in one call.
  const listed = dfs.list.with(() => {
    void composer.version;
    return [ROOT, { recursive: true, filter: { type: FILE_TYPES.stage, metadata: { projectId: composer.motion?.id ?? '' } } }];
  });
  dfs.watch(ROOT, (change) => {
    if (change.path.endsWith('.stage')) composer.version += 1;
  });

  return composer;
}
