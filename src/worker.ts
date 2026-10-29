import { createApp } from '@airlib/react/ssr';
import { LogLevel } from '@beerush/logger';
import { consoleAdapter } from '@beerush/logger/adapters/console';
import { HTTPRouter } from '@irpclib/http/router';
import { envCtx, IRPC_STORE, IRPC_STORE_EVENT, SESSION_STORE, setContext } from '@irpclib/irpc';
import { resolveBinding, resolveCtx } from '@irpclib/irpc/wrangler';
import { fileModule } from '@irpclib/r2-file';
import { fsContext } from '@irpclib/r2-file/context';
import { createWorker as createFileWorker } from '@irpclib/r2-file/worker';
import { WebSocketRouter } from '@irpclib/ws/router';
import { logger } from '@/lib/logger.js';
import { contentIndex } from '@/lib/memory/files.js';
import { guardAgentFiles } from '@/lib/server/guard.js';
import { currentSession, homeOf } from '@/lib/server/session.js';
import { type ServerEnv, setupServer } from '@/lib/server/setup.js';
import { httpTransport, wsTransport } from './api.js';
import App from './app.js';
import router from './router.js';

/** Where r2-file's calls arrive: its client's default endpoint, same origin. */
const FILES_ENDPOINT = '/irpc';

/** Where r2-file delivers a session's files, by their canonical path. */
const FILES_PATH = '/users/';

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
// session r2-file would fall back to a shared home, so such a call is refused.
const scopeToSession = () => {
  const session = currentSession();
  if (!session) throw new Error('No session: load the page first');
  setContext(SESSION_KEY, session);
  fsContext.set(homeOf(session));
};
wsRouter.use(scopeToSession);

// r2-file in this worker: its handlers serve the desktop's file calls and the agents' tool calls
// alike, each with the bindings of the call's own environment.
// Its content index keeps memory in step with the user's files.
const files = createFileWorker({ endpoint: FILES_ENDPOINT }).use(contentIndex());
files.router.use(scopeToSession);
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
  async fetch(request: Request, env?: ServerEnv, signal?: AbortSignal) {
    const url = new URL(request.url);
    const isFiles =
      url.pathname === FILES_ENDPOINT || (request.method === 'GET' && url.pathname.startsWith(FILES_PATH));
    if (!isFiles) return app.fetch(request, env, signal);

    const bindings = await bindingsOf(env);
    return files.fetch(request, bindings, resolveCtx());
  },
};

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
