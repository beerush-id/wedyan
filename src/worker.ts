import { createApp } from '@airlib/react/ssr';
import { LogLevel } from '@beerush/logger';
import { consoleAdapter } from '@beerush/logger/adapters/console';
import { createWorker as createAIWorker } from '@irpclib/ai-kit/worker';
import { HTTPRouter } from '@irpclib/http/router';
import { envCtx, IRPC_STORE, IRPC_STORE_EVENT, SESSION_STORE, setContext } from '@irpclib/irpc';
import { resolveBinding, resolveCtx } from '@irpclib/irpc/wrangler';
import { fileModule } from '@irpclib/r2-file';
import { fsContext } from '@irpclib/r2-file/context';
import { createWorker as createFileWorker } from '@irpclib/r2-file/worker';
import { WebSocketRouter } from '@irpclib/ws/router';
import { reportChanges } from '@/lib/kernel/workspace.js';
import { logger } from '@/lib/logger.js';
import { contentIndex } from '@/lib/memory/files.js';
import { guardAgentFiles } from '@/lib/server/guard.js';
import { isHomePath, picturePath, pictures } from '@/lib/server/images.js';
import { seedHome } from '@/lib/server/seed.js';
import { currentSession, homeOf, sessionOf } from '@/lib/server/session.js';
import { MODELS, picturesOf, type ServerEnv, setupServer } from '@/lib/server/setup.js';
import { ai } from '@/lib/share/ai.js';
import { IMAGES_PATH } from '@/lib/share/image.js';
import { AI_ENDPOINT, FILES_ENDPOINT, httpTransport, WRPC, wsTransport } from './api.js';
import App from './app.js';
import router from './router.js';

/** Where r2-file delivers a session's files, by their canonical path. */
const FILES_PATH = '/users/';

/** How long a browser keeps a picture it was served, in seconds. */
const IMAGE_BROWSER_TTL = 86400;

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

/** The context key every call's session ID is kept under, for its session's live calls to find each other. */
const SESSION_KEY = 'sessionId';
SESSION_STORE.key(SESSION_KEY);

// Every call runs in its session: its own home, and its session's live calls to reach. Without a
// session r2-file would fall back to a shared home, so such a call is refused. A new home is seeded
// before its first call runs.
const scopeToSession = async () => {
  const session = currentSession();
  if (!session) throw new Error('No session: load the page first');
  setContext(SESSION_KEY, session);
  fsContext.set(homeOf(session));
  await seedHome(session);
};
wsRouter.use(scopeToSession);

// r2-file in this worker: its handlers serve the desktop's file calls and the agents' tool calls
// alike, each with the bindings of the call's own environment.
// Its content index keeps memory in step with the user's files, and every change is reported to the
// session's desktops, which keep what they hold in sync.
const files = createFileWorker({ endpoint: FILES_ENDPOINT }).use(contentIndex()).use(reportChanges());
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
  sessionOf,
  async fetch(request: Request, env?: ServerEnv, signal?: AbortSignal) {
    const url = new URL(request.url);
    if (url.pathname === AI_ENDPOINT) return models.fetch(request, await bindingsOf(env));
    if (request.method === 'GET' && url.pathname.startsWith(IMAGES_PATH)) return serveImage(request, url, env);
    const isFiles =
      url.pathname === FILES_ENDPOINT || (request.method === 'GET' && url.pathname.startsWith(FILES_PATH));
    if (!isFiles) return app.fetch(request, env, signal);

    const bindings = await bindingsOf(env);
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
 * Serves one of the asking session's own pictures through R2 Image. The session comes from the
 * request's cookie, and the home path in the URL becomes that session's storage path, so no other
 * user's file can be named. Every user asks for the same URL, so only their own browser keeps it.
 *
 * @param request - The picture's request: `/images/~/Pictures/cat.png?s=256`.
 * @param url - Its parsed URL.
 * @param env - The bindings the runtime passed, if any.
 * @returns The picture, resized when asked; 403 without a session, 400 for a path outside the home.
 */
async function serveImage(request: Request, url: URL, env?: ServerEnv): Promise<Response> {
  const session = await sessionOf(request);
  if (!session) return new Response('Forbidden', { status: 403 });

  let path: string;
  try {
    path = decodeURIComponent(url.pathname.slice(IMAGES_PATH.length));
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  if (!isHomePath(path)) return new Response('Bad Request', { status: 400 });

  const target = new URL(url);
  target.pathname = picturePath(homeOf(session).homeDir, path);
  // R2 Image, reached only from here: every request scoped to its session above.
  const response = await pictures.fetch(new Request(target, request), picturesOf(await bindingsOf(env)));

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', `private, max-age=${IMAGE_BROWSER_TTL}`);
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
