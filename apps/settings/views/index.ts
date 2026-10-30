import type { AUIBoot } from '@airlib/react-aui/desktop';
import { openSettings, settings } from './Main.js';

export { openSettings, settings };

/** Settings' entry: launching it opens its one window, or brings it forward when it's open. */
export default (({ open }) => {
  open(settings, { name: 'settings' });
}) satisfies AUIBoot;
