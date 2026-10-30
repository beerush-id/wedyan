import type { AIAdapter, ImageAspectRatio, ImageOptions, ImageOutput } from '@irpclib/ai-kit/worker';
import type { IRPCData } from '@irpclib/irpc';
import { mutable } from '@irpclib/irpc/core';
import type { SavedOptions } from '@/lib/share/ai.js';

/** The model Wedyan generates images with: Muse Image, a flat price per image whatever its size. */
export const IMAGE_MODEL = 'muse-image-1.0';

/** What an agent asks `sys.image.generate` for. */
type GenerateArgs = { prompt?: string; saveTo?: string; aspect?: ImageAspectRatio };

/**
 * Serves `sys.image.generate` for the agents: one image from a description, kept in the user's
 * drive in the folder they name (the drive driver names it by its id), never as a link that expires.
 *
 * @param adapter - The server's models, the drive driver last.
 * @returns The handler: the new image's path in the drive, or why there is none.
 */
export function generateImage(adapter: AIAdapter): (args: IRPCData) => Promise<IRPCData> {
  return async (args) => {
    const { prompt, saveTo, aspect } = (args ?? {}) as GenerateArgs;
    if (!prompt || !saveTo?.startsWith('~/')) {
      return { error: 'sys.image.generate needs a prompt, and saveTo: a folder in the home (~/…)' };
    }
    const output = await drawImage(adapter, {
      prompt,
      model: IMAGE_MODEL,
      saveTo,
      ...(aspect ? { aspectRatio: aspect } : {}),
    });
    return output?.url ? { path: output.url } : { error: 'No image came back' };
  };
}

/**
 * Draws one image on the server's models, kept in the drive when the options say where.
 *
 * @param adapter - The server's models, the drive driver last.
 * @param options - What to draw, and where to keep it.
 * @returns What was drawn: its id, and its path in the drive once kept.
 */
export async function drawImage(
  adapter: AIAdapter,
  options: ImageOptions & SavedOptions,
): Promise<ImageOutput | undefined> {
  const state = mutable<{ data?: ImageOutput }>({});
  await new Promise<void>((resolve, reject) => {
    void adapter.draw(options, { state, resolve, reject });
  });
  return state.data;
}
