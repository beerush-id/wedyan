import { AIAdapter, BasetenDriver, MuseDriver } from '@irpclib/ai-kit/worker';
import { IRPCRouter } from '@irpclib/irpc';
import { transport as fileTransport, list, read } from '@irpclib/r2-file';
import type { FileWorkerEnv } from '@irpclib/r2-file/constructor';
import type { ImageWorkerEnv } from '@irpclib/r2-image/worker';
import { BRIEFER, COMPOSER, createAgents, DEFAULT_MODELS, ENTRY, OPEN_MODELS, SPARK_OPEN } from '@/lib/agents/index.js';
import { personaPrompt } from '@/lib/agents/persona.js';
import { SKILLS } from '@/lib/agents/skills.js';
import { withUserAgents } from '@/lib/agents/user-agents.js';
import { type AgentProfile, setupKernel } from '@/lib/kernel/agent.js';
// The conversation's handler: the desktop's one live call to Wedyan.
import { setupConversation } from '@/lib/kernel/chat.js';
// Who is working where in each document, for every desktop showing it.
import '@/lib/kernel/document.js';
import { embedWith, setupMemory, type VectorStore } from '@/lib/memory/memory.js';
import { AGENT_EXTENSION, type AgentFile } from '@/lib/share/agents.js';
import { PROFILE_PATH, type UserProfile } from '@/lib/share/profile.js';
import { AGENTS_PATH } from '@/lib/share/system.js';
import { type SpeechModel, setupSpeech } from '@/lib/speech/speech.js';
import { wsTransport } from '@/src/api.js';
import { DriveDriver } from './drive-driver.js';

/** The bindings and secrets the server runs with (see `wrangler.json`). */
export type ServerEnv = FileWorkerEnv & {
  VECTORIZE: VectorStore;
  AI: Parameters<typeof embedWith>[0] & SpeechModel;
  MUSE_API_KEY?: string;
  /** Baseten's key; with it, Spark Open takes over routing and composing. */
  BASETEN_API_KEY?: string;
  /** The picture resizer: R2 Image's container, bound where Wedyan is deployed. */
  RESIZER?: ImageWorkerEnv['RESIZER'];
  /** The picture resizer by URL, where no container is bound: R2 Image's image running locally. */
  RESIZER_URL?: string;
};

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
    adapter: withModels(MODELS, keys),
    agents: createAgents(keys.baseten ? OPEN_MODELS : DEFAULT_MODELS),
    entry: ENTRY,
    composer: COMPOSER,
    skills: SKILLS,
    routers: [new IRPCRouter(fileTransport), new IRPCRouter(wsTransport)],
    persona: loadPersona,
    userAgents: loadUserAgents,
  });
  setupConversation({ briefer: BRIEFER });
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
 * The agents an ask in this session runs with: Wedyan's, and the user's own from `~/Agents`. A
 * file that isn't an agent is skipped; without the folder, Wedyan's alone.
 *
 * @param agents - Wedyan's agents.
 * @returns The agents, the user's own added.
 */
export async function loadUserAgents(agents: Record<string, AgentProfile>): Promise<Record<string, AgentProfile>> {
  const listed = await list(AGENTS_PATH).catch(() => undefined);
  const paths = (listed?.entries ?? [])
    .filter((entry) => !entry.isDirectory && entry.name.endsWith(AGENT_EXTENSION))
    .map((entry) => `${AGENTS_PATH}/${entry.name}`);
  if (!paths.length) return agents;

  const [profile, ...files] = await Promise.all([
    read<UserProfile>(PROFILE_PATH, { encoding: 'json' }),
    ...paths.map((path) => read<AgentFile>(path, { encoding: 'json' }).catch(() => null)),
  ]);
  const own = paths.flatMap((path, index) => {
    const file = files[index] as AgentFile | null;
    return file?.type === 'agent' && Array.isArray(file.skills) ? [{ path, file }] : [];
  });
  return withUserAgents(agents, SKILLS, own, (profile as UserProfile | null) ?? undefined);
}

/**
 * The models the server runs, shared by the agents and the desktop's own generation (ai-kit's
 * endpoint), so each is set up once. Its drivers are added by `withModels` once the keys are known.
 */
export const MODELS = new AIAdapter();

/**
 * Adds the models to an adapter: Meta's, Spark Open on Baseten when its key is set, and last, after
 * every provider, the drive, which keeps generated media in the user's drive when a call says where.
 *
 * @param adapter - The adapter to add them to.
 * @param keys - The Meta Model API key, and Baseten's if there is one.
 * @returns The adapter serving Muse Spark, Muse Wonder and Muse Image, and Spark Open with Baseten.
 */
export function withModels(adapter: AIAdapter, keys: { meta: string; baseten?: string }): AIAdapter {
  adapter.use(new MuseDriver({ apiKey: keys.meta }));
  if (keys.baseten) adapter.use(new BasetenDriver({ apiKey: keys.baseten, models: [SPARK_OPEN] }));
  return adapter.use(new DriveDriver());
}
