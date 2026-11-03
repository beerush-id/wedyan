import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, effect, mutable, Snippet } from '@airlib/react';
import { Button, Toggle, Tooltip } from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowSidebar,
  WindowSidebarLabel,
  WindowSidebarPanel,
  WindowTitle,
} from '@airlib/react-aui/desktop';
import type { ReactNode } from 'react';
import { attachFacts } from '@/lib/systems/public.js';
import manifest from '../manifest.json';
import { AccountPage } from './Account.js';
import { GeneralPage } from './General.js';
import { AccountIcon, GeneralIcon, SidebarCloseIcon, SidebarOpenIcon } from './icons.js';
import { anchorOf } from './parts.js';
import { bindSettings, goTo, place, type SettingsPlace, type SettingsSection, settingsCtx } from './profile.js';

/** What a Settings window can be opened with: the page to show, and a group on it to bring into view. */
export type SettingsData = SettingsPlace | undefined;

/** The pages down the side, by section, with their names. */
const SECTION_LABELS: Record<SettingsSection, string> = {
  general: 'General',
  account: 'Account',
};

const CLASS = {
  COLUMN: 'wedyan-settings-column',
};

/**
 * Settings: one window, its pages down the side — General, the assistant: its name, voice, how it
 * works with the user, and idle; Account, the user: their name and who they're signed in as — and
 * the chosen page beside them. Every control changes `~/settings.json` or `~/profile.json` as it's
 * used, and the file saves itself; there is nothing to save.
 */
export const settings = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: { width: 760, height: 560 },
  window: { snap: '.aui-window', minWidth: 520, minHeight: 360 },
}).render((props) => {
  // A window opened at a place shows it first.
  const opened = props.instance.data as SettingsData;
  if (opened) goTo(opened);
  attachFacts(props.instance, () => ({ section: place.section }));

  const files = bindSettings();
  settingsCtx.set(files);

  const view = mutable({ sidebarHidden: false });
  let page: HTMLElement | null = null;

  // Brings the group Settings was asked to show into view, once its page is drawn, then lets it go.
  const reveal = () => {
    const group = place.focus && page?.querySelector(`#${anchorOf(place.focus)}`);
    if (!group) return;
    group.scrollIntoView({ block: 'start', behavior: 'smooth' });
    place.focus = undefined;
  };

  // The page is drawn with the window, so a window opened at a group shows it as it appears.
  const holdPage = (element: HTMLElement | null) => {
    page = element;
    reveal();
  };

  // Asked to show a group while open: after the page it's on is drawn.
  effect(() => {
    if (!place.focus || !files.ready) return;
    const frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  });

  /** One page down the side. */
  const section = (value: SettingsSection, icon: ReactNode) => (
    <Button
      key={value}
      variant="text"
      size="sm"
      aria-current={$use(() => (place.section === value ? 'true' : undefined))}
      onClick={() => goTo({ section: value })}
    >
      {icon}
      <span>{SECTION_LABELS[value]}</span>
    </Button>
  );

  return () => (
    <Window sidebarResizeLabel="Resize sidebar">
      <Window.Snippet for="title">
        {() => (
          <>
            <Toggle aria-label="Hide sidebar" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(view, 'sidebarHidden')}>
              <Snippet>{() => (view.sidebarHidden ? <SidebarOpenIcon /> : <SidebarCloseIcon />)}</Snippet>
              <Tooltip>Hide sidebar</Tooltip>
            </Toggle>
            <WindowTitle>
              <Snippet>{() => SECTION_LABELS[place.section]}</Snippet>
            </WindowTitle>
          </>
        )}
      </Window.Snippet>
      <Window.Snippet for="sidebar">
        {() =>
          !view.sidebarHidden && (
            <WindowSidebar>
              <WindowSidebarPanel>
                <WindowSidebarLabel>{manifest.label}</WindowSidebarLabel>
                {section('general', <GeneralIcon />)}
                {section('account', <AccountIcon />)}
              </WindowSidebarPanel>
            </WindowSidebar>
          )
        }
      </Window.Snippet>
      <div ref={holdPage} className={CLASS.COLUMN}>
        <Snippet>{() => files.ready && (place.section === 'account' ? <AccountPage /> : <GeneralPage />)}</Snippet>
      </div>
    </Window>
  );
});

/**
 * Opens Settings at a page, and a group on it, or brings the open window there: what
 * `wedyan://settings/idle` does, as `{ section: 'general', focus: 'idle' }`.
 *
 * @param to - The page, and the group to bring into view.
 * @returns The Settings window.
 */
export function openSettings(to: SettingsPlace) {
  goTo(to);
  return settings.open(to, { name: 'settings' });
}
