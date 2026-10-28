import { mutable } from '@airlib/react';
import type { ChatMessage, ChatOutput } from '@irpclib/ai-kit';
import { AIAdapter, OpenAIDriver } from '@irpclib/ai-kit/worker';
import { describe, it } from 'vitest';
import { createAgents, DEFAULT_MODELS } from '../../lib/agents/index.js';

// Raw driver output for one agent turn: answer, commentary, reasoning and calls as the provider
// labeled them. For diagnosing a beat when the loop's report isn't enough.

const KEY = process.env.MUSE_API_KEY ?? '';

describe.skipIf(!KEY)('raw agent turn, live', () => {
  it('lita on wake, after the queue was read', async () => {
    const lita = createAgents().lita;
    const history: ChatMessage[] = [
      { role: 'user', type: 'object', data: { context: { event: 'wake', userName: 'Nanang', assistantName: 'Lita' } } },
      { role: 'user', type: 'text', text: '(The user unlocked the screen.)' },
      {
        role: 'user',
        type: 'object',
        data: { handoff: { from: 'router', brief: 'The user woke; brief them.', results: [] } },
      },
    ];
    const live = mutable<{ data?: ChatOutput }>({});
    const adapter = new AIAdapter().use(
      new OpenAIDriver({
        name: 'meta',
        baseUrl: 'https://api.meta.ai/v1',
        apiKey: KEY,
        models: [DEFAULT_MODELS.agents.model],
        api: 'responses',
      }),
    );

    await new Promise<void>((resolve, reject) => {
      void adapter.ask(
        history,
        { model: lita.model, system: lita.system, tools: lita.tools },
        { state: live, resolve, reject },
      );
    });

    const output = JSON.parse(JSON.stringify(live.data ?? {}));
    process.stdout.write(
      `\n=== raw\n${JSON.stringify(
        {
          text: output.text,
          commentary: output.commentary?.join(''),
          reasoning: output.reasoning?.join(''),
          toolCalls: output.toolCalls,
          status: output.status,
        },
        null,
        2,
      )}\n`,
    );
  });
});
