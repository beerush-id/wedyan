import { fsContext } from '@irpclib/r2-file/context';
import { account, MAIL_DOMAIN } from './account.h.js';
import { kernel } from './package.js';

kernel.construct(account, async () => ({ email: `${fsContext.get()?.ownerId}@${MAIL_DOMAIN}` }));
