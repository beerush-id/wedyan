import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Presence } from '../../lib/kernel/chat.h.js';
import { trackPresence } from '../../lib/share/presence.js';

/** How long these desktops go without input before they're idle. */
const IDLE = 5000;

/** A desktop, with what it told the server. */
function setup(startHidden = false) {
  let hidden = startHidden;
  const told: Presence[] = [];
  const events = new EventTarget();
  const presence = trackPresence({
    events,
    hidden: () => hidden,
    idleAfter: () => IDLE,
    report: (state) => void told.push(state),
  });
  return {
    ...presence,
    told,
    input: () => events.dispatchEvent(new Event('keydown')),
    hide: () => {
      hidden = true;
      events.dispatchEvent(new Event('visibilitychange'));
    },
    show: () => {
      hidden = false;
      events.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

describe('presence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is active once opened while shown, and idle when opened hidden', () => {
    const shown = setup();
    shown.open();
    expect(shown.told).toEqual(['active']);

    const hidden = setup(true);
    hidden.open();
    expect(hidden.told).toEqual(['idle']);
  });

  it('tells nothing until the conversation is connected', () => {
    const desktop = setup();

    desktop.input();
    expect(desktop.told).toEqual([]);

    desktop.open();
    expect(desktop.told).toEqual(['active']);
  });

  it('goes idle after a while without input', () => {
    const desktop = setup();
    desktop.open();

    vi.advanceTimersByTime(IDLE - 1);
    expect(desktop.told).toEqual(['active']);

    vi.advanceTimersByTime(1);
    expect(desktop.told).toEqual(['active', 'idle']);
  });

  it('stays active while there’s input, telling the server only once', () => {
    const desktop = setup();
    desktop.open();

    for (let step = 0; step < 5; step++) {
      vi.advanceTimersByTime(IDLE - 1);
      desktop.input();
    }

    expect(desktop.told).toEqual(['active']);
  });

  it('is active again on the first input after being idle', () => {
    const desktop = setup();
    desktop.open();
    vi.advanceTimersByTime(IDLE);

    desktop.input();

    expect(desktop.told).toEqual(['active', 'idle', 'active']);
  });

  it('goes idle when its tab is hidden, and showing it isn’t input', () => {
    const desktop = setup();
    desktop.open();

    desktop.hide();
    expect(desktop.told).toEqual(['active', 'idle']);

    desktop.show();
    expect(desktop.told).toEqual(['active', 'idle']);

    desktop.input();
    expect(desktop.told).toEqual(['active', 'idle', 'active']);
  });

  it('takes no input from a hidden tab', () => {
    const desktop = setup(true);
    desktop.open();

    desktop.input();

    expect(desktop.told).toEqual(['idle']);
  });

  it('counts the user talking as input, even in a hidden tab', () => {
    const desktop = setup();
    desktop.open();
    desktop.hide();

    desktop.heard();
    expect(desktop.told).toEqual(['active', 'idle', 'active']);

    vi.advanceTimersByTime(IDLE - 1);
    desktop.heard();
    vi.advanceTimersByTime(IDLE - 1);
    expect(desktop.told).toEqual(['active', 'idle', 'active']);
  });
});
