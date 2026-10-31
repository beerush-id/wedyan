import { createContext } from '@airlib/react';
import type { CalendarPeriod } from './dates.js';
import type { CalendarEvent, ListingRequest } from './library.js';

/**
 * What a Calendar window shows and how: the place picked down the side, the day the period is
 * around, the period, the event picked, the search, and what's hidden.
 */
export type CalendarState = {
  place: ListingRequest;
  /** The day the shown month or week is around, as a day key. */
  anchor: string;
  period: CalendarPeriod;
  /** The picked event's path. */
  picked: string | null;
  query: string;
  sidebarHidden: boolean;
  previewShown: boolean;
};

/**
 * A Calendar window, as its days and events see it: its state, which they change in place, the
 * events it shows, and how an event opens.
 */
export type CalendarView = {
  state: CalendarState;
  /** The events the picked place and the search leave. */
  shown(): CalendarEvent[];
  /** Opens an event in the preview beside the days, showing the preview if it was off. */
  open(path: string): void;
};

/** The Calendar window around a day or an event, set by the window for everything inside it. */
export const calendarCtx = createContext<CalendarView>();
