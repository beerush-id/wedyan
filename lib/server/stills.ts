import type { ChatOutput } from '@irpclib/ai-kit';
import type { AIAdapter } from '@irpclib/ai-kit/worker';
import type { IRPCData } from '@irpclib/irpc';
import { mutable } from '@irpclib/irpc/core';
import { read, write } from '@irpclib/r2-file';
import type { ImageWorkerEnv } from '@irpclib/r2-image/worker';
import { DEFAULT_MODELS } from '@/lib/agents/index.js';
import { chosenAttempt, defaultPictures } from '@/lib/documents/generation.js';
import type { PersonaDocument, StillDocument } from '@/lib/documents/types.js';
import type { SysAsk, SysHandler } from '@/lib/kernel/agent.js';
import { DOC_ATTEMPTS } from '@/lib/kernel/document.h.js';
import { kernel } from '@/lib/kernel/package.js';
import {
  type DescribeOptions,
  type DescriptionType,
  type StillAttempt,
  type StillRequest,
  stillAttempts,
  stillDescribe,
} from '@/lib/kernel/stills.h.js';
import { imageUrl } from '@/lib/share/image.js';
import { openLink } from '@/lib/share/links.js';
import { pathFrom, pathTo } from '@/lib/share/paths.js';
import { addAttempts, applyRequest, requestOf } from '@/lib/share/stills.js';
import { drawImage, IMAGE_MODEL, resizePicture } from './images.js';

/** The models a still is made with, by the tier the desktop offers; any other tier, the default. */
export const STILL_MODELS: Record<string, string> = { standard: IMAGE_MODEL, detailed: IMAGE_MODEL };

/** The most images one request makes. */
const MAX_BATCH = 4;

/** How large an attempt is shown on a card, its longest edge. */
const CARD_SIZE = 512;

const STILL_EXTENSION = '.still';

/**
 * The model a still is described with: Spark at minimal effort, which looked as closely as Spark Open
 * at low, in two thirds of the time and for two thirds of the cost.
 */
const DESCRIBER = DEFAULT_MODELS.agents;

/** How large a still is shown to the describer, its longest edge: any smaller saves little and loses detail. */
const DESCRIBE_SIZE = 512;

/** How large a reference is sent to the model, its longest edge, inline as WebP. */
const REFERENCE_SIZE = 1024;

/** What the describer is asked, by what the description is for. */
export const DESCRIBE_PROMPTS: Record<DescriptionType, string> = {
  face: 'Describe only the face and head of the person in this picture, in two paragraphs, plain words, no preamble. First, who they are, so an image model could draw the same person again in any scene, outfit, pose or style: apparent age and sex, face shape, skin tone and texture, eyes (shape, colour), brows, nose, lips, cheeks, jaw and chin, hair (colour, length, texture, hairline), facial hair, and distinguishing marks such as freckles, scars, moles, wrinkles or glasses. Second, starting with "Expression:", the expression exactly as drawn, so it can be adjusted: what the brows, forehead, eyes and lids, mouth, lips and jaw are each doing, how tense the face is, any tears or flush, how strong it reads, and what it could be mistaken for. Leave out clothing, pose, lighting, background and art style.',
  subject:
    'Say what this picture shows, for someone who can’t see it and is asked to change it: who or what the subject is (a person’s apparent age and sex, an animal’s kind), how it is framed (close-up, head and shoulders, half body, full body), its pose and what it is doing, and where it is. Two or three sentences, plain words, no preamble.',
};

/** What an agent asks `sys.still.generate` for. */
type GenerateArgs = { path?: string; prompt?: string; model?: string; aspect?: string; batch?: number; references?: string[] };

/**
 * Sets up making stills on the server's models: the desktop's `still.attempts` and `still.describe`,
 * and the agents' `sys.still.generate`, which shares one way of making attempts.
 *
 * @param adapter - The server's models, the drive driver last.
 * @param pictures - The bucket and the resizer, for R2 Image to resize what's described.
 * @returns The agents' handler.
 */
