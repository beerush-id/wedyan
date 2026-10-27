import { AIAdapter, OpenAIDriver } from '@irpclib/ai-kit/worker';
import type { AgentProfile } from '../../lib/kernel/agent.js';

/** Three agents: a router that hands off, an assistant with a server call, and a photos agent. */
export const AGENTS: Record<string, AgentProfile> = {
  router: { name: 'router', model: 'router-m', system: 'Route.', tools: [], handoffs: ['assistant', 'photos'] },
  assistant: {
    name: 'assistant',
    model: 'assistant-m',
    system: 'Assist.',
    tools: [
      { name: 'sys.fs.read', description: 'Reads a file' },
      { name: 'app.photos.open', description: 'Opens Photos' },
      { name: 'app.mail.open', description: 'Opens Mail' },
      { name: 'ask_user', description: 'Asks the user a question' },
    ],
    handoffs: ['photos'],
  },
  photos: { name: 'photos', model: 'photos-m', system: 'Photos.', tools: [] },
};

/** A real adapter with a real OpenAI-compatible driver serving the fixture agents' models. */
export function createTestAdapter(): AIAdapter {
  return new AIAdapter().use(
    new OpenAIDriver({
      name: 'meta',
      baseUrl: 'https://api.meta.test/v1',
      apiKey: 'k',
      models: ['router-m', 'assistant-m', 'photos-m'],
    }),
  );
}
