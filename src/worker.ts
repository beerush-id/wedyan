import { createApp } from '@airlib/react/ssr';
import { LogLevel } from '@beerush/logger';
import { consoleAdapter } from '@beerush/logger/adapters/console';
import { createWorker as createAIWorker } from '@irpclib/ai-kit/worker';
import { HTTPRouter } from '@irpclib/http/router';
import { envCtx, IRPC_STORE, IRPC_STORE_EVENT, SESSION_STORE, setContext, withContext } from '@irpclib/irpc';
import { resolveBinding, resolveCtx } from '@irpclib/irpc/wrangler';
import { fileModule } from '@irpclib/r2-file';
import { fsContext } from '@irpclib/r2-file/context';
import { createWorker as createFileWorker } from '@irpclib/r2-file/worker';
import { WebSocketRouter } from '@irpclib/ws/router';
import { fileRows } from '@/lib/kernel/rows.js';
import { reportChanges } from '@/lib/kernel/workspace.js';
import { logger } from '@/lib/logger.js';
import { contentIndex } from '@/lib/memory/files.js';
import { admit } from '@/lib/server/access.js';
import { guardAgentFiles } from '@/lib/server/guard.js';
import { isHomePath, pictureAt, picturePath, pictures } from '@/lib/server/images.js';
import { seedHome } from '@/lib/server/seed.js';
import { currentSession, homeOf, shortIdOf, userOf } from '@/lib/server/session.js';
import { MODELS, picturesOf, type ServerEnv, setupServer } from '@/lib/server/setup.js';
import { ai } from '@/lib/share/ai.js';
import { AI_ENDPOINT, FILES_ENDPOINT, httpTransport, WRPC, wsTransport } from './api.js';
import App from './app.js';
import router from './router.js';

/** A home path in a URL: a `src` of `~/…` arrives under whatever page asked for it. */
const HOME_PATH = '/~/';

/** Files r2-file delivers without a token: all of them, since only `serveFile` ever reaches it. */
const DELIVERED_FILES = ['users/**'];

/** The params that ask R2 Image to change a picture; without them a file comes as it's stored. */
const RESIZE_PARAMS = ['s', 'size', 'w', 'width', 'h', 'height', 'f', 'format', 'q', 'quality', 'fit', 'b', 'blur'];

/** How long a browser keeps a resized picture it was served, in seconds. */
const IMAGE_BROWSER_TTL = 86400;

/** Kept by the asking browser, and checked with the server before it's used again. */
const REVALIDATE = 'private, no-cache';

const httpRouter = new HTTPRouter(httpTransport);
const wsRouter = new WebSocketRouter(wsTransport);

// Locally everything down to debug (the agents' tool calls included); in production only errors.
const production = typeof process === 'undefined' || process.env.NODE_ENV === 'production';
logger.use(consoleAdapter({ level: production ? LogLevel.ERROR : LogLevel.DEBUG }));
const log = logger.create({ tags: ['server'] });

// Every IRPC error on the server (routers, handlers, the agents' tools and actions) goes to the
// server's log, with what failed, so production failures can be traced.
IRPC_STORE.subscribe((event) => {
  if (event.type !== IRPC_STORE_EVENT.ERROR) return;
  const error = event.error as Error;
  log.error(error.message, error, ...(event.data ?? []));
});

/** The context key every call's user is kept under, by short id, for their live calls to find each other. */
const SESSION_KEY = 'sessionId';
SESSION_STORE.key(SESSION_KEY);

// Every call runs in its session: its own home, and its session's live calls to reach. Without a
// session r2-file would fall back to a shared home, so such a call is refused. A new home is seeded
// before its first call runs.
const scopeToSession = async () => {
  const session = currentSession();
  if (!session) throw new Error('No session: load the page first');
  const user = await shortIdOf(session);
  setContext(SESSION_KEY, user);
  fsContext.set(homeOf(user));
  await seedHome(user);
};
wsRouter.use(scopeToSession);

// r2-file in this worker: its handlers serve the desktop's file calls and the agents' tool calls
// alike, each with the bindings of the call's own environment.
// Its content index keeps memory in step with the user's files, and every change is reported to the
// session's desktops, which keep what they hold in sync. Listings arrive as rows.
const files = createFileWorker({
  endpoint: FILES_ENDPOINT,
  public: DELIVERED_FILES,
  // A file can change at its path, so nothing keeps it but the asking browser, by its ETag.
  cache: { browserTtl: 0, edgeTtl: 0 },
  // Files are named by id: what they're called is what a search looks through.
  indexableKeys: ['title'],
  extension: fileRows,
})
  .use(contentIndex())
  .use(reportChanges());
files.router.use(scopeToSession);

