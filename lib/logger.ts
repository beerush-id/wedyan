import { createLogger } from '@beerush/logger';

/**
 * Wedyan's logger. Modules log through their own tagged logger (`logger.create({ tags: ['kernel'] })`),
 * which shares this one's adapters; the server entry decides which adapters run, and at what level.
 */
export const logger = createLogger({ tags: ['wedyan'] });
