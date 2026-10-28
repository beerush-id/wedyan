import { describe, expect, it } from 'vitest';
import { ask, PROFILE, PROVIDERS, runBeat } from './beat.js';

// Live run of each demo beat on the default models, printing what the model actually did. For the
// expected format as assertions, see quality.live.ts.

const report = (label: string, value: unknown) =>
  process.stdout.write(`\n=== ${label}\n${JSON.stringify(value, null, 2)}\n`);

describe.skipIf(!PROVIDERS.meta.key)('Wedyan beats on Muse Spark, live', () => {
  it('opener: wake briefing', async () => {
    const result = await runBeat(ask('(The user unlocked the screen.)', { event: 'wake', ...PROFILE }));
    report('wake briefing', result);
    expect(result.status).not.toBe('error');
  });

  it('opener: two opens from one reply', async () => {
    const result = await runBeat(
      ask("Open last night's short drama project, and the second mail.", {
        ...PROFILE,
        lastShown: [
          'Short drama v3 render finished',
          'Ana: Notes on the shoot schedule',
          'Rudi: Budget approved for episode 2',
        ],
      }),
    );
    report('open project and second mail', result);
    expect(result.status).not.toBe('error');
  });

  it('consent: delete it', async () => {
    const result = await runBeat(
      ask('Delete it.', { ...PROFILE, activeWindow: { app: 'files', selection: '~/projects/short-drama/script.md' } }),
      { replies: ['Yes, delete it.'] },
    );
    report('delete with consent', result);
    expect(result.status).not.toBe('error');
  });

  it('photos: remove the cat', async () => {
    const result = await runBeat(ask('Remove the cat from my sofa photo.', PROFILE));
    report('photo edit', result);
    expect(result.status).not.toBe('error');
  });

  it('onboarding: a new user', async () => {
    const result = await runBeat(ask('(First visit.)', { event: 'onboarding' }), {
      replies: ['Call me Nanang.', 'Lita is fine.', 'I make short dramas for social media.'],
    });
    report('onboarding', result);
    expect(result.status).not.toBe('error');
  });
});
