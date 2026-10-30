/**
 * A desktop link that opens a file in the app that owns it, for an agent's widget or words: the
 * desktop brings forward a window already showing it rather than opening another.
 *
 * @param path - The file, by its path in the home.
 * @returns `wedyan://open?path=…`.
 */
export function openLink(path: string): string {
  return `wedyan://open?path=${encodeURIComponent(path)}`;
}
