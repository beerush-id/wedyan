import { execFileSync, spawn } from 'node:child_process';
import { openSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The UI tests talk to Wedyan as a page does: to the built server, over the wire. It's built and
// started once for the run, on a port of its own, with the picture resizer beside it, and both are
// stopped after.

/** The port the test server listens on, apart from the dev server's and a running one's. */
export const PORT = 3210;

/** A deployed Wedyan to run the tests against, as a page there would, instead of a local server. */
const DEPLOYED = process.env.WEDYAN_ORIGIN;

/** The test page's origin: the server's, so the client's own endpoints and cookies reach it. */
export const ORIGIN = DEPLOYED ?? `http://localhost:${PORT}`;

/** How long the server and the resizer get to start answering. */
const START_TIMEOUT = 30_000;

/** R2 Image's resizer, as built locally: the port inside its container. */
const RESIZER_IMAGE = 'r2-image:latest';
const RESIZER_CONTAINER_PORT = 8080;

/** The resizer container the tests start, by name, so it's stopped after. */
const RESIZER_CONTAINER = 'wedyan-test-resizer';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Where the server's output goes, to read when a test fails on the server's side. */
const LOG = `${ROOT}dist/test-server.log`;

/**
 * Builds Wedyan, starts the resizer and the Deno server, as `globalSetup` of the UI tests.
 *
 * @returns What stops them once the run ends.
 */
export default async function startServer(): Promise<() => void> {
  if (DEPLOYED) return () => undefined;

  execFileSync('bun', ['run', 'build'], { cwd: ROOT, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  const stopResizer = await startResizer();

  // The test runner's NODE_ENV is its own, not the server's.
  const { NODE_ENV: _, ...env } = process.env;
  const log = openSync(LOG, 'w');
  const server = spawn('deno', ['run', '-A', 'server/deno.js'], {
    cwd: ROOT,
    env: { ...env, PORT: String(PORT) },
    // Its own process group, so stopping it stops what it started too (wrangler's workerd).
    detached: true,
    stdio: ['ignore', log, log],
  });
  let exited: number | null = null;
  server.once('exit', (code) => {
    exited = code ?? -1;
  });

  await answering(ORIGIN, () => (exited === null ? undefined : `The test server exited with ${exited}: see ${LOG}`));
  return () => {
    process.kill(-(server.pid as number), 'SIGTERM');
    stopResizer();
  };
}

/**
 * Starts R2 Image's resizer on the port the server's `RESIZER_URL` names; one already answering there
 * is used as it is and left running.
 */
async function startResizer(): Promise<() => void> {
  const vars = (JSON.parse(readFileSync(`${ROOT}wrangler.json`, 'utf8')) as { vars: { RESIZER_URL: string } }).vars;
  const resizer = new URL(vars.RESIZER_URL);
  const health = new URL('/health', resizer).href;
  if (await answers(health)) return () => undefined;

  // Without Docker there's no resizer: everything else still runs, and only the picture tests fail.
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
  } catch {
    process.stderr.write(
      `No resizer: Docker isn't running, so ${RESIZER_IMAGE} can't start; picture tests will fail.\n`,
    );
    return () => undefined;
  }

  execFileSync('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    RESIZER_CONTAINER,
    '--publish',
    `${resizer.port}:${RESIZER_CONTAINER_PORT}`,
    RESIZER_IMAGE,
  ]);
  await answering(health, () => undefined);
  return () => execFileSync('docker', ['stop', RESIZER_CONTAINER]);
}

/** Waits until `url` answers, failing when `failure` reports one or it takes too long. */
async function answering(url: string, failure: () => string | undefined): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT) {
    const failed = failure();
    if (failed) throw new Error(failed);
    if (await answers(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${url} didn't answer in ${START_TIMEOUT} ms: see ${LOG}`);
}

/** Whether `url` answers at all. */
async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}
