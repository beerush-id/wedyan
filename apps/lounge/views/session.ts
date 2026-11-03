import { createContext } from '@airlib/react';
import type { FileRow } from '@/lib/documents/rows.js';

/** What an open person shows: who they are, their face, their figure, or their outfits. */
export type PersonTab = 'profile' | 'head' | 'body' | 'wardrobe';

/** Each of a person's tabs, by name, in the toolbar's order. */
export const PERSON_TABS: Record<PersonTab, string> = { profile: 'Profile', head: 'Head', body: 'Body', wardrobe: 'Wardrobe' };

/** The persona or agent open beside the list: what Lounge's window shares with its editors. */
export type LoungeSession = {
  /** The open persona's or agent's path in the home; none while nothing is open. */
  readonly path: string | null;
  /** What an open person shows, picked in the toolbar. */
  readonly tab: PersonTab;
  /** Its row in the list beside it, written as it's renamed. None where it isn't listed, as a cast in Motions. */
  readonly row?: FileRow;
  /** Asks, then takes the open one off the drive. None where it isn't deleted from, as a cast in Motions. */
  remove?(): void;
  /**
   * Tells the window which picture the open person's tab has picked, for what it shows to agents.
   * None where nothing outside the editor reads it, as a cast in Motions.
   *
   * @param picked - Reads the picked picture, as the persona writes it.
   * @returns Lets go of it, once the editor closes.
   */
  showPicture?(picked: () => string | null): () => void;
};

/** The persona or agent open in Lounge's window, which its editor works on. */
export const loungeCtx = createContext<LoungeSession>();

/** The picture a window's open person has picked, read through whichever editor is open now. */
export type PictureShown = ReturnType<typeof pictureShown>;

/**
 * Holds the reader of the picture the open person's tab has picked, for a window to tell what it
 * shows. A newly opened person's editor may take over before the last one lets go, so letting go
 * only drops a reader that's still its own.
 *
 * @returns What reads the picked picture, and what an editor hands its reader to.
 */
export function pictureShown() {
  let reader: (() => string | null) | undefined;
  return {
    /** The picked picture, as the persona writes it; none while no person's editor is open. */
    read: (): string | null => reader?.() ?? null,
    show(picked: () => string | null) {
      reader = picked;
      return () => {
        if (reader === picked) reader = undefined;
      };
    },
  };
}
