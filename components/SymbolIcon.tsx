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
