import { $bind, $static, $use, cookies, onMount, page, Show, setup } from '@airlib/react';
import { ToastHost } from '@airlib/react-aui';
import { Desktop, DesktopClock, DesktopWidgets, Dock, DockWidgets, WindowHost } from '@airlib/react-aui/desktop';
import type { ReactNode } from 'react';
import lightWallpaper from '@/assets/wedyan-dark.jpg?asset' with { sizes: '1920' };
import darkWallpaper from '@/assets/wedyan-light.jpg?asset' with { sizes: '1920' };
import { AnswerActions, TurnActions } from '@/components/AnswerActions.js';
import { ConfirmHost } from '@/components/ConfirmHost.js';
import { Splash } from '@/components/Splash.js';
import { openSession, sessionCtx } from '@/lib/assistant/session.js';
import { BOOT_STAT } from '@/lib/systems/boot.js';
import { focusPrompt, PROMPT_LABEL } from '@/lib/systems/focus.js';
import { promptSuggestions } from '@/lib/systems/prompt.js';
import { isAppLink } from '@/lib/systems/registry.js';
import { THEME_COOKIE, type Theme, themeCtx } from '@/lib/systems/theme.js';
import rootRoute from './route.js';

/**
 * The whole app is the desktop: windows, the dock with its launcher and prompt, the answers above
 * it, and notifications. The splash stands in until the system has booted.
 */
export default page(rootRoute).render(({ children }) => (
  <Show when={() => BOOT_STAT.ready} fallback={() => <Splash />}>
    {() => <WedyanDesktop>{children}</WedyanDesktop>}
  </Show>
));

/** The prompt's shortcut as this keyboard writes it: Cmd on Apple's, Ctrl on the rest. */
const SHORTCUT = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌘K' : 'Ctrl K';

/**
 * The desktop once booted; apps join through the system's installed apps. The prompt takes focus
 * as the desktop appears, so typing goes straight to Wedyan, and Cmd/Ctrl+K brings it back from
 * anywhere.
 */
const WedyanDesktop = setup<{ children?: ReactNode }>((props) => {
  // Opened once: what it reads while opening is the conversation's, not this component's to follow.
  const session = $static(openSession);
  sessionCtx.set(session);
  const theme = cookies<Theme>(THEME_COOKIE, { mode: 'dark' });
  themeCtx.set(theme);

  onMount(() => {
    focusPrompt();

    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      focusPrompt();
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  });

  return () => (
  <Desktop
    className="wedyan-desktop"
    wallpaper={{ light: lightWallpaper.src, dark: darkWallpaper.src }}
    data-theme={$use(theme, 'mode')}
  >
    <DesktopWidgets label="Widgets">
      <DesktopClock title="Today" />
    </DesktopWidgets>
    <WindowHost
      closeLabel="Close"
      minimizeLabel="Minimize"
      maximizeLabel="Maximize"
      restoreLabel="Restore"
      layouts={{
        label: 'Layouts',
        move: 'Move & Resize',
        arrange: 'Fill & Arrange',
        left: 'Fill left half',
        right: 'Fill right half',
        vertical: 'Side by side with the window behind',
        top: 'Fill top half',
        bottom: 'Fill bottom half',
        horizontal: 'Stacked with the window behind',
        fill: 'Fill the desktop',
        quarters: 'Tile in four with the windows behind',
      }}
    />
    <Dock
      label="Dock"
      startLabel="Apps"
      startImage="/logo.svg"
      promptLabel={PROMPT_LABEL}
      placeholder="Ask anything"
      shortcut={SHORTCUT}
      answersLabel="Show chat"
      answers={$bind(session.answers, 'open')}
      voiceLabel="Voice input"
      submitLabel="Send"
      busyLabel="Thinking"
      stopLabel="Stop"
      speakingLabel="Wedyan is speaking"
      suggestions={promptSuggestions}
      suggestionsLabel="Suggestions"
      value={$bind(session.prompt, 'text')}
      listening={$bind(session.speech, 'listening')}
      busy={$use(() => session.state.pressing > 0)}
      speaking={$use(() => session.speech.speaking)}
      onsubmit={session.ask}
      onstop={session.stop}
    />
    <DockWidgets
      label="Answers"
      widgets={session.widgets}
      waiting={$use(() => session.waiting)}
      open={$bind(session.answers, 'open')}
      onaction={session.run}
      onlink={session.link}
      allowsLink={isAppLink}
      ondismiss={session.dismiss}
    >
      <DockWidgets.Snippet for="footer">{(widget) => <AnswerActions widget={widget} />}</DockWidgets.Snippet>
      <DockWidgets.Snippet for="after">{(widget) => <TurnActions widget={widget} />}</DockWidgets.Snippet>
    </DockWidgets>
    <ToastHost closeLabel="Dismiss" />
    <ConfirmHost />
    {props.children}
  </Desktop>
  );
}, 'WedyanDesktop');
