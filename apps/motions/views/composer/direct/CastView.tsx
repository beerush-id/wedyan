import { setup } from '@airlib/react';
import { PersonaEditor } from '@/apps/lounge/views/Persona.js';
import { loungeCtx } from '@/apps/lounge/views/session.js';
import { type Composer, composerCtx } from '../context.js';

/**
 * The picked cast, edited as Lounge edits a person: their profile, face, figure or outfits, by the
 * tab the toolbar picks. Deleting them stays in Lounge, which still keeps people on its own drive,
 * by the same path without `~`.
 */
export const CastView = setup(() => {
  const composer = composerCtx.get() as Composer;

  loungeCtx.set({
    get path() {
      return composer.activeCast ?? '';
    },
    get tab() {
      return composer.person ?? 'profile';
    },
  });

  return () => {
    if (composer.activeView !== 'cast') return null;
    return <PersonaEditor />;
  };
}, 'CastView');
