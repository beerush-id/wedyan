import { setup } from '@airlib/react';
import { generationCtx } from '@/components/generation.js';
import { GenerationForm } from '@/components/GenerationForm.js';
import { type Composer, composerCtx } from '../context.js';
import { showAttempt } from '../placement.js';

/**
 * The picked generated clip as it was asked for, to change and make again, in the shared generation
 * form: generating makes its document again, and choosing an attempt makes the clip show it.
 */
export const Prompt = setup(() => {
  const composer = composerCtx.get() as Composer;

  generationCtx.set({
    get path() {
      return composer.generativeClip()?.path;
    },
    get source() {
      return composer.generativeClip()?.source;
    },
    get busy() {
      return composer.generating;
    },
    get pictures() {
      return composer.pictures;
    },
    generate() {
      const clip = composer.generativeClip();
      if (clip) composer.generate(clip);
    },
    choose(id) {
      const clip = composer.generativeClip();
      if (clip) showAttempt(clip.segment, clip.path, clip.source, id);
    },
  });

  return () => <GenerationForm />;
}, 'Prompt');
