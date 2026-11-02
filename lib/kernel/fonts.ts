import { fontFamilies } from './fonts.h.js';
import { kernel } from './package.js';

/** Where Google lists its fonts. */
const FONTS_API = 'https://www.googleapis.com/webfonts/v1/webfonts';

/** How many families one search answers with: the list is long, and typing narrows it. */
const FONT_CHOICES = 40;

let apiKey: string | undefined;

/**
 * The list, once it's come: it's public and the same for everyone, so this process keeps it. The
 * names and not the promise: a promise belongs to the Durable Object that made it.
 */
let listed: string[] | undefined;

/**
 * Gives the server the key Google Fonts is listed with.
 *
 * @param key - The Google API key, if there is one.
 */
export function setupFonts(key?: string): void {
  apiKey = key;
}

kernel.construct(fontFamilies, async (query) => {
  // A failure isn't the list: the next ask tries again.
  listed ??= await listFonts();
  const wanted = query.toLowerCase();
  return listed
    .filter((family) => family.toLowerCase().includes(wanted))
    .slice(0, FONT_CHOICES)
    .sort((a, b) => a.localeCompare(b));
});

/** Asks Google for every family's name. */
async function listFonts(): Promise<string[]> {
  if (!apiKey) throw new Error('Google Fonts needs GOOGLE_API_KEY');
  const response = await fetch(`${FONTS_API}?sort=popularity&key=${apiKey}`);
  if (!response.ok) throw new Error(`Google Fonts answered ${response.status}`);
  const { items } = (await response.json()) as { items: { family: string }[] };
  return items.map(({ family }) => family);
}
