import { mutable } from '@airlib/react';
import { type AUISystemState, bootstrap } from '@airlib/react-aui/desktop';
import calendarManifest from '@/apps/calendar/manifest.json';
import calendarMain from '@/apps/calendar/views/index.js';
import filesManifest from '@/apps/files/manifest.json';
import filesMain from '@/apps/files/views/index.js';
import loungeManifest from '@/apps/lounge/manifest.json';
import loungeMain from '@/apps/lounge/views/index.js';
import mailManifest from '@/apps/mail/manifest.json';
import previewManifest from '@/apps/preview/manifest.json';
import previewMain from '@/apps/preview/views/index.js';
import mailMain from '@/apps/mail/views/index.js';
import memoManifest from '@/apps/memo/manifest.json';
import memoMain from '@/apps/memo/views/index.js';
import motionsManifest from '@/apps/motions/manifest.json';
import motionsMain from '@/apps/motions/views/index.js';
import photosManifest from '@/apps/photos/manifest.json';
import photosMain from '@/apps/photos/views/index.js';
import settingsManifest from '@/apps/settings/manifest.json';
import settingsMain from '@/apps/settings/views/index.js';

/** Where booting is: the line the splash shows, and whether the desktop can take over. */
export const BOOT_STAT = mutable({ status: 'Boot messages', ready: false });

/** The running system, once booted: what Wedyan's own parts read, e.g. the window in front. */
export let SYSTEM: AUISystemState | undefined;

/**
 * Boots the system: claims it before anything else can, says each step on the splash, installs
 * the apps, and marks it ready so the desktop replaces the splash. Browser only; the server never
 * boots, so it renders the splash and nothing claims the system there.
 *
 * @returns Once the desktop is ready.
 */
export async function boot(): Promise<void> {
  if (import.meta.env.SSR) return;

  const system = bootstrap({ devMode: import.meta.env.DEV, system: { apps: [] } });
  if (!system) {
    BOOT_STAT.status = 'Wedyan could not start';
    throw new Error('The system was claimed before Wedyan booted.');
  }
  SYSTEM = system;

  step('Starting Wedyan');
  step('Installing apps', () => {
    system.system.apps?.push(
      { manifest: filesManifest, main: filesMain },
      { manifest: photosManifest, main: photosMain },
      { manifest: motionsManifest, main: motionsMain },
      { manifest: memoManifest, main: memoMain },
      { manifest: mailManifest, main: mailMain },
      { manifest: calendarManifest, main: calendarMain },
      { manifest: loungeManifest, main: loungeMain },
      { manifest: previewManifest, main: previewMain },
      { manifest: settingsManifest, main: settingsMain }
    );
  });
  step('Preparing your desktop');

  BOOT_STAT.status = 'Ready';
  BOOT_STAT.ready = true;
}

/**
 * One boot step: shows what it's doing on the splash, then does it.
 *
 * @param status - What the splash says during the step.
 * @param work - What the step does, if anything.
 */
function step(status: string, work?: () => void): void {
  BOOT_STAT.status = status;
  work?.();
}
