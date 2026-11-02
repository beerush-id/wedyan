import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, Show, Snippet } from '@airlib/react';
import { Button, Divider, EmptyState, Gallery, type GalleryEntry, ImageViewer, type ImageViewerEntry, Spinner } from '@airlib/react-aui';
import { defineWindow, Window, WindowTitle, type WindowRenderProps } from '@airlib/react-aui/desktop';
import { FloatingDownload } from '@/components/FloatingDownload.js';
import { generationCtx } from '@/components/generation.js';
import { GenerationForm } from '@/components/GenerationForm.js';
import { GenerativeIcon } from '@/components/icons.js';
import { chosenAttempt } from '@/lib/documents/generation.js';
import { nameOf } from '@/lib/documents/paths.js';
import type { StillDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { documentAt } from '@/lib/share/documents.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { addressOf, VIEWER_LABELS } from './listing.js';
import { makeAttempts, making, stillChanged } from './making.js';
import { StillOptions } from './options.js';
import { pictures } from './prompt.js';

/** What a still project's window shows: the still, by path. */
export type StillData = { still: string };

const CLASS = {
  STILL: 'wedyan-still',
  PREVIEW: 'wedyan-still-preview',
  ATTEMPTS: 'wedyan-still-attempts',
  PROMPT: 'wedyan-still-prompt',
};

/** How large an attempt is asked for in the row of attempts, its longest edge. */
const ATTEMPT_SIZE = 128;

/** How large a still is asked for as its window's thumbnail, its longest edge. */
const THUMBNAIL_SIZE = 256;

/**
 * A still project's window: one definition, a window for each still. The attempt it shows, large,
 * with every attempt in a row over it to choose from, and beside them how it's asked for — its
 * prompt, settings, references, who's in it and its history — to change and make again.
 */
export const stillProject = defineWindow({
  name: `${manifest.name}-still`,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 520, minHeight: 360 },
  multiple: true,
  dockExtensions: StillOptions,
}).render(StillWindow);

/**
 * Opens a still project in a window of its own, or brings forward the one already showing it.
 *
 * @param path - The still's path.
 * @returns The window showing it.
 */
export function openStill(path: string) {
  const showing = stillProject.instances.find((instance) => (instance.data as StillData).still === path);
  if (showing) {
    showing.focus();
    return showing;
  }

  return stillProject.open({ still: path } satisfies StillData, {
    name: 'still',
    get contexts() {
      return pictures();
    },
    get title() {
      return documentAt<'still'>(path)?.name ?? nameOf(path);
    },
    get thumbnail() {
      const document = documentAt<'still'>(path);
      const attempt = document && chosenAttempt(document);
      return attempt && addressOf(path, attempt.src, THUMBNAIL_SIZE);
    },
  });
}

/**
 * A still project's window: holds the still for as long as it's open, so every change to it is saved.
 *
 * @param props - The window's props.
 * @returns The window's view.
 */
