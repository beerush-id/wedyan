import type { AIDriver } from '@irpclib/ai-kit/worker';
import { HandlerError } from '@irpclib/irpc';
import { fsContext } from '@irpclib/r2-file/context';
import { KEY_REQUIRED, USAGE_LIMIT } from '@/lib/share/usage.js';

/** What a model call spends: an agent's turn, a generated picture or sound, or speech. */
export type UsageKind = 'chat' | 'media' | 'speech';

/** How many calls of a kind a day allows: for one visitor, and for everyone together. */
export type UsageLimit = { visitor: number; everyone: number };

/**
 * What a day allows. A message takes several chat calls (routing, the agent's turns, its widgets).
 * The visitor's limit keeps anyone's use fair; a new cookie is a new visitor, so only the limit for
 * everyone bounds what a day can cost.
 */
export const USAGE_LIMITS: Record<UsageKind, UsageLimit> = {
  chat: { visitor: 200, everyone: 5000 },
  media: { visitor: 20, everyone: 500 },
  speech: { visitor: 200, everyone: 5000 },
};

/** What a visitor is told at their own limit. */
export const VISITOR_LIMIT = 'You’ve reached today’s limit for this. It resets tomorrow.';

/** What a visitor is told when everyone's use has reached the day's limit. */
export const EVERYONE_LIMIT = 'Wedyan has reached today’s limit for everyone. It resets tomorrow.';

/** Why a video can't be made: the server's keys don't pay for it. */
export const VIDEO_NEEDS_KEY = 'Generating video needs your own key.';

/** The row counting everyone together, which no session id can be. */
const EVERYONE = '*';

const CREATE = `CREATE TABLE IF NOT EXISTS wedyan_usage (
  scope TEXT NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL,
  PRIMARY KEY (scope, kind, day)
)`;

const COUNT = `INSERT INTO wedyan_usage (scope, kind, day, used) VALUES (?, ?, ?, 1)
  ON CONFLICT (scope, kind, day) DO UPDATE SET used = used + 1 RETURNING used`;

/** The part of a D1 binding counting uses. */
export type UsageDatabase = {
  prepare(query: string): { run(): Promise<unknown>; bind(...values: string[]): unknown };
  batch<T>(statements: unknown[]): Promise<{ results: T[] }[]>;
};

/** Where use is counted, and what's allowed; unset, nothing is counted or limited. */
let counting: { db: UsageDatabase; limits: Record<UsageKind, UsageLimit>; ready?: Promise<unknown> } | undefined;

/**
 * Starts counting model calls. Left unset where nothing is paid for by visitors: development and tests.
 *
 * @param db - The database counts are kept in.
 * @param limits - What a day allows.
 */
export function setupUsage(db: UsageDatabase, limits: Record<UsageKind, UsageLimit> = USAGE_LIMITS): void {
  counting = { db, limits };
}

/**
 * Counts one model call against the calling visitor and against everyone, by the UTC day, and
 * refuses it past either limit. Counted first, so calls made at once can't all slip through.
 *
 * @param kind - What the call spends.
 * @throws With a message for the visitor when the day's limit is reached.
 */
export async function spend(kind: UsageKind): Promise<void> {
  if (!counting) return;
  const { db, limits } = counting;
  counting.ready ??= db.prepare(CREATE).run();
  await counting.ready;

  const day = new Date().toISOString().slice(0, 10);
  const visitor = fsContext.get()?.ownerId;
  const scopes = visitor ? [EVERYONE, visitor] : [EVERYONE];
  const counts = await db.batch<{ used: number }>(scopes.map((scope) => db.prepare(COUNT).bind(scope, kind, day)));
  const [everyone, own] = counts.map(({ results }) => results[0]?.used ?? 0);

  if (own !== undefined && own > limits[kind].visitor) throw new HandlerError(USAGE_LIMIT, VISITOR_LIMIT);
  if (everyone > limits[kind].everyone) throw new HandlerError(USAGE_LIMIT, EVERYONE_LIMIT);
}

/**
 * Holds every model call to the day's limits. Added first to the adapter, before the providers: what
 * it refuses never reaches them. Without limits set it lets everything through, video included.
 */
export class UsageDriver implements AIDriver {
  readonly name = 'usage';

  /** Counts a chat call. */
  ask(): Promise<void> {
    return spend('chat');
  }

  /** Counts a generated picture. */
  draw(): Promise<void> {
    return spend('media');
  }

  /** Counts generated audio. */
  compose(): Promise<void> {
    return spend('media');
  }

  /** Counts an upscale. */
  upscale(): Promise<void> {
    return spend('media');
  }

  /** Counts speech. */
  speak(): Promise<void> {
    return spend('speech');
  }

  /** Counts a transcription. */
  transcribe(): Promise<void> {
    return spend('speech');
  }

  /** Refuses video on the server's keys. */
  film(): void {
    if (counting) throw new HandlerError(KEY_REQUIRED, VIDEO_NEEDS_KEY);
  }
}
