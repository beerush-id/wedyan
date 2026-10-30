import { Show, setup } from '@airlib/react';
import { EmptyState } from '@airlib/react-aui';
import { generationCtx } from '@/components/generation.js';
import { GenerationForm } from '@/components/GenerationForm.js';
import { GenerativeIcon } from './icons.js';
import { showAttempt } from './placement.js';
import { generate, generativeClip, type MotionsSession, sessionCtx } from './session.js';

/**
 * The picked generated clip as it was asked for, to change and make again, in the shared
 * generation form: generating makes its document again, and choosing an attempt makes the clip
 * show it. It finds the clip in the window's session itself. Shows how to get there while no
 * single generated clip is picked.
 */
export const GenerationFields = setup(() => {
  const session = sessionCtx.get() as MotionsSession;

  generationCtx.set({
    get path() {
      return generativeClip(session)?.path;
    },
    get source() {
      return generativeClip(session)?.source;
    },
    generate() {
      const clip = generativeClip(session);
      if (clip) generate(session, clip);
    },
    choose(id) {
      const clip = generativeClip(session);
      if (clip) showAttempt(clip.segment, clip.source, id);
    },
  });

  return () => (
    <Show
      when={() => generativeClip(session)}
      fallback={() => (
        <EmptyState size="sm" title="No generated clip picked" description="Pick one generated image, video or sound to see how it was made.">
          <EmptyState.Snippet for="icon">{() => <GenerativeIcon />}</EmptyState.Snippet>
        </EmptyState>
      )}
    >
      {() => <GenerationForm />}
    </Show>
  );
}, 'GenerationFields');
