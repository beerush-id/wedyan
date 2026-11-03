import { AIAdapter, BasetenDriver, MuseDriver } from '@irpclib/ai-kit/worker';
import { IRPCRouter } from '@irpclib/irpc';
import { transport as fileTransport, list, read } from '@irpclib/r2-file';
import type { FileWorkerEnv } from '@irpclib/r2-file/constructor';
import type { ImageWorkerEnv } from '@irpclib/r2-image/worker';
import { BRIEFER, COMPOSER, createAgents, DEFAULT_MODELS, ENTRY, OPEN_MODELS, SPARK_OPEN } from '@/lib/agents/index.js';
import { personaPrompt } from '@/lib/agents/persona.js';
import { SKILLS, userSkill } from '@/lib/agents/skills.js';
import { TOOLS } from '@/lib/agents/tools.js';
import { withUserAgents } from '@/lib/agents/user-agents.js';
import { type AgentProfile, setupKernel } from '@/lib/kernel/agent.js';
// The conversation's handler: the desktop's one live call to Wedyan.
import { setupConversation } from '@/lib/kernel/chat.js';
// Who is working where in each document, for every desktop showing it.
import '@/lib/documents/file-types.js';
import '@/lib/kernel/account.js';
import '@/lib/kernel/document.js';
import { setupFonts } from '@/lib/kernel/fonts.js';
import { embedWith, setupMemory, type VectorStore } from '@/lib/memory/memory.js';
import { AGENT_EXTENSION, type AgentFile } from '@/lib/share/agents.js';
import {
  PROFILE_PATH,
  SETTINGS_PATH,
  type UserDetails,
  type UserProfile,
  type UserSettings,
} from '@/lib/share/profile.js';
import { type SkillFile, userSkillPath } from '@/lib/share/skills.js';
import { AGENTS_PATH } from '@/lib/share/system.js';
import { type SpeechModel, setupSpeech } from '@/lib/speech/speech.js';
import { setupSystem } from '@/lib/system/system.js';
import { wsTransport } from '@/src/api.js';
import { DriveDriver } from './drive-driver.js';
import { generateImage, searchPhotos } from './images.js';
import { setupMotions } from './motions.js';
import { setupStills } from './stills.js';
import { setupUsage, UsageDriver } from './usage.js';

/** The bindings and secrets the server runs with (see `wrangler.json`). */
export type ServerEnv = FileWorkerEnv & {
  VECTORIZE: VectorStore;
  AI: Parameters<typeof embedWith>[0] & SpeechModel;
  MUSE_API_KEY?: string;
  /** Baseten's key; with it, Spark Open takes over routing and composing. */
  BASETEN_API_KEY?: string;
  /** Google's key, which lists Google Fonts. */
  GOOGLE_API_KEY?: string;
  /** The key a private deployment is opened with, by link; unset, it's open to everyone. */
  WEDYAN_ACCESS_KEY?: string;
  /** The picture resizer: R2 Image's container, which runs only where Wedyan is deployed. */
  RESIZER?: ImageWorkerEnv['RESIZER'];
  /** The picture resizer in development: R2 Image's image running locally. */
  RESIZER_URL?: string;
};

/** One running container, as far as resizing reaches it. */
type ContainerStub = { fetch: typeof fetch };

/** The part of the containers' binding resizing uses. */
type ContainerNamespace = { idFromName(name: string): unknown; get(id: unknown): ContainerStub };

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
  if (process.env.NODE_ENV === 'production') setupUsage(env.DB as never);
  setupFonts(env.GOOGLE_API_KEY ?? globalThis.process?.env?.GOOGLE_API_KEY);
  const adapter = withModels(MODELS, keys);
  setupStills(adapter, picturesOf(env));
  setupSystem(adapter, picturesOf(env));
  setupKernel({
    adapter,
    agents: createAgents(keys.baseten ? OPEN_MODELS : DEFAULT_MODELS),
    entry: ENTRY,
    composer: COMPOSER,
    skills: SKILLS,
    routers: [new IRPCRouter(fileTransport), new IRPCRouter(wsTransport)],
    persona: loadPersona,
    userAgents: loadUserAgents,
    sys: {
      [TOOLS.budgetRequest.name]: (args, ask) => {
        const { turns } = args as { turns?: number };
        return Number.isInteger(turns) && (turns as number) > 0 ? ask.budget(turns as number) : { error: 'turns must be a whole number above 0' };
      },
      [TOOLS.photosSearch.name]: searchPhotos,
      [TOOLS.imageGenerate.name]: generateImage(adapter),
      ...setupMotions(adapter, picturesOf(env)),
    },
  });
  setupConversation({ briefer: BRIEFER });
  setupMemory({ vectors: env.VECTORIZE, embed: embedWith(env.AI) });
  setupSpeech(env.AI, keys.meta);
}

