import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $static, $use, mutable, onCleanup, Show, Snippet, setup } from '@airlib/react';
import { Button, Toggle, Tooltip } from '@airlib/react-aui';
import type { DockWidgetEntry } from '@airlib/react-aui/desktop';
import { CheckIcon, StopIcon, VolumeUpIcon } from '@airlib/react-aui/icons';
import { type Session, sessionCtx } from '@/lib/assistant/session.js';
import type { UserTurn } from '@/lib/assistant/turns.js';
import { CopyIcon, PinIcon, RetryIcon } from './icons.js';

/** How long something copied says so. */
const COPIED = 1500;
/** How often a time is read again. */
const TICK = 30_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ago = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' });

/**
 * What can be done with an answer, and when it came: copy it, pin it, hear it. Only the agent's
 * answers have it, so anything else in the stack draws nothing here.
 */
export const AnswerActions = setup<{ widget: DockWidgetEntry }>((props) => {
  const session = sessionCtx.get() as Session;
  const answer = $static(() => props.widget);
  const state = mutable({ pinned: false, speaking: false });

  // Only its words: a widget's data isn't something to read out or paste.
  const words = () =>
    (answer.children ?? [])
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .filter(Boolean)
      .join('\n\n');

  const speak = async () => {
    if (state.speaking) return session.speech.stop();
    state.speaking = true;
    try {
      await session.speech.speak(words());
    } finally {
      state.speaking = false;
    }
  };

  onCleanup(() => {
    if (state.speaking) session.speech.stop();
  });

  return () => (
    <Show when={() => session.timeOf(answer) !== undefined && answer.from !== 'user' && answer.children?.length}>
      {() => (
        <div className="answer-actions">
          <Show when={() => state.pinned}>{() => <span className="answer-ribbon" />}</Show>
          <Show when={words}>{() => <CopyButton text={words} />}</Show>
          <Toggle aria-label="Pin" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(state, 'pinned')}>
            <PinIcon />
            <Tooltip>Pin</Tooltip>
          </Toggle>
          <Show when={words}>
            {() => (
              <Button
                aria-label={$use(() => (state.speaking ? 'Stop' : 'Speak'))}
                size="sm"
                variant="text"
                className={AUI_CLASS.CONTROL_ICON}
                onClick={speak}
              >
                <Snippet>{() => (state.speaking ? <StopIcon /> : <VolumeUpIcon />)}</Snippet>
                <Tooltip>
                  <Snippet>{() => (state.speaking ? 'Stop' : 'Speak')}</Snippet>
                </Tooltip>
              </Button>
            )}
          </Show>
          <TimeSince at={session.timeOf(answer) as number} />
        </div>
      )}
    </Show>
  );
}, 'AnswerActions');

/**
 * What can be done with what the user sent, and when they sent it: copy it, send it again. It sits
 * under the bubble, on the open stack's frame, so anything but the user's turns draws nothing here.
 */
export const TurnActions = setup<{ widget: DockWidgetEntry }>((props) => {
  const session = sessionCtx.get() as Session;
  const turn = $static(() => props.widget) as UserTurn;

  return () =>
    turn.from === 'user' ? (
      <div className="turn-actions">
        <TimeSince at={session.timeOf(turn) as number} />
        <CopyButton text={() => turn.sent.text} />
        <Button
          aria-label="Retry"
          size="sm"
          variant="text"
          className={AUI_CLASS.CONTROL_ICON}
          onClick={() => void session.retry(turn)}
        >
          <RetryIcon />
          <Tooltip>Retry</Tooltip>
        </Button>
      </div>
    ) : null;
}, 'TurnActions');

/** Copies some text, and says so for a moment. */
const CopyButton = setup<{ text: () => string }>((props) => {
  const state = mutable({ copied: false });

  const copy = async () => {
    await navigator.clipboard.writeText(props.text());
    state.copied = true;
    setTimeout(() => void (state.copied = false), COPIED);
  };

  return () => (
    <Button aria-label="Copy" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={copy}>
      <Snippet>{() => (state.copied ? <CheckIcon /> : <CopyIcon />)}</Snippet>
      <Tooltip>
        <Snippet>{() => (state.copied ? 'Copied' : 'Copy')}</Snippet>
      </Tooltip>
    </Button>
  );
}, 'CopyButton');

/** When something happened, kept up to date as time passes. */
const TimeSince = setup<{ at: number }>((props) => {
  const at = $static(() => props.at);
  const clock = mutable({ now: Date.now() });

  const timer = setInterval(() => void (clock.now = Date.now()), TICK);
  onCleanup(() => clearInterval(timer));

  return () => (
    <time className="answer-time" dateTime={new Date(at).toISOString()}>
      <Snippet>{() => timeSince(at, clock.now)}</Snippet>
    </time>
  );
}, 'TimeSince');

/**
 * How long ago something happened.
 *
 * @param at - When it happened, in milliseconds.
 * @param now - The time now, in milliseconds.
 * @returns E.g. `just now`, `3 minutes ago`, `2 hours ago`.
 */
function timeSince(at: number, now: number): string {
  const elapsed = now - at;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return ago.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return ago.format(-Math.floor(elapsed / HOUR), 'hour');
  return ago.format(-Math.floor(elapsed / DAY), 'day');
}
