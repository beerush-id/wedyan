import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $static, $use, Show, Snippet, setup } from '@airlib/react';
import { EmptyState, Gallery, type GalleryEntry, ImageViewer, type ImageViewerEntry } from '@airlib/react-aui';
import { Window, WindowTitle } from '@airlib/react-aui/desktop';
import { generationCtx } from '@/components/generation.js';
import { GenerationForm } from '@/components/GenerationForm.js';
import { GenerativeIcon } from '@/components/icons.js';
import { chosenAttempt } from '@/lib/documents/generation.js';
import { documentAt } from '@/lib/documents/store.js';
import { VIEWER_LABELS } from './library.js';

const CLASS = {
  STILL: 'wedyan-still',
  PREVIEW: 'wedyan-still-preview',
  ATTEMPTS: 'wedyan-still-attempts',
  PROMPT: 'wedyan-still-prompt',
};

/**
 * A still project in its own window: the attempt it shows, large, with every attempt in a row
 * beneath to choose from, and beside them how it is asked for — its prompt, settings, references,
 * who's in it and its history — to change and make again.
 */
export const StillProject = setup<{ path: string }>((props) => {
  // A window shows one still for its whole life.
  const path = $static(() => props.path);
  const still = () => documentAt<'still'>(path);

  /**
   * Chooses the attempt the still shows.
   *
   * @param id - The attempt's id.
   */
  const choose = (id: string) => {
    const document = still();
    if (document) document.chosen = id;
  };

  generationCtx.set({
    path,
    get source() {
      return still();
    },
    generate() {
      // Nothing in Photos generates yet; the prompt and settings are kept for when it does.
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
    (still()?.attempts ?? []).map((attempt, at) => ({ src: attempt.src, alt: `Attempt ${at + 1}` }));

  // Each attempt as its picture alone; what it was asked shows as the viewer's caption.
  const tiles = (): GalleryEntry[] =>
    (still()?.attempts ?? []).map((attempt, at) => ({ value: attempt.id, src: attempt.src, alt: `Attempt ${at + 1}` }));

  return () => (
    <Window>
      <Window.Snippet for="title">
        {() => (
          <WindowTitle>
            <Snippet>{() => still()?.name ?? ''}</Snippet>
          </WindowTitle>
        )}
      </Window.Snippet>
      <div className={CLASS.STILL}>
        <section className={CLASS.PREVIEW} aria-label="Preview">
          <Show
            when={() => still()?.attempts.length}
            fallback={() => (
              <EmptyState title="Nothing made yet" description="Write what to make beside, then Generate." level={3}>
                <EmptyState.Snippet for="icon">{() => <GenerativeIcon />}</EmptyState.Snippet>
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
}, 'StillProject');
