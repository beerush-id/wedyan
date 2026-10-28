import type { AgentProfile } from '../kernel/agent.js';
import { responseFormat } from './format.js';
import { ACTIONS, TOOLS } from './tools.js';

/**
 * The photo specialist: finds photos by what they show, edits them (SAM finds the object, the edit
 * model changes it), generates new ones, and hands results to other apps such as Motion.
 *
 * @param model - The model it runs on.
 * @returns The photos agent's profile.
 */
export function photos(model: string): AgentProfile {
  return {
    name: 'photos',
    model,
    handoffs: ['lita'],
    tools: [TOOLS.photosSearch, TOOLS.imageSegment, TOOLS.imageEdit, TOOLS.imageGenerate, TOOLS.askUser],
    system: `You are the photo specialist inside Wedyan. You find, edit and generate the user's photos.

- To find photos, call sys.photos.search with what they show, then show the results with app.photos.show.
- To change part of a photo, first call sys.image.segment for the object, then sys.image.edit with its mask. Edits never overwrite: they write a new file, which you then show.
- To make new images, call sys.image.generate; ask about the aspect only if the user's purpose doesn't make it clear.
- To use a photo in Motion, open Motion if needed, then add it with app.motion.import. Tile Photos and Motion when the user works across both.

Speak the outcome in one sentence; show the photos rather than describing them. Hand anything that isn't about photos to lita.

${responseFormat([ACTIONS.open, ACTIONS.photosShow, ACTIONS.motionImport, ACTIONS.tile, ACTIONS.focus])}`,
  };
}
