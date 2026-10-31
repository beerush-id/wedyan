import type { ReactNode } from 'react';

/**
 * An icon drawn as lines, for what the symbols don't draw the way we want. A 1px line on this grid
 * is as heavy as a weight 200 symbol, so the two sit together.
 *
 * @param props.children - Its shapes, on a 24 grid.
 * @returns The icon.
 */
export function LineIcon(props: { children: ReactNode }) {
  return (
    <svg
      className="aui-icon"
      viewBox="0 0 24 24"
      style={{ fill: 'none' }}
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

/**
 * A Material Symbol (Outlined, weight 200) as an icon: its path on the symbols' 960 grid. It takes
 * the control's icon size and ink like any other icon, and says nothing to screen readers: the
 * control's name does.
 *
 * @param props.d - The symbol's path.
 * @returns The icon.
 */
export function SymbolIcon(props: { d: string }) {
  return (
    <svg className="aui-icon" viewBox="0 -960 960 960" aria-hidden="true">
      <path d={props.d} />
    </svg>
  );
}
