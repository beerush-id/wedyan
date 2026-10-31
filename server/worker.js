import { Container } from '@cloudflare/containers';
import worker from '../dist/server/worker.js';

/** R2 Image's resizer: a private container, reached only by the worker through its `RESIZER` binding. */
export class ImageResizer extends Container {
  defaultPort = 8080;
  // Asleep between pictures: each size is resized once, then served from storage.
  sleepAfter = '5m';
}

export class AirDurableLink {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') {
      return worker.fetch(req, this.env, req.signal);
    }

    try {
      const resolver = await worker.upgrade(req, this.env);

      // Create a WebSocketPair for Cloudflare Workers
      const [client, server] = Object.values(new WebSocketPair());

      server.accept();
      server.addEventListener('message', async (event) => {
        await resolver(event.data, server);
      });
      server.addEventListener('close', () => {
        resolver.close?.(server);
      });
      server.addEventListener('error', () => {
        resolver.close?.(server);
      });

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    } catch (e) {
      console.error('WebSocket upgrade failed:', e);
      return new Response(e.message, { status: 400 });
    }
  }
}

export default {
  async fetch(req, env) {
    // Every call runs in its user's own Durable Object, so all of a user's live calls share one
    // process and reach each other.
    if (env.DURABLE_LINK && worker.isCall(new URL(req.url))) {
      const user = await worker.userOf(req);
      if (!user) return new Response('No session: load the page first', { status: 401 });
      return env.DURABLE_LINK.get(env.DURABLE_LINK.idFromName(user)).fetch(req);
    }

    // Use the explicit signal since Cloudflare uses request level signal
    // to handle client abort instead of on the readble stream's signal.
    return worker.fetch(req, env, req.signal);
  },
};
