import { kernel } from './package.js';

/**
 * The most popular family names of Google Fonts that hold what's asked, as many as a picker shows,
 * in alphabetical order. The server holds the whole list, and the key that gets it.
 */
export const fontFamilies = kernel.declare<(query: string) => Promise<string[]>>({
  name: 'fonts',
});
