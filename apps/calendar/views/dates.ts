import type { CalendarEvent } from './library.js';

/** How much of the calendar shows at once: a month of weeks, or one week. */
export type CalendarPeriod = 'month' | 'week';

/** How many days a week holds, and how many events a day shows in a month before the rest are counted. */
export const WEEK_LENGTH = 7;
export const MONTH_DAY_LIMIT = 3;

/** The weekdays' short names, Monday first, as the grid's header reads them. */
export const WEEKDAYS: string[] = Array.from({ length: WEEK_LENGTH }, (_, at) =>
  new Date(2026, 9, 26 + at).toLocaleDateString(undefined, { weekday: 'short' })
);

const WHEN_TIMED = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const WHEN_ALL_DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * Today, as a day key.
 *
 * @returns E.g. `2026-10-30`.
 */
export function todayKey(): string {
  return keyOf(new Date());
}

/**
 * The days a period shows around a day, as day keys, Monday first: the whole weeks a month
 * touches, or the one week the day is in.
 *
 * @param anchor - A day in the period.
 * @param period - A month or a week.
 * @returns The days, in order.
 */
export function daysOf(anchor: string, period: CalendarPeriod): string[] {
  const day = dateOf(anchor);
  if (period === 'week') return run(mondayOf(day), WEEK_LENGTH);

  const first = new Date(day.getFullYear(), day.getMonth(), 1);
  const last = new Date(day.getFullYear(), day.getMonth() + 1, 0);
  const from = mondayOf(first);
  const weeks = Math.ceil((daysBetween(from, last) + 1) / WEEK_LENGTH);
  return run(from, weeks * WEEK_LENGTH);
}

/**
 * A day a period away: the first of the next or last month, or the same weekday a week on or back.
 *
 * @param anchor - The day shown now.
 * @param period - A month or a week.
 * @param by - How many periods on; negative goes back.
 * @returns The day to show.
 */
export function stepped(anchor: string, period: CalendarPeriod, by: number): string {
  const day = dateOf(anchor);
  return keyOf(
    period === 'month'
      ? new Date(day.getFullYear(), day.getMonth() + by, 1)
      : new Date(day.getFullYear(), day.getMonth(), day.getDate() + by * WEEK_LENGTH)
  );
}

/**
 * The month a day is in, by name, as the window's title.
 *
 * @param anchor - The day.
 * @returns E.g. `October 2026`.
 */
export function monthTitle(anchor: string): string {
  return dateOf(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * A day in full, as a screen reader hears a cell.
 *
 * @param day - The day key.
 * @returns E.g. `Friday, October 30`.
 */
export function dayLabel(day: string): string {
  return WHEN_ALL_DAY.format(dateOf(day));
}

/**
 * Whether two day keys fall in the same month, to set the days around a month apart.
 *
 * @param day - The day.
 * @param anchor - A day in the month shown.
 * @returns Whether they share a month.
 */
export function inMonth(day: string, anchor: string): boolean {
  return day.slice(0, 7) === anchor.slice(0, 7);
}

/**
 * Whether an event takes up any of a day.
 *
 * @param event - The event.
 * @param day - The day key.
 * @returns Whether it does.
 */
export function occursOn(event: CalendarEvent, day: string): boolean {
  const from = dateOf(day);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  return startOf(event) < to && endOf(event) > from;
}

/**
 * The events taking up a day, all-day ones first, then by when they start.
 *
 * @param events - The events to look through.
 * @param day - The day key.
 * @returns That day's events.
 */
export function eventsOn(events: CalendarEvent[], day: string): CalendarEvent[] {
  return events
    .filter((event) => occursOn(event, day))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || startOf(a).getTime() - startOf(b).getTime());
}

/**
 * When an event starts, short, as its line in a day shows it.
 *
 * @param event - A timed event.
 * @returns E.g. `3:00 PM`.
 */
export function timeOf(event: CalendarEvent): string {
  return TIME.format(startOf(event));
}

/**
 * When an event is, in full: its days, and its hours unless it lasts all day.
 *
 * @param event - The event.
 * @returns E.g. `Friday, October 30, 3:00 – 4:30 PM`, or `Monday, October 19 – Wednesday, October 21`.
 */
export function whenOf(event: CalendarEvent): string {
  if (!event.allDay) return WHEN_TIMED.formatRange(startOf(event), endOf(event));

  // An all-day event ends the day after its last; it reads as lasting through that last day.
  const end = endOf(event);
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  return `${WHEN_ALL_DAY.formatRange(startOf(event), last)}, all day`;
}

/**
 * When an event starts, as an instant: an all-day one at its first day's midnight, here.
 *
 * @param event - The event.
 * @returns Its start.
 */
function startOf(event: CalendarEvent): Date {
  return event.allDay ? dateOf(event.start) : new Date(event.start);
}

/**
 * When an event ends, as an instant: an all-day one at the midnight after its last day, here.
 *
 * @param event - The event.
 * @returns Its end.
 */
function endOf(event: CalendarEvent): Date {
  return event.allDay ? dateOf(event.end) : new Date(event.end);
}

/**
 * A day key as that day's local midnight; a date-only string would otherwise read as UTC.
 *
 * @param day - E.g. `2026-10-30`.
 * @returns The day's start, here.
 */
function dateOf(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

/**
 * A local date as its day key.
 *
 * @param date - The date.
 * @returns E.g. `2026-10-30`.
 */
function keyOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The Monday starting the week a day is in.
 *
 * @param day - The day.
 * @returns That Monday.
 */
function mondayOf(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % WEEK_LENGTH));
}

/**
 * Whole days from one day to another, steady across daylight saving changes.
 *
 * @param from - The first day.
 * @param to - The last day.
 * @returns How many days apart they are.
 */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Days in a row, from a day on, as day keys.
 *
 * @param from - The first day.
 * @param count - How many.
 * @returns The days.
 */
function run(from: Date, count: number): string[] {
  return Array.from({ length: count }, (_, at) => keyOf(new Date(from.getFullYear(), from.getMonth(), from.getDate() + at)));
}
