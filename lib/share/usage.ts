/** The error code of a call past the day's limit; its `message` is written for the user. */
export const USAGE_LIMIT = 'usage_limit';

/** The error code of a video asked of the server's keys; its `message` is written for the user. */
export const KEY_REQUIRED = 'key_required';

/**
 * Whether a failed call was refused by the day's limits, rather than something going wrong.
 *
 * @param error - What the call failed with.
 * @returns Whether its message is simply what to tell the user.
 */
export function isUsageLimit(error: unknown): error is Error {
  return (error as { code?: string } | undefined)?.code === USAGE_LIMIT;
}
