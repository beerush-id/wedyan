/** Where Google serves a family's styles, by name: asked for every style, it gives those the family has. */
const FONT_SHEETS = 'https://fonts.googleapis.com/css';
const STYLES = [100, 200, 300, 400, 500, 600, 700, 800, 900].flatMap((weight) => [weight, `${weight}i`]).join(',');

/** A title's font as CSS sets it, among whatever other values it has. */
export type FontStyle = { fontFamily?: unknown; fontWeight?: unknown; fontStyle?: unknown; [property: string]: unknown };

/** The fonts this page has loaded, each once, by what it was asked for. */
const LOADED = new Map<string, Promise<unknown>>();

/**
 * Loads the font some words are set in, for a clip's `draw`, which the stage waits for: the browser
 * fetches a font only as it paints it, which is too late for a frame being captured. A font that
 * can't load leaves its words in the stage's own font.
 *
 * @param style - The words' font.
 * @param text - The words: a family comes in parts by alphabet, and only theirs is fetched.
 * @returns When it's loaded; nothing for words in the stage's own font.
 */
export function loadFont({ fontFamily, fontWeight = 400, fontStyle = 'normal' }: FontStyle = {}, text = ''): Promise<unknown> | undefined {
  if (!fontFamily) return;
  const font = `${fontStyle} ${fontWeight} 16px "${fontFamily}"`;
  const key = `${font}:${text}`;
  let loading = LOADED.get(key);
  if (!loading) {
    loading = loadSheet(String(fontFamily))
      .then(() => document.fonts.load(font, text))
      .catch(() => undefined);
    LOADED.set(key, loading);
  }
  return loading;
}

/** Puts a family's style sheet in the page, once. */
function loadSheet(family: string): Promise<unknown> {
  let loading = LOADED.get(family);
  if (!loading) {
    loading = new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${FONT_SHEETS}?family=${encodeURIComponent(family)}:${STYLES}&display=swap`;
      link.crossOrigin = 'anonymous';
      link.onload = link.onerror = resolve;
      document.head.append(link);
    });
    LOADED.set(family, loading);
  }
  return loading;
}
