import type { AIAdapter } from '@irpclib/ai-kit/worker';
import type { IRPCData } from '@irpclib/irpc';
import { read, write } from '@irpclib/r2-file';
import { chosenAttempt } from '@/lib/documents/generation.js';
import type { StillDocument } from '@/lib/documents/types.js';
import type { SysAsk, SysHandler } from '@/lib/kernel/agent.js';
import { DOC_ATTEMPTS } from '@/lib/kernel/document.h.js';
import { kernel } from '@/lib/kernel/package.js';
import { type StillAttempt, type StillRequest, stillAttempts } from '@/lib/kernel/stills.h.js';
import { imageUrl } from '@/lib/share/image.js';
import { openLink } from '@/lib/share/links.js';
import { pathFrom, pathTo } from '@/lib/share/paths.js';
import { addAttempts, applyRequest, requestOf } from '@/lib/share/stills.js';
import { drawImage, IMAGE_MODEL } from './images.js';

/** The models a still is made with, by the tier the desktop offers; any other tier, the default. */
export const STILL_MODELS: Record<string, string> = { standard: IMAGE_MODEL, detailed: IMAGE_MODEL };

/** The most images one request makes. */
const MAX_BATCH = 4;

/** How large an attempt is shown on a card, its longest edge. */
const CARD_SIZE = 512;

const STILL_EXTENSION = '.still';

/** What an agent asks `sys.still.generate` for. */
type GenerateArgs = { path?: string; prompt?: string; aspect?: string; batch?: number; references?: string[] };

/**
 * Sets up making stills on the server's models: the desktop's `still.attempts`, and the agents'
 * `sys.still.generate`, which share one way of making attempts.
 *
 * @param adapter - The server's models, the drive driver last.
 * @returns The agents' handler.
 */
export function setupStills(adapter: AIAdapter): SysHandler {
  kernel.construct(stillAttempts, (path, request) => makeAttempts(adapter, path, request));
  return (args, ask) => generateForAgent(adapter, args, ask);
}

/**
 * Makes an agent's new attempts of a still, creating the still when there's none yet. What it asks
 * is written into the still first. A desktop editing that still takes the attempts into its own
 * copy, so they're saved with its edits; otherwise the still is written here.
 */
async function generateForAgent(adapter: AIAdapter, args: IRPCData, { agent, desktop }: SysAsk): Promise<IRPCData> {
  const { path, prompt, aspect, batch, references } = (args ?? {}) as GenerateArgs;
  if (!path?.startsWith('~/') || !path.endsWith(STILL_EXTENSION)) {
    return { error: 'sys.still.generate needs path: a .still in the home (~/…)' };
  }
  const still = (await read<StillDocument>(path, { encoding: 'json' }).catch(() => undefined)) ?? newStill(path);
  applyRequest(still, {
    ...(prompt ? { prompt } : {}),
    settings: { aspect, batch },
    ...(references ? { references } : {}),
  });
  if (!still.prompt) return { error: 'A new still needs a prompt' };

  const request = requestOf(still);
  const attempts = await makeAttempts(adapter, path, request);
  // Nothing made: the still stays as it was, what was asked included.
  if (!attempts.length) return { error: 'No image came back from the model; the still is unchanged' };
  const taken = (await desktop({
    name: DOC_ATTEMPTS,
    args: { path, request, attempts },
    after: -1,
    ask: true,
    agent,
  }).catch(() => undefined)) as { added?: boolean } | undefined;
  if (!taken?.added) {
    addAttempts(still, attempts);
    still.updated = new Date().toISOString();
    await write(path, still as never);
  }
  return { path, open: openLink(path), attempts: attempts.map(({ id, url }) => ({ id, url })) };
}

/**
 * Makes a still's new attempts: as many images as its batch asks, from its prompt and references,
 * each kept in a folder beside it named after it (`Hero.still` keeps `Hero/<id>.webp`).
 *
 * @param adapter - The server's models.
 * @param path - The still's path in the home.
 * @param request - What it's made from.
 * @returns The new attempts, their images by path from the still, and an address to show each at.
 */
export async function makeAttempts(adapter: AIAdapter, path: string, request: StillRequest): Promise<StillAttempt[]> {
  const { model = 'standard', aspect, batch = 1 } = request.settings ?? {};
  const references = (
    await Promise.all((request.references ?? []).map((reference) => imageOf(path, reference)))
  ).filter((image): image is string => !!image);
  const count = Math.min(Math.max(Math.round(batch), 1), MAX_BATCH);
  const drawn = await Promise.all(
    Array.from({ length: count }, () =>
      drawImage(adapter, {
        prompt: request.prompt,
        model: STILL_MODELS[model] ?? IMAGE_MODEL,
        saveTo: path.slice(0, -STILL_EXTENSION.length),
        ...(aspect ? { aspectRatio: aspect } : {}),
        ...(references.length ? { attachments: references } : {}),
      }),
    ),
  );
  const created = new Date().toISOString();
  return drawn.flatMap((output) =>
    output?.url
      ? [
          {
            id: output.id,
            src: pathTo(path, output.url),
            prompt: request.prompt,
            settings: { model, ...(aspect ? { aspect } : {}) },
            created,
            url: imageUrl(output.url, { size: CARD_SIZE }),
          },
        ]
      : [],
  );
}

/**
 * A reference as an image the model can be given: an address as it is; a picture in the drive, or
 * a still's chosen image, inline, since the drive is private. Undefined when there's none.
 */
async function imageOf(still: string, reference: string): Promise<string | undefined> {
  if (/^(https?|data):/.test(reference)) return reference;
  let path = pathFrom(still, reference);
  if (path.endsWith(STILL_EXTENSION)) {
    const source = await read<StillDocument>(path, { encoding: 'json' }).catch(() => undefined);
    const chosen = source && chosenAttempt(source);
    if (!chosen) return undefined;
    if (/^(https?|data):/.test(chosen.src)) return chosen.src;
    path = pathFrom(path, chosen.src);
  }
  return (await read(path, { encoding: 'data-url' }).catch(() => undefined)) ?? undefined;
}

/** A new, empty still at a path, made by an agent. */
function newStill(path: string): StillDocument {
  const now = new Date().toISOString();
  return {
    type: 'still',
    version: 1,
    id: crypto.randomUUID(),
    name: path.slice(path.lastIndexOf('/') + 1, -STILL_EXTENSION.length),
    created: now,
    updated: now,
    author: { kind: 'agent' },
    prompt: '',
    references: [],
    attempts: [],
    edits: [],
    chosen: '',
  };
}
