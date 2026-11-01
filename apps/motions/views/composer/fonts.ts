import type { Timeline } from '@airlib/react/timeline';
import type { FontFamily } from '@/lib/kernel/fonts.h.js';
import type { StageProps, TitleClip } from './composition.js';

/** Where Google serves a family's styles. */
const FONT_SHEETS = 'https://fonts.googleapis.com/css2';

/** A style's weight in its Google name: `700italic`; `regular` and `italic` have none. */
const STYLE_WEIGHT = /^\d+/;
const REGULAR_WEIGHT = '400';

/** The style sheets this page has asked for, each once, by address. */
const SHEETS = new Map<string, Promise<void>>();

/**
 * Adds a family's style sheet to a stage, so the stage carries what its words need wherever it opens.
 *
 * @param timeline - The stage's timeline.
 * @param font - The family.
 */
export function addFont(timeline: Timeline, font: FontFamily): void {
  const stage = timeline.props as StageProps;
  const sheet = sheetOf(font);
  stage.fonts ??= [];
  if (!stage.fonts.includes(sheet)) stage.fonts.push(sheet);
}

/**
 * Loads a font style sheet into the page, once. A sheet that can't load settles all the same: its
 * words show in their fallback rather than holding up what's drawing them.
 *
 * @param href - The sheet's address.
 * @returns When it's in.
 */
export function loadSheet(href: string): Promise<void> {
  let loading = SHEETS.get(href);
  if (!loading) {
    loading = new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.crossOrigin = 'anonymous';
      link.onload = link.onerror = () => resolve();
      document.head.append(link);
    });
    SHEETS.set(href, loading);
  }
  return loading;
}

/**
 * Loads every font a stage's words are set in, for what must have them before it draws: the browser
 * only fetches a font once it's painting it, which is too late for a frame being captured.
 *
 * @param timeline - The stage's timeline.
 * @returns When they're in.
 */
export async function loadFonts(timeline: Timeline): Promise<void> {
  await Promise.all(((timeline.props as StageProps).fonts ?? []).map(loadSheet));
  const titles = [...timeline.tracks].flatMap((track) => [...track.segments]).filter((segment) => segment.type === 'title');
  await Promise.all(
    titles.map(({ props }) => {
      const { style, text } = props as TitleClip;
      return style?.font ? document.fonts.load(String(style.font), text) : undefined;
    }),
  );
}

/** A family's style sheet, with every style it comes in; the browser fetches only those painted. */
function sheetOf({ family, variants }: FontFamily): string {
  const styles = variants
    .map((variant) => ({ italic: variant.endsWith('italic') ? 1 : 0, weight: STYLE_WEIGHT.exec(variant)?.[0] ?? REGULAR_WEIGHT }))
    .sort((a, b) => a.italic - b.italic || Number(a.weight) - Number(b.weight))
    .map(({ italic, weight }) => `${italic},${weight}`);
  return `${FONT_SHEETS}?family=${encodeURIComponent(family).replaceAll('%20', '+')}:ital,wght@${styles.join(';')}&display=swap`;
}