// ai-kit in this worker: the desktop's own generation, on the models the agents run, so what it
// makes is kept in the user's drive the same way.
const models = createAIWorker(ai, { adapter: MODELS });
models.router.use(scopeToSession);
// Agents never change the user's profile or touch their secrets; only the desktop does.
fileModule.guard(guardAgentFiles);

const app = createApp(router, App, {
  httpRouter,
  wsRouter,
  // Seeds every HTTP call and WebSocket message with the bindings.
  resolveContext: async (_request, _url, env) => [[envCtx.key, await bindingsOf(env as ServerEnv | undefined)]],
});

export default {
  ...app,
  isCall,
  userOf,
  admit: async (request: Request, env?: ServerEnv) => admit(request, (await bindingsOf(env)).WEDYAN_ACCESS_KEY),
  async fetch(request: Request, env?: ServerEnv, signal?: AbortSignal) {
    const bindings = await bindingsOf(env);
    const refused = await admit(request, bindings.WEDYAN_ACCESS_KEY);
    if (refused) return refused;
    const url = new URL(request.url);
    if (url.pathname === AI_ENDPOINT) return models.fetch(request, bindings);
    if (request.method === 'GET' && url.pathname.includes(HOME_PATH)) return serveFile(request, url, env);
    if (url.pathname !== FILES_ENDPOINT) return app.fetch(request, env, signal);

    return files.fetch(request, bindings, resolveCtx());
  },
};

/**
 * Whether a request is an IRPC call. Deployed, these all run in their session's Durable Object, the
 * one process that holds the session's live calls, so a change or a broadcast reaches every one of
 * them. Delivering a picture or a file holds nothing, so that stays on the worker.
 *
 * @param url - The request's URL.
 * @returns Whether it's a call.
 */
function isCall(url: URL): boolean {
  return url.pathname.startsWith(WRPC);
}

/**
 * Serves a file of the asking session's home by its home path, which is all a `src` needs to be:
 * `~/Pictures/cat.png`, resolved by the browser against any page. The session comes from the
 * request's cookie, and the home path becomes that session's storage path, so no other user's file
 * can be named.
 *
 * Asked to resize, R2 Image answers, and a still is the picture it has chosen. Otherwise the file
 * comes as it's stored, whatever it is, from r2-file's delivery, which answers the range requests a
 * video's seeking makes.
 *
 * @param request - The file's request: `/~/Motions/Lantern/take.mp4`, `/~/Pictures/cat.png?s=256`.
 * @param url - Its parsed URL.
 * @param env - The bindings the runtime passed, if any.
 * @returns The file; 403 without a session, 400 for a path outside the home, 404 for a still with
 *   nothing made yet.
 */
async function serveFile(request: Request, url: URL, env?: ServerEnv): Promise<Response> {
  const user = await userOf(request);
  if (!user) return new Response('Forbidden', { status: 403 });

  let path: string;
  try {
    path = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(HOME_PATH) + 1));
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  if (!isHomePath(path)) return new Response('Bad Request', { status: 400 });

  const home = homeOf(user);
  const target = new URL(url);
  target.pathname = picturePath(home.homeDir, path);
  const bindings = await bindingsOf(env);

  // A page asks for its pictures before its first call, which is what seeds a new home.
  await withContext(
    [
      [envCtx.key, bindings],
      [SESSION_KEY, user],
      [fsContext.key, home],
    ],
    () => seedHome(user),
  );

  // R2 Image and r2-file's delivery are reached only from here: scoped to the session above.
  if (RESIZE_PARAMS.some((param) => url.searchParams.has(param))) {
    const picture = await pictureAt(bindings.DB as never, home.homeDir, path);
    if (!picture || !isHomePath(picture)) return new Response('Not Found', { status: 404 });
    target.pathname = picturePath(home.homeDir, picture);
    const resized = await pictures.fetch(new Request(target, request), picturesOf(bindings));
    // Only a picture is kept: what failed is asked again.
    return privately(resized, resized.ok ? `private, max-age=${IMAGE_BROWSER_TTL}` : REVALIDATE);
  }
  return privately(await files.fetch(new Request(target, request), bindings, resolveCtx()), REVALIDATE);
}

/** A response only the asking browser keeps, since every user asks for the same URL. */
function privately(response: Response, cacheControl: string): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', cacheControl);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * The bindings, resolved once per request: emulated or remote in development, the platform's in
 * production. The first request also sets up the kernel and memory with them.
 *
 * @param env - The bindings the runtime passed, if any.
 * @returns The bindings to run with.
 */
async function bindingsOf(env?: ServerEnv): Promise<ServerEnv> {
  const bindings = await resolveBinding<ServerEnv>(env);
  setupServer(bindings);
  return bindings;
}
