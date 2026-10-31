import { kernel } from './package.js';

/** The domain every user's address is at. */
export const MAIL_DOMAIN = 'wedyan.app';

/** Who the user is signed in as. */
export type Account = {
  /** Their address, from their short id: never kept, so it can't go stale or be changed. */
  email: string;
};

/** Who the session is signed in as: only the server knows its short id. */
export const account = kernel.declare<() => Promise<Account>>({
  name: 'account',
});
