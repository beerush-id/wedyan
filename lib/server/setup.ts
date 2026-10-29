import { AIAdapter, OpenAIDriver } from '@irpclib/ai-kit/worker';
import { IRPCRouter } from '@irpclib/irpc';
import { transport as fileTransport, read } from '@irpclib/r2-file';
import type { FileWorkerEnv } from '@irpclib/r2-file/constructor';
import { COMPOSER, createAgents, DEFAULT_MODELS, ENTRY, OPEN_MODELS, SPARK_OPEN } from '@/lib/agents/index.js';
import { personaPrompt } from '@/lib/agents/persona.js';
import { SKILLS } from '@/lib/agents/skills.js';
import { setupKernel } from '@/lib/kernel/agent.js';
// The conversation's handler: the desktop's one live call to Wedyan.
import '@/lib/kernel/chat.js';
import { embedWith, setupMemory, type VectorStore } from '@/lib/memory/memory.js';
import { PROFILE_PATH, type UserProfile } from '@/lib/share/profile.js';
import { type SpeechModel, setupSpeech } from '@/lib/speech/speech.js';
import { wsTransport } from '@/src/api.js';

/** The bindings and secrets the server runs with (see `wrangler.json`). */
export type ServerEnv = FileWorkerEnv & {
  VECTORIZE: VectorStore;
  AI: Parameters<typeof embedWith>[0] & SpeechModel;
  MUSE_API_KEY?: string;
  /** Baseten's key; with it, Spark Open takes over routing and composing. */
  BASETEN_API_KEY?: string;
};

/** Where Meta's models are served, over the Responses API. */
const META_API = 'https://api.meta.ai/v1';

/** Where Baseten serves Spark Open, over the Responses API. */
const BASETEN_API = 'https://inference.baseten.co/v1';

let ready = false;

/**
 * Sets up the kernel and memory with the server's bindings, once per process: the agents and
 * their skills, the tools of r2-file and memory, the models (Spark Open routing and composing when
 * Baseten's key is set), the vector index, and the voice.
 *
 * @param env - The resolved bindings.
 */
export function setupServer(env: ServerEnv): void {
  if (ready) return;
  ready = true;

  const keys = {
    meta: env.MUSE_API_KEY ?? globalThis.process?.env?.MUSE_API_KEY ?? '',
    baseten: env.BASETEN_API_KEY ?? globalThis.process?.env?.BASETEN_API_KEY,
  };
  setupKernel({
    adapter: modelAdapter(keys),
    agents: createAgents(keys.baseten ? OPEN_MODELS : DEFAULT_MODELS),
    entry: ENTRY,
    composer: COMPOSER,
    skills: SKILLS,
    routers: [new IRPCRouter(fileTransport), new IRPCRouter(wsTransport)],
    persona: loadPersona,
  });
  setupMemory({ vectors: env.VECTORIZE, embed: embedWith(env.AI) });
  setupSpeech(env.AI, keys.meta);
}

/**
 * The persona every agent speaks with in this session, from its `~/profile.json`; Wedyan's own
 * when the session has no profile yet.
 *
 * @returns The persona section of the agents' prompts.
 */
export async function loadPersona(): Promise<string> {
  const profile = (await read<UserProfile>(PROFILE_PATH, { encoding: 'json' })) ?? undefined;
  return personaPrompt(profile);
}

/**
 * The models the agents call: Meta's, and Spark Open on Baseten when its key is set.
 *
 * @param keys - The Meta Model API key, and Baseten's if there is one.
 * @returns The adapter serving Muse Spark and Muse Wonder, and Spark Open with Baseten.
 */
function modelAdapter(keys: { meta: string; baseten?: string }): AIAdapter {
  const adapter = new AIAdapter().use(
    new OpenAIDriver({
      name: 'meta',
      baseUrl: META_API,
      apiKey: keys.meta,
      models: ['muse-spark-1.3', 'muse-wonder-1.0'],
      api: 'responses',
    }),
  );
  if (!keys.baseten) return adapter;
  return adapter.use(
    new OpenAIDriver({
      name: 'baseten',
      baseUrl: BASETEN_API,
      apiKey: keys.baseten,
      models: [SPARK_OPEN],
      api: 'responses',
    }),
  );
}
