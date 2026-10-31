import { createContext, effect, mutable } from '@airlib/react';
import type { Timeline, TimelineSegment } from '@airlib/react/timeline';
import type { PersonTab } from '@/apps/lounge/views/session.js';
import { isGenerative } from '@/lib/documents/generation.js';
import { resolvePath } from '@/lib/documents/paths.js';
import { type FileRow, rowsOf } from '@/lib/documents/rows.js';
import type { GenerativeDocument, MotionDocument, StageDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { documentAt, follow, type Project } from '../motion.js';

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
  /** The project's stages in playing order. Every list here is from one listing, which reads no file. */
  readonly stages: FileRow[];
  /** What the project's stages are made from. */
  readonly assets: FileRow[];
  /** Who's in the project. */
  readonly casts: FileRow[];
  /** Everyone who could be. */
  readonly people: FileRow[];
  /** The agents work can be assigned to. */
  readonly agents: FileRow[];
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

/** Where a project window's listing looks, narrowed to what the project holds. */
const HOME = '~';

/** The files a project window's listing shows. */
const LISTED_FILE = /\.(motion|stage|persona|agent|still|take|png|jpe?g|webp|gif|mp4|webm|mp3|wav)$/;

/**
 * A project window's one source of truth: the project, and what the window shows of it.
 *
 * @param path - The project's `.motion`.
 * @param direct - Whether it opens in Direct rather than Compose.
 * @returns The composer.
 */
export function createComposer(path: string, direct: boolean): Composer {
  const composer: Composer = mutable<Composer>(
    {
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
        return ofKind((row) => row.kind === 'stage');
      },

      get assets() {
        return ofKind((row) => !!row.held && row.kind !== 'persona');
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
        const source = documentAt(asset.path);
        return isGenerative(source) ? { path: asset.path, source } : undefined;
      },

      generate({ source }) {
        composer.status = `Generating ${source.name} isn't connected yet.`;
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
    if (LISTED_FILE.test(changed)) composer.version += 1;
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
