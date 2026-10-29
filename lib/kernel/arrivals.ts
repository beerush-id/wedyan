/** Where the demo's arrivals are bundled from, beside the app. */
const SOURCE = '../../arrivals/';

/** The demo's arrivals as bundled, by their path from here. */
const BUNDLED = import.meta.glob('../../arrivals/**/*', { query: '?raw', import: 'default', eager: true });

/**
 * The demo's arrivals, by their path in the home without `~/` (`Mail/m1.eml`): mail, an invite and
 * a receipt that land in the user's inboxes while they are away, so their first briefing has
 * something to tell.
 */
export const ARRIVAL_SEEDS: Record<string, string> = Object.fromEntries(
  Object.entries(BUNDLED as Record<string, string>).map(([file, text]) => [file.slice(SOURCE.length), text]),
);

/**
 * A demo arrival dated to the moment it lands, so it reads as new whenever it is delivered: a
 * mail's `Date`, an invite's day (its times of day kept), a receipt's delivery. Anything else is
 * delivered as it is.
 *
 * @param path - Its path in the home, for its kind.
 * @param text - Its content as bundled.
 * @param now - When it lands.
 * @returns Its content, dated.
 */
export function landed(path: string, text: string, now: Date): string {
  if (path.endsWith('.eml')) return text.replace(/^Date: .*$/m, `Date: ${now.toUTCString()}`);
  if (path.endsWith('.ics')) {
    const day = now.toISOString().slice(0, 10).replaceAll('-', '');
    return text.replace(/^(DTSTART|DTEND|DTSTAMP)((?:;[^:\n]*)?):\d{8}/gm, `$1$2:${day}`);
  }
  if (path.endsWith('.receipt')) return JSON.stringify({ ...JSON.parse(text), delivered: now.toISOString() }, null, 2);
  return text;
}
