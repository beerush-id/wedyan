import type { Presence } from '@/lib/kernel/chat.h.js';

/** What counts as the user being at the desktop. */
const INPUT_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];

/** Where presence is told from. */
export type PresenceOptions = {
  /** Where the user's input and the tab's visibility arrive: the document. */
  events: EventTarget;
  /** Whether the tab is hidden. */
  hidden(): boolean;
  /** How long, in ms, without input before the desktop is idle. */
  idleAfter(): number;
  /** Tells the server. Only a change is told. */
  report(presence: Presence): void;
};

/**
 * Tells the server whether this desktop is in use, which is all it needs to know the user is away
 * and back: active when it's opened while shown and on the first input after being idle; idle after
 * a while without input, or when its tab is hidden.
 *
 * @param options - Where it's told from.
 * @returns `open`, to call once the conversation is connected; `heard`, for activity no input event
 *   shows, like the user talking, which counts even in a hidden tab, as hands-free it may well be.
 */
export function trackPresence({ events, hidden, idleAfter, report }: PresenceOptions) {
  let current: Presence | undefined;
  let connected = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tell = (presence: Presence) => {
    if (!connected || presence === current) return;
    current = presence;
    report(presence);
  };

  const inUse = () => {
    clearTimeout(timer);
    timer = setTimeout(() => tell('idle'), idleAfter());
    tell('active');
  };

  const onInput = () => {
    if (!hidden()) inUse();
  };

  const onVisibility = () => {
    if (!hidden()) return;
    clearTimeout(timer);
    tell('idle');
  };

  for (const event of INPUT_EVENTS) events.addEventListener(event, onInput);
  events.addEventListener('visibilitychange', onVisibility);

  return {
    open() {
      connected = true;
      if (hidden()) tell('idle');
      else inUse();
    },
    heard: inUse,
  };
}
