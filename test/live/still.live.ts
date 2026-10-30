import { writeFileSync } from 'node:fs';
import { AIAdapter, MuseDriver } from '@irpclib/ai-kit/worker';
import { createContextStore, withContext } from '@irpclib/irpc';
import { resolveBinding } from '@irpclib/irpc/wrangler';
import { read } from '@irpclib/r2-file';
import { implement } from '@irpclib/r2-file/constructor';
import { fsContext } from '@irpclib/r2-file/context';
import { beforeAll, describe, expect, it } from 'vitest';
import type { StillDocument } from '../../lib/documents/types.js';
import { DriveDriver } from '../../lib/server/drive-driver.js';
import { setupStills } from '../../lib/server/stills.js';
import { PROVIDERS } from './beat.js';

/*
 * Stills on the real Muse Image, kept in a home on local R2 and D1: a head, then a pose made from
 * it as its reference. Two images, about $0.02. `STILL_OUT` names a folder to copy them into, to
 * look at.
 */

beforeAll(async () => {
  const env = await resolveBinding<{ BUCKET: never; DB: never }>(undefined, { remoteBindings: false });
  implement({ bucket: env.BUCKET, indexer: env.DB });
});

describe.skipIf(!PROVIDERS.meta.key)('stills on Muse Image, live', () => {
  it('makes a head, then a pose from it as its reference', { timeout: 300_000 }, async () => {
    const adapter = new AIAdapter()
      .use(new MuseDriver({ apiKey: PROVIDERS.meta.key, baseUrl: PROVIDERS.meta.base }))
      .use(new DriveDriver());
    const generate = setupStills(adapter);
    const ask = { agent: '~/Agents/Image.agent', desktop: async () => undefined };
    const user = `u-${crypto.randomUUID().slice(0, 8)}`;

    await withContext(createContextStore(), async () => {
      fsContext.set({ ownerId: user, homeDir: `/users/${user}` });

      let started = Date.now();
      const head = await generate(
        {
          path: '~/People/Ayla/Head.still',
          prompt:
            'Portrait of Ayla, a young lighthouse keeper’s daughter: freckles, windswept dark hair, warm lantern light, facing the camera, flat illustration',
          aspect: '1:1',
          batch: 1,
        },
        ask,
      );
      const headMs = Date.now() - started;
      expect(head).not.toHaveProperty('error');

      started = Date.now();
      const pose = await generate(
        {
          path: '~/People/Ayla/Smile.still',
          prompt: 'The same girl, laughing, turned three quarters to the left, same style',
          aspect: '1:1',
          batch: 1,
          references: ['Head.still'],
        },
        ask,
      );
      const poseMs = Date.now() - started;
      expect(pose).not.toHaveProperty('error');

      const report: string[] = [];
      for (const [name, ms] of [
        ['Head', headMs],
        ['Smile', poseMs],
      ] as const) {
        const still = (await read(`~/People/Ayla/${name}.still`, { encoding: 'json' })) as StillDocument;
        expect(still.attempts).toHaveLength(1);
        const image = await read(`~/People/Ayla/${still.attempts[0].src}`, { encoding: 'base64' });
        expect(image?.length ?? 0).toBeGreaterThan(1000);
        report.push(
          `${name}: ${ms} ms, ${still.attempts[0].src}, ${Math.round(((image?.length ?? 0) * 3) / 4 / 1024)} KB`,
        );
        if (process.env.STILL_OUT) {
          writeFileSync(
            `${process.env.STILL_OUT}/${name}.${still.attempts[0].src.split('.').pop()}`,
            Buffer.from(image ?? '', 'base64'),
          );
        }
      }
      process.stdout.write(`\n=== stills\n${report.join('\n')}\n`);
    });
  });
});
