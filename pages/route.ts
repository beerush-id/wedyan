import { issueSession } from '@/lib/share/cookie.js';
import router from '@/src/router.js';

/** AirLib managed */
const route = router.route();
/** AirLib managed */

// Every page gets the visitor's session first, so their calls run in their own home.
export const rootRoute = route.guard(issueSession);

export default rootRoute;
