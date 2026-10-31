import type { DockSubmitEvent, DockWidgetEntry } from '@airlib/react-aui/desktop';
import type { ReactNode } from 'react';
import { linkTo } from '@/lib/systems/links.js';

/** An answer from the agent, which remembers when it came. */
export type Answer = DockWidgetEntry & { at: number };

/** What the user sent, as a turn: when, and what, to copy or send again. */
export type UserTurn = Answer & { from: 'user'; sent: DockSubmitEvent };

/** What marks a picked item in what was sent, as the prompt marks it. */
const TOKEN_CLASS = 'aui-dock-token';

let count = 0;

/**
 * What the user sent, as a turn of its own: their words, with each thing picked in kept as a token.
 *
 * @param sent - The sent prompt.
 * @returns The entry.
 */
export function userTurn(sent: DockSubmitEvent): UserTurn {
  const { text, selections } = sent;
  const parts: ReactNode[] = [];
  let rest = text;
  for (const { label } of selections) {
    const at = rest.indexOf(label);
    if (at < 1) continue;
    parts.push(
      rest.slice(0, at - 1),
      <span key={parts.length} className={TOKEN_CLASS}>
        {rest.slice(at - 1, at + label.length)}
      </span>
    );
    rest = rest.slice(at + label.length);
  }
  return { id: `turn-${++count}`, from: 'user', at: Date.now(), sent, view: <span>{[...parts, rest]}</span> };
}

/**
 * What a `/` command drew, as an entry of its own. It's not a turn: nothing sends or keeps it.
 *
 * @param view - What it drew.
 * @returns The entry.
 */
export function commandResult(view: ReactNode): DockWidgetEntry {
  return { id: `result-${++count}`, view };
}

/**
 * What `/generate` draws: the image, and where it's kept.
 *
 * @param ask - What it's of.
 * @param path - The still.
 * @param src - The image.
 * @returns What to draw.
 */
export function stillMade(ask: string, path: string, src: string): ReactNode {
  return (
    <>
      <img className="answer-picture" src={src} alt={ask} />
      <p>
        <strong>{ask}</strong> is in Photos. <a href={linkTo('photos', path)}>Open it</a> or{' '}
        <a href={linkTo('preview', path)}>see it large</a>.
      </p>
    </>
  );
}

/**
 * What `/animate` draws: the cover, and where it's kept.
 *
 * @param ask - What it's of.
 * @param path - The motion.
 * @param cover - Its cover.
 * @returns What to draw.
 */
export function motionMade(ask: string, path: string, cover: string): ReactNode {
  return (
    <>
      <img className="answer-picture" src={cover} alt={ask} />
      <p>
        <strong>{ask}</strong> is in Motions as a draft. <a href={linkTo('motions', path)}>Open it</a>.
      </p>
    </>
  );
}