/**
 * What R2 Image works with, from the server's bindings: the bucket the user's files are in, and the
 * resizer: the bound containers where deployed; locally the binding exists but can't run a container,
 * so the one running at `RESIZER_URL`.
 *
 * @param env - The resolved bindings.
 * @returns R2 Image's bindings.
 */
export function picturesOf(env: ServerEnv): ImageWorkerEnv {
  const resizer = process.env.NODE_ENV === 'production' ? resizerPool(env.RESIZER as never) : env.RESIZER_URL;
  return { IMAGES: env.BUCKET as never, RESIZER: resizer as ImageWorkerEnv['RESIZER'] };
}

/** How many containers share the resizing: `max_instances` in `wrangler.json`. */
const RESIZERS = 3;

/**
 * The resizing containers as one service, each picture going to any of them. Named alike, every
 * picture would queue on one container, however many may run: a page of new pictures comes all at once.
 *
 * @param namespace - The containers' binding.
 * @returns What R2 Image calls to resize.
 */
function resizerPool(namespace: ContainerNamespace): Pick<ContainerStub, 'fetch'> {
  return {
    fetch: (input, init) => {
      const name = `resizer-${Math.floor(Math.random() * RESIZERS)}`;
      return namespace.get(namespace.idFromName(name)).fetch(input, init);
    },
  };
}

/**
 * The persona every agent speaks with in this session, from its `~/profile.json` and
 * `~/settings.json`; Wedyan's own when the session has neither yet.
 *
 * @returns The persona section of the agents' prompts.
 */
export async function loadPersona(): Promise<string> {
  return personaPrompt(await readUser());
}

/** The session's profile and settings, as far as it has any. */
async function readUser(): Promise<UserDetails> {
  const [profile, settings] = await Promise.all([
    read<UserProfile>(PROFILE_PATH, { encoding: 'json' }),
    read<UserSettings>(SETTINGS_PATH, { encoding: 'json' }),
  ]);
  return { ...settings, ...profile };
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
    .filter((entry) => !entry.isDirectory && entry.path.endsWith(AGENT_EXTENSION))
    .map((entry) => entry.path);
  if (!paths.length) return agents;

  const [user, ...files] = await Promise.all([
    readUser(),
    ...paths.map((path) => read<AgentFile>(path, { encoding: 'json' }).catch(() => null)),
  ]);
  const own = paths.flatMap((path, index) => {
    const file = files[index] as AgentFile | null;
    return file?.type === 'agent' && Array.isArray(file.skills) ? [{ path, file }] : [];
  });

  // The user's own skills the agents are given, each read once, by its path; one that can't be
  // read grants nothing.
  const wanted = new Set(
    own.flatMap(({ path, file }) => file.skills.flatMap((name) => userSkillPath(path, name) ?? [])),
  );
  const skillFiles = await Promise.all(
    [...wanted].map(
      async (path) => [path, await read<SkillFile>(path, { encoding: 'json' }).catch(() => null)] as const,
    ),
  );
  const theirs = Object.fromEntries(
    skillFiles.flatMap(([path, file]) => (file?.type === 'skill' ? [[path, userSkill(file)]] : [])),
  );
  return withUserAgents(agents, { ...SKILLS, ...theirs }, own, user as UserDetails);
}

/**
 * The models the server runs, shared by the agents and the desktop's own generation (ai-kit's
 * endpoint), so each is set up once. Its drivers are added by `withModels` once the keys are known.
 */
export const MODELS = new AIAdapter();

/**
 * Adds the models to an adapter: first what holds them to the day's limits, then Meta's, Spark Open
 * on Baseten when its key is set, and last, after every provider, the drive, which keeps generated
 * media in the user's drive when a call says where.
 *
 * @param adapter - The adapter to add them to.
 * @param keys - The Meta Model API key, and Baseten's if there is one.
 * @returns The adapter serving Muse Spark, Muse Wonder and Muse Image, and Spark Open with Baseten.
 */
export function withModels(adapter: AIAdapter, keys: { meta: string; baseten?: string }): AIAdapter {
  adapter.use(new UsageDriver());
  adapter.use(new MuseDriver({ apiKey: keys.meta }));
  if (keys.baseten) adapter.use(new BasetenDriver({ apiKey: keys.baseten, models: [SPARK_OPEN] }));
  return adapter.use(new DriveDriver());
}
