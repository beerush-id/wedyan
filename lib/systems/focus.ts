/** Names the prompt; also how anything on the desktop finds it to focus. */
export const PROMPT_LABEL = 'Ask Wedyan';

/**
 * Puts the caret in the prompt, where what's asked of Wedyan is typed. It stands apart from the
 * prompt's suggestions, which load the apps, so the apps can call it too.
 */
export function focusPrompt(): void {
  document.querySelector<HTMLElement>(`[role="textbox"][aria-label="${PROMPT_LABEL}"]`)?.focus({ preventScroll: true });
}
