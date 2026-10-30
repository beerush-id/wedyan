import { createContext } from '@airlib/react';

/** What an open person shows: who they are, their face, their figure, or their outfits. */
export type PersonTab = 'profile' | 'head' | 'body' | 'wardrobe';

/** Each of a person's tabs, by name, in the toolbar's order. */
export const PERSON_TABS: Record<PersonTab, string> = { profile: 'Profile', head: 'Head', body: 'Body', wardrobe: 'Wardrobe' };

/** The persona or agent open beside the list: what Lounge's window shares with its editors. */
export type LoungeSession = {
  /** The open persona's or agent's path; none while nothing, or several, are picked. */
  readonly path: string | null;
  /** What an open person shows, picked in the toolbar. */
  readonly tab: PersonTab;
  /** Takes the open one off the drive; the group's first opens in its place. None where it isn't deleted from, as a cast in Motions. */
  remove?(): void;
};

/** The persona or agent open in Lounge's window, which its editor works on. */
export const loungeCtx = createContext<LoungeSession>();
