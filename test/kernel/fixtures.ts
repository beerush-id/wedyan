import { AIAdapter, OpenAIDriver } from '@irpclib/ai-kit/worker';
import type { AgentProfile } from '../../lib/kernel/agent.js';

/**
 * Four agents: a router that hands off, an assistant with server tools, a photos agent, and a
 * composer for widgets.
 */
export const AGENTS: Record<string, AgentProfile> = {
  router: { name: 'router', model: 'router-m', system: 'Route.', tools: [], handoffs: ['assistant', 'photos'] },
  assistant: {
    name: 'assistant',
    model: 'assistant-m',
    system: 'Assist.',
    tools: [
      { name: 'sys.fs.read', description: 'Reads a file' },
      { name: 'files.read', description: 'Reads a file, as a package tool' },
    ],
    handoffs: ['photos'],
  },
  photos: { name: 'photos', model: 'photos-m', system: 'Photos.', tools: [] },
  composer: { name: 'composer', model: 'composer-m', system: 'Compose.', tools: [] },
};

/**
 * A real adapter with a real OpenAI-compatible driver serving the fixture agents' models.
 *
 * @param api - Which API the driver speaks; `chat` unless a test needs the Responses API.
 */
export function createTestAdapter(api: 'chat' | 'responses' = 'chat'): AIAdapter {
  return new AIAdapter().use(
    new OpenAIDriver({
      name: 'meta',
      baseUrl: 'https://api.meta.test/v1',
      apiKey: 'k',
      models: ['router-m', 'assistant-m', 'photos-m', 'composer-m', 'director-m', 'casting-m'],
      api,
    }),
  );
}
