import { AIAdapter } from '@irpclib/ai-kit/worker';
import { createContextStore, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { beforeAll, describe, expect, it } from 'vitest';
import { DESCRIPTION_TYPES, stillDescribe } from '../../lib/kernel/stills.h.js';
import { picturesOf, type ServerEnv, withModels } from '../../lib/server/setup.js';
import { setupStills } from '../../lib/server/stills.js';
import { PROVIDERS } from './beat.js';

/*
 * `still.describe` as the app calls it: each of `FACES` made a still on Muse Image, then described
 * for every purpose, its chosen image resized by R2 Image's resizer (the local container
 * `RESIZER_URL` names) and read by Spark. What each says, and how long it takes.
 */

/** The faces made into stills, each described for every purpose. */
const FACES = [
  'Portrait of a young lighthouse keeper’s daughter, angry: freckles, windswept dark hair, warm lantern light, facing the camera, flat illustration',
  'Portrait of a weathered fisherman in his fifties, laughing: grey stubble, a scar through his left eyebrow, knit cap, rain on his oilskin coat, three-quarter view, painterly',
  'Portrait of an elderly woman with silver hair in a loose bun, quietly sad: round glasses, laugh lines, a green shawl, soft window light, watercolour',
];

let env: ServerEnv;

beforeAll(async () => {
  env = await resolveBinding<ServerEnv>(undefined, { remoteBindings: false });
  implement({ bucket: env.BUCKET as never, indexer: env.DB as never });
});

describe.skipIf(!PROVIDERS.meta.key)('still.describe, live', () => {
  it(`describes ${FACES.length} stills for ${DESCRIPTION_TYPES.join(' and ')}`, { timeout: 600_000 }, async () => {
    const adapter = withModels(new AIAdapter(), { meta: PROVIDERS.meta.key });
    const generate = setupStills(adapter, picturesOf(env));
    const ask = { agent: '~/Agents/Image.agent', desktop: async () => undefined };
    const user = `u-${crypto.randomUUID().slice(0, 8)}`;
    const report = ['\n=== still.describe'];

    await withContext(createContextStore(), async () => {
      fsContext.set({ ownerId: user, homeDir: `/users/${user}` });
      for (const [index, prompt] of FACES.entries()) {
        const path = `~/People/Face ${index + 1}.still`;
        await generate({ path, prompt, aspect: '1:1', batch: 1 }, ask);
        report.push(`\n### ${path}`);
        for (const type of DESCRIPTION_TYPES) {
          const started = Date.now();
          const said = await stillDescribe(path, { type });
          report.push(`--- ${type}, in ${((Date.now() - started) / 1000).toFixed(1)} s`, said);
          expect(said.length).toBeGreaterThan(40);
        }
      }
    });
    process.stdout.write(`${report.join('\n')}\n`);
  });
});
