import type { AIAdapter } from '@irpclib/ai-kit/worker';
import type { ImageWorkerEnv } from '@irpclib/r2-image/worker';
import { setupFiles } from './files.js';
import { setupMotion } from './motion.js';
import { setupStages } from './stage.js';

/**
 * Sets up the system's functions for its documents, on the server's models.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer, for R2 Image to size references.
 */
export function setupSystem(adapter: AIAdapter, pictures: ImageWorkerEnv): void {
  setupMotion(setupFiles(adapter, pictures));
  setupStages();
}
