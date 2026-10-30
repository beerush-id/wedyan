import { exists, list, search, write } from '@irpclib/r2-file';
import { describe, expect, it } from 'vitest';

// How long a page waits for the drive on a deployment, from where this runs. Nothing to measure
// against a local server, so it runs only when `WEDYAN_ORIGIN` names one.

/** How many times each call is timed. */
const RUNS = 12;

describe.runIf(process.env.WEDYAN_ORIGIN)('the drive’s latency, deployed', () => {
  it('times listing against the calls around it', { timeout: 120_000 }, async () => {
    const folder = `~/Latency/${crypto.randomUUID()}`;
    for (let index = 0; index < 20; index++) await write(`${folder}/file ${index}.md`, 'text');

    const report = ['\n=== the drive, deployed', `${RUNS} runs each, ms: first / fastest / median / slowest`];
    const timed = async (name: string, call: () => Promise<unknown>) => {
      const times: number[] = [];
      for (let run = 0; run < RUNS; run++) {
        const started = performance.now();
        await call();
        times.push(Math.round(performance.now() - started));
      }
      const sorted = [...times].sort((one, other) => one - other);
      report.push(
        `${name}: ${times[0]} / ${sorted[0]} / ${sorted[Math.floor(RUNS / 2)]} / ${sorted[RUNS - 1]}`,
      );
    };

    // The floor: a static file the edge answers, then a call the worker refuses before any object.
    await timed('a static file, the edge alone', () => fetch('/icons/photos.svg').then((reply) => reply.text()));
    await timed('a call refused, the worker alone', () =>
      fetch('/wrpc-files', { method: 'POST', credentials: 'omit' }).then((reply) => reply.text()),
    );
    // The worker alone, no Durable Object: the session, then R2 finding nothing.
    await timed('a missing file, on the worker', () => fetch(`${folder}/none.png`));
    await timed('exists, in the session’s object', () => exists(`${folder}/file 1.md`));
    await timed('list, 20 files', () => list(folder));
    await timed('list, the seeded home', () => list('~/'));
    await timed('search by name', () => search({ name: 'file' } as never));

    process.stdout.write(`${report.join('\n')}\n`);
    expect((await list(folder)).entries).toHaveLength(20);
  });
});
