import { AIAdapter, OpenAIDriver } from '@irpclib/ai-kit/worker';
import { IRPCRouter } from '@irpclib/irpc';
import { transport as fileTransport, read } from '@irpclib/r2-file';
import type { FileWorkerEnv } from '@irpclib/r2-file/constructor';
import { createAgents, ENTRY } from '@/lib/agents/index.js';
import { personaPrompt, type UserProfile } from '@/lib/agents/persona.js';
import { SKILLS } from '@/lib/agents/skills.js';
import { setupKernel } from '@/lib/kernel/agent.js';
import { embedWith, setupMemory, type VectorStore } from '@/lib/memory/memory.js';
import { wsTransport } from '@/src/api.js';

/** The bindings and secrets the server runs with (see `wrangler.json`). */
export type ServerEnv = FileWorkerEnv & {
  VECTORIZE: VectorStore;
  AI: Parameters<typeof embedWith>[0];
  MUSE_API_KEY?: string;
};

/** Where Meta's models are served, over the Responses API. */
const META_API = 'https://api.meta.ai/v1';

let ready = false;

/**
 * Sets up the kernel and memory with the server's bindings, once per process: the agents and
 * their skills, the tools of r2-file and memory, Meta's models, and the vector index.
 *
 * @param env - The resolved bindings.
 */
export function setupServer(env: ServerEnv): void {
  if (ready) return;
  ready = true;

  setupKernel({
    adapter: modelAdapter(env.MUSE_API_KEY ?? globalThis.process?.env?.MUSE_API_KEY ?? ''),
    agents: createAgents(),
    entry: ENTRY,
    skills: SKILLS,
    routers: [new IRPCRouter(fileTransport), new IRPCRouter(wsTransport)],
    persona: loadPersona,
  });
  setupMemory({ vectors: env.VECTORIZE, embed: embedWith(env.AI) });
}

/**
 * The persona every agent speaks with in this session, from its `~/profile.json`; Wedyan's own
 * when the session has no profile yet.
 *
 * @returns The persona section of the agents' prompts.
 */
export async function loadPersona(): Promise<string> {
  const profile = (await read<UserProfile>('~/profile.json', { encoding: 'json' })) ?? undefined;
  return personaPrompt(profile);
}

/**
 * Meta's models, as the agents call them.
 *
 * @param apiKey - The Meta Model API key.
 * @returns The adapter serving Muse Spark and Muse Wonder.
 */
function modelAdapter(apiKey: string): AIAdapter {
  return new AIAdapter().use(
    new OpenAIDriver({
      name: 'meta',
      baseUrl: META_API,
      apiKey,
      models: ['muse-spark-1.3', 'muse-wonder-1.0'],
      api: 'responses',
    }),
  );
}
