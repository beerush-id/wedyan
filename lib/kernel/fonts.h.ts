import { kernel } from './package.js';

/**
 * The family names of Google Fonts that hold what's asked, the most popular first, as many as a
 * picker shows. The server holds the whole list, and the key that gets it.
 */
export const fontFamilies = kernel.declare<(query: string) => Promise<string[]>>({
  name: 'fonts',
});