function StillWindow(props: WindowRenderProps) {
  // A window shows one still for its whole life.
  const { still: path } = props.instance.data as StillData;
  const binding = dfs.binding<StillDocument>(path);
  const still = () => binding.data;
  const made = () => making[path];

  /**
   * Chooses the attempt the still shows.
   *
   * @param id - The attempt's id.
   */
  const choose = (id: string) => {
    const document = still();
    if (!document || document.chosen === id) return;
    document.chosen = id;
    stillChanged(path, document);
  };

  generationCtx.set({
    path,
    get source() {
      return still();
    },
    get busy() {
      return made()?.busy;
    },
    generate() {
      void makeAttempts(path);
    },
    choose,
  });

  // The viewer steps through the attempts, and stepping chooses the one it lands on.
  const viewer = {
    get index() {
      const document = still();
      const chosen = document && chosenAttempt(document);
      return document && chosen ? document.attempts.indexOf(chosen) : 0;
    },
    set index(at: number) {
      const attempt = still()?.attempts[at];
      if (attempt) choose(attempt.id);
    },
  };

  // The row of attempts always has the chosen one picked; pressing it again keeps it chosen.
  const picked = {
    get value() {
      const document = still();
      return (document && chosenAttempt(document)?.id) ?? null;
    },
    set value(id: string | null) {
      if (id) choose(id);
    },
  };

  const slides = (): ImageViewerEntry[] =>
    (still()?.attempts ?? []).map((attempt, at) => ({ src: addressOf(path, attempt.src), alt: `Attempt ${at + 1}` }));

  // Each attempt as its picture alone; what it was asked shows as the viewer's caption.
  const tiles = (): GalleryEntry[] =>
    (still()?.attempts ?? []).map((attempt, at) => ({ value: attempt.id, src: addressOf(path, attempt.src, ATTEMPT_SIZE), alt: `Attempt ${at + 1}` }));

  // What the preview says when there's no attempt to show: why, and what's on its way.
  const emptyTitle = () => {
    if (!binding.ready) return 'Loading';
    if (!still()) return 'This still is gone';
    if (made()?.busy) return 'Making it';
    return made()?.error ? "Couldn't make it" : 'Nothing made yet';
  };
  const emptyLine = () => {
    if (!binding.ready || !still()) return undefined;
    if (made()?.busy) return 'It shows here as soon as it comes back.';
    return made()?.error ?? 'Write what to make beside, then Generate.';
  };

  return () => (
    <Window>
      <Window.Snippet for="title">
        {() => (
          <WindowTitle>
            <Snippet>{() => still()?.name ?? ''}</Snippet>
          </WindowTitle>
        )}
      </Window.Snippet>
      <Window.Snippet for="actions">
        {() => (
          <Show when={() => made()?.busy}>
            {() => (
              <>
                <Spinner label="Making it" />
                {/* Sets the app's own buttons apart from the window's. */}
                <Divider orientation="vertical" variant="ghost" size="sm" />
              </>
            )}
          </Show>
        )}
      </Window.Snippet>
      <div className={CLASS.STILL}>
        <section className={CLASS.PREVIEW} aria-label="Preview">
          <Show
            when={() => !made()?.error && still()?.attempts.length}
            fallback={() => (
              <EmptyState title={$use(emptyTitle)} description={$use(emptyLine)} level={3}>
                <EmptyState.Snippet for="icon">{() => (made()?.busy ? <Spinner label="Making it" /> : <GenerativeIcon />)}</EmptyState.Snippet>
                <EmptyState.Snippet for="action">
                  {() =>
                    made()?.error ? (
                      <>
                        <Button size="sm" variant="filled" onClick={() => void makeAttempts(path)}>
                          Try again
                        </Button>
                        <Button
                          size="sm"
                          variant="text"
                          onClick={() => {
                            delete making[path];
                          }}
                        >
                          Dismiss
                        </Button>
                      </>
                    ) : (
                      ''
                    )
                  }
                </EmptyState.Snippet>
              </EmptyState>
            )}
          >
            {() => (
              <>
                <ImageViewer label="Attempts" items={$use(slides)} index={$bind(viewer, 'index')} labels={VIEWER_LABELS} />
                {/* Every attempt, small, floating over the picture, to choose from without leaving it. */}
                <div className={`${CLASS.ATTEMPTS} ${AUI_CLASS.GLASS_FRAME}`}>
                  <Gallery label="Attempts" items={$use(tiles)} value={$bind(picked, 'value')} flow={false} />
                </div>
                {/* Downloading the attempt the viewer shows. */}
                <Snippet>
                  {() => {
                    const shown = slides()[viewer.index];
                    return shown ? <FloatingDownload src={shown.src} name={still()?.name ?? 'Still'} /> : null;
                  }}
                </Snippet>
              </>
            )}
          </Show>
        </section>
        <aside className={`${CLASS.PROMPT} ${AUI_CLASS.GLASS_PANEL}`} aria-label="Prompt">
          <GenerationForm />
        </aside>
      </div>
    </Window>
  );
}
