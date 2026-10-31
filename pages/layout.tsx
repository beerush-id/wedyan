import { $bind, $use, onMount, page, Show, setup } from '@airlib/react';
import { ToastHost } from '@airlib/react-aui';
import { Desktop, DesktopClock, DesktopWidgets, Dock, DockWidgets, WindowHost } from '@airlib/react-aui/desktop';
import type { ReactNode } from 'react';
import { AnswerActions, TurnActions } from '@/components/AnswerActions.js';
import { Splash } from '@/components/Splash.js';
import { engine } from '@/lib/assistant/mock.js';
import { BOOT_STAT } from '@/lib/systems/boot.js';
import { focusPrompt, PROMPT_LABEL } from '@/lib/systems/focus.js';
import { promptSuggestions } from '@/lib/systems/prompt.js';
import { isAppLink } from '@/lib/systems/registry.js';
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
  <Desktop className="wedyan-desktop">
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
      voiceLabel="Voice input"
      submitLabel="Send"
      busyLabel="Thinking"
      stopLabel="Stop"
      speakingLabel="Wedyan is speaking"
      suggestions={promptSuggestions}
      suggestionsLabel="Suggestions"
      listening={$bind(engine.state, 'listening')}
      busy={$use(() => engine.state.pressing > 0)}
      speaking={$use(() => engine.state.speaking)}
      onsubmit={engine.submit}
      onstop={engine.stop}
    />
    <DockWidgets
      label="Answers"
      widgets={engine.widgets}
      onaction={engine.run}
      onlink={engine.link}
      allowsLink={isAppLink}
      ondismiss={engine.dismiss}
    >
      <DockWidgets.Snippet for="footer">{(widget) => <AnswerActions widget={widget} />}</DockWidgets.Snippet>
      <DockWidgets.Snippet for="after">{(widget) => <TurnActions widget={widget} />}</DockWidgets.Snippet>
    </DockWidgets>
    <ToastHost closeLabel="Dismiss" />
    {props.children}
  </Desktop>
  );
}, 'WedyanDesktop');
