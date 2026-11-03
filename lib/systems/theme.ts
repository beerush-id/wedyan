import { createContext } from '@airlib/react';

/** Which color scheme the desktop shows: the device's, or one the user picked. */
export type ThemeMode = 'system' | 'light' | 'dark';

/** The user's theme, kept in a cookie so the server draws the page in it from the start. */
export type Theme = { mode: ThemeMode };

/** The cookie the theme is kept in. */
export const THEME_COOKIE = 'theme';

/** The theme the desktop keeps. Set where it's kept; Settings reads it to change it. */
export const themeCtx = createContext<Theme>();