export function setupStills(adapter: AIAdapter, pictures: ImageWorkerEnv): SysHandler {
  kernel.construct(stillAttempts, (path, request) => makeAttempts(adapter, pictures, path, request));
  kernel.construct(stillDescribe, (path, options) => describeStill(adapter, pictures, path, options));
  return (args, ask) => generateForAgent(adapter, pictures, args, ask);
}

/**
 * Makes an agent's new attempts of a still, creating the still when there's none yet. What it asks
 * is written into the still first. A desktop editing that still takes the attempts into its own
 * copy, so they're saved with its edits; otherwise the still is written here.
 */
async function generateForAgent(
  adapter: AIAdapter,
  pictures: ImageWorkerEnv,
  args: IRPCData,
  { agent, desktop }: SysAsk,
): Promise<IRPCData> {
  const { path, prompt, model, aspect, batch, references } = (args ?? {}) as GenerateArgs;
  if (!path?.startsWith('~/') || !path.endsWith(STILL_EXTENSION)) {
    return { error: 'sys.still.generate needs path: a .still in the home (~/…)' };
  }
  const still = (await read<StillDocument>(path, { encoding: 'json' }).catch(() => undefined)) ?? newStill(path);
  // What's being changed is made from, but never listed among what it's made from.
  const itself = (reference: string) => pathFrom(path, reference) === path;
  applyRequest(still, {
    ...(prompt ? { prompt } : {}),
    settings: { model, aspect, batch },
    ...(references ? { references: references.filter((reference) => !itself(reference)) } : {}),
  });
  if (!still.prompt) return { error: 'A new still needs a prompt' };

  const request = requestOf(still);
  const changing = references?.some(itself) && chosenAttempt(still);
  const made = changing ? { ...request, references: [...(request.references ?? []), path] } : request;
  const attempts = await makeAttempts(adapter, pictures, path, made);
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
 * Makes a new still and writes it, for what an agent puts together with no window open on it. It's
 * written even when no picture comes back, so what was asked is there to make again.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer, for R2 Image to size the references.
 * @param path - Where it goes, in the home.
 * @param name - What it's called.
 * @param request - What it's made from.
 * @returns The still, with its one picture when it came back.
 */
export async function makeStill(
  adapter: AIAdapter,
  pictures: ImageWorkerEnv,
  path: string,
  name: string,
  request: StillRequest,
): Promise<StillDocument> {
  const still: StillDocument = { ...newStill(path), name, casts: request.casts ?? [] };
  applyRequest(still, request);
  addAttempts(still, await makeAttempts(adapter, pictures, path, requestOf(still)).catch(() => []));
  await write(path, still as never);
  return still;
}

/**
 * Makes a still's new attempts, or a take's pictures: as many images as its batch asks, from its
 * prompt and references, each kept in a folder beside it named after it (`Hero.still` keeps
 * `Hero/<id>.webp`).
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer, for R2 Image to size the references.
 * @param path - The still's path in the home.
 * @param request - What it's made from.
 * @returns The new attempts, their images by path from the still, and an address to show each at.
 */
export async function makeAttempts(
  adapter: AIAdapter,
  pictures: ImageWorkerEnv,
  path: string,
  request: StillRequest,
): Promise<StillAttempt[]> {
  const { model = 'standard', aspect, batch = 1 } = request.settings ?? {};
  const [written, casted] = await Promise.all([
    Promise.all((request.references ?? []).map((reference) => referenceOf(pictures, path, reference))),
    Promise.all((request.casts ?? []).map((cast) => castImages(pictures, path, cast, request.castPictures?.[cast]))),
  ]);
  const references = [...written, ...casted.flat()];
  const count = Math.min(Math.max(Math.round(batch), 1), MAX_BATCH);
  const drawn = await Promise.all(
    Array.from({ length: count }, () =>
      drawImage(adapter, {
        prompt: request.prompt,
        model: STILL_MODELS[model] ?? IMAGE_MODEL,
        saveTo: path.slice(0, path.lastIndexOf('.')),
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
 * Describes a still's chosen image for one purpose: resized by R2 Image so the describer reads a
 * sixth of the tokens in half the time, with nothing lost that the words need.
 *
 * @param adapter - The server's models.
 * @param pictures - The bucket and the resizer.
 * @param path - The still's path in the home.
 * @param options - What the description is for.
 * @returns The description; throws when the still has no image yet.
 */
async function describeStill(
  adapter: AIAdapter,
  pictures: ImageWorkerEnv,
  path: string,
  { type }: DescribeOptions,
): Promise<string> {
  if (!path.startsWith('~/') || !path.endsWith(STILL_EXTENSION)) {
    throw new Error('still.describe needs a .still in the home (~/…)');
  }
  const still = await read<StillDocument>(path, { encoding: 'json' }).catch(() => undefined);
  const chosen = still && chosenAttempt(still);
  if (!chosen) throw new Error(`${path} has no image to describe yet`);
  const picture = isAddress(chosen.src)
    ? chosen.src
    : await resizePicture(pictures, pathFrom(path, chosen.src), DESCRIBE_SIZE);

  const live = mutable<{ data?: ChatOutput }>({});
  await new Promise<void>((resolve, reject) => {
    void adapter.ask(
      [{ role: 'user', type: 'text', text: DESCRIBE_PROMPTS[type], attachments: [picture] }],
      { model: DESCRIBER.model, ...(DESCRIBER.effort ? { reasoningEffort: DESCRIBER.effort } : {}) },
      { state: live, resolve, reject },
    );
  });
  const described = (live.data?.text || (live.data?.chunks ?? []).join('')).trim();
  if (!described) throw new Error(`No description came back for ${path}`);
  return described;
}

/**
 * A reference as the model is given it. What's asked is made from it or not made at all: drawn
 * without it, the picture comes back looking fine and nothing like what was asked.
 *
 * @param pictures - The bucket and the resizer.
 * @param still - The still's path in the home.
 * @param reference - The reference, as written.
 * @returns The image; throws when there's none to give.
 */
async function referenceOf(pictures: ImageWorkerEnv, still: string, reference: string): Promise<string> {
  const image = await imageOf(pictures, still, reference);
  if (!image) throw new Error(`Couldn't read the reference ${reference}`);
  return image;
}

/**
 * Someone cast, as the pictures the model is given to keep them the same: the ones picked of them,
 * or their defaults. Someone with none to give is no reason not to make the picture.
 *
 * @param pictures - The bucket and the resizer.
 * @param still - The path of what's being made.
 * @param cast - The `.persona`, by path.
 * @param picked - Which of their pictures, as the persona writes them, if any were picked.
 * @returns The images there are.
 */
async function castImages(pictures: ImageWorkerEnv, still: string, cast: string, picked?: string[]): Promise<string[]> {
  const path = pathFrom(still, cast.replace(/^\//, ''));
  const persona = await read<PersonaDocument>(path, { encoding: 'json' }).catch(() => undefined);
  if (!persona) return [];
  const images = await Promise.all((picked ?? defaultPictures(persona)).map((picture) => imageOf(pictures, path, picture)));
  return images.filter((image): image is string => !!image);
}

/**
 * A reference as an image the model can be given: an address as it is; a picture in the drive, by
 * its path or the `/~/…` it's delivered from, or a still's chosen image, inline and sized by R2
 * Image, since the drive is private. Undefined when there's none.
 */
async function imageOf(pictures: ImageWorkerEnv, still: string, reference: string): Promise<string | undefined> {
  if (isAddress(reference)) return reference;
  let path = pathFrom(still, reference.replace(/^\//, ''));
  if (path.endsWith(STILL_EXTENSION)) {
    const source = await read<StillDocument>(path, { encoding: 'json' }).catch(() => undefined);
    const chosen = source && chosenAttempt(source);
    if (!chosen) return undefined;
    if (isAddress(chosen.src)) return chosen.src;
    path = pathFrom(path, chosen.src.replace(/^\//, ''));
  }
  return resizePicture(pictures, path, REFERENCE_SIZE).catch(() => undefined);
}

/** Whether an image is an address a model can be given as it is, rather than a path in the drive. */
function isAddress(image: string): boolean {
  return /^(https?|data):/.test(image);
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
