import { Snippet } from '@airlib/react';
import { BOOT_STAT } from '@/lib/systems/boot.js';

/**
 * What shows while Wedyan boots: the mark drawing its W, stroke by stroke, over the step booting
 * is on. The step is announced as it changes.
 */
export const Splash = () => (
  <div className="wedyan-splash">
    <div className="wedyan-splash-mark" aria-hidden="true">
      <svg viewBox="14 27 72 48">
        <path className="wedyan-splash-stroke" pathLength={1} d="M19.6 32.6 34.8 69.6 50 43.5" />
        <path className="wedyan-splash-stroke wedyan-splash-agent" pathLength={1} d="M50 43.5 65.2 69.6 80.4 32.6" />
      </svg>
    </div>
    <p className="wedyan-splash-status" role="status">
      <Snippet>{() => BOOT_STAT.status}</Snippet>
    </p>
  </div>
);
