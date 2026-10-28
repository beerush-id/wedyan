import { mutable, withContext } from '@airlib/react';
import { type Log, LogLevel } from '@beerush/logger';
import { AIAdapter, OpenAIDriver } from '@irpclib/ai-kit/worker';
import { describe, expect, it } from 'vitest';
import { COMPOSER, createAgents, DEFAULT_MODELS } from '../../lib/agents/index.js';
import { personaPrompt } from '../../lib/agents/persona.js';
import type { AskState, WidgetPart } from '../../lib/kernel/agent.h.js';
import { runAgentLoop } from '../../lib/kernel/agent.js';
import { logger } from '../../lib/logger.js';

// Whether a look the user asked for reaches the widgets June draws: the preference is in the user's
// profile, Wendy answers, June composes. Each ask prints what Wendy described and what June drew.

const KEY = process.env.MUSE_API_KEY ?? '';

/** The look the user asked for, as they'd say it. */
const PREFERENCE = 'I like frosted glass UI, with a panel on top of it.';

const ASKS = [
  'Show me a card summarizing my week: 12 unread mails, 3 meetings, and the Lantern river motion is 80% done.',
  'Show my three projects as cards: Lantern river, Lantern short, and Wedyan promo A.',
  'Show a summary of today: 2 meetings, 5 new photos, 1 render finished.',
];

type Node = { role?: string; props?: Record<string, unknown>; children?: Node[] } | string;

describe.skipIf(!KEY)('June keeps the user’s look, live', () => {
  const agents = createAgents();
  const adapter = new AIAdapter().use(
    new OpenAIDriver({
      name: 'meta',
      baseUrl: 'https://api.meta.ai/v1',
      apiKey: KEY,
      models: [DEFAULT_MODELS.agents.model],
      api: 'responses',
    }),
  );
  const logs: Log[] = [];
  logger.use({ name: 'june-live', emit: (log) => void logs.push(log) });

  for (const ask of ASKS) {
    it(`draws a glass widget for: ${ask}`, { timeout: 120_000 }, async () => {
      logs.length = 0;
      const state = mutable<AskState>({ status: 'idle', agent: '', turn: 0, parts: [] });

      await withContext(() =>
        runAgentLoop({
          adapter,
          agents,
          entry: 'wendy',
          composer: COMPOSER,
          persona: personaPrompt({ userName: 'Nanang', refinements: [PREFERENCE] }),
          input: ask,
          state,
          // Nothing about the user is on file: only the profile carries the preference.
          resolve: async (call) => (call.name === 'memory.recall' ? [] : { error: 'not available' }),
        }),
      );

      const widgets = state.parts.filter((part): part is WidgetPart => part.type === 'widget');
      const described = logs
        .filter((log) => log.level === LogLevel.DEBUG && log.message === 'widget composed')
        .map((log) => (log.extra?.[0] as { request: unknown } | undefined)?.request);
      const roots = widgets.flatMap((widget) => widget.nodes as Node[]);
      process.stdout.write(
        `\n=== ${ask}\nstatus: ${state.status}\ndescribed: ${JSON.stringify(described)}\ndrawn: ${JSON.stringify(roots)}\n` +
          `variants: ${JSON.stringify(variantsOf(roots))}\n`,
      );

      expect(state.status).toBe('done');
      expect(widgets.length, 'Wendy showed no widget').toBeGreaterThan(0);
      expect(widgets.every((widget) => widget.status === 'ready')).toBe(true);
      for (const root of roots) {
        if (typeof root === 'string') continue;
        expect(root.props?.variant, `${root.role} carries the glass variant`).toBe('glass');
      }
    });
  }
});

/** Every variant in the drawn nodes, by role, in tree order: where the look landed, if anywhere. */
function variantsOf(nodes: Node[]): string[] {
  return nodes.flatMap((node) =>
    typeof node === 'string'
      ? []
      : [...(node.props?.variant ? [`${node.role}: ${node.props.variant}`] : []), ...variantsOf(node.children ?? [])],
  );
}
