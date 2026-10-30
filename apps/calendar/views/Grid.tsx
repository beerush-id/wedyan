import { For, Show, setup } from '@airlib/react';
import type { KeyboardEvent } from 'react';
import { calendarCtx } from './context.js';
import { dayLabel, daysOf, eventsOn, inMonth, MONTH_DAY_LIMIT, timeOf, todayKey, WEEKDAYS } from './dates.js';
import { type CalendarEvent, calendarOf, tintOf } from './library.js';

const CLASS = {
  DAYS: 'wedyan-calendar-days',
  WEEKDAYS: 'wedyan-calendar-weekdays',
  CELLS: 'wedyan-calendar-cells',
  DAY: 'wedyan-calendar-day',
  HEAD: 'wedyan-calendar-day-head',
  DATE: 'wedyan-calendar-date',
  MORE: 'wedyan-calendar-more',
  CHIP: 'wedyan-calendar-chip',
  TIME: 'wedyan-calendar-chip-time',
  SUMMARY: 'wedyan-calendar-chip-summary',
};

/**
 * The calendar's days, under the weekdays' names: the whole weeks of a month, or one week, each day
 * with its events and today marked. Picking an event shows it in the preview; a double click, or
 * Enter on the picked one, opens it in a window of its own. What shows and how comes from the
 * Calendar window around it.
 */
export const CalendarGrid = setup(() => {
  const calendar = calendarCtx.get();
  const days = () => daysOf(calendar.state.anchor, calendar.state.period);

  return () => (
    <section className={CLASS.DAYS} aria-label="Days" data-period={calendar.state.period}>
      <div className={CLASS.WEEKDAYS} aria-hidden="true">
        {WEEKDAYS.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <div className={CLASS.CELLS}>
        <For each={days}>{(day) => <CalendarDay day={day} />}</For>
      </div>
    </section>
  );
}, 'CalendarGrid');

/**
 * One day: its date, and its events in the order they start. A month shows a few and counts the
 * rest, which its week shows; a week shows them all.
 */
const CalendarDay = setup<{ day: string }>((props) => {
  const calendar = calendarCtx.get();
  const events = () => eventsOn(calendar.shown(), props.day);
  const limit = () => (calendar.state.period === 'month' ? MONTH_DAY_LIMIT : Number.POSITIVE_INFINITY);
  const visible = () => events().slice(0, limit());
  const hidden = () => events().length - visible().length;
  // Days before and after the month shown read apart from it.
  const outside = () => calendar.state.period === 'month' && !inMonth(props.day, calendar.state.anchor);

  // The day's week, where every event of the day fits.
  const showWeek = () => {
    calendar.state.period = 'week';
    calendar.state.anchor = props.day;
  };

  return () => (
    <div
      className={CLASS.DAY}
      role="group"
      aria-label={dayLabel(props.day)}
      data-today={props.day === todayKey() || undefined}
      data-outside={outside() || undefined}
    >
      <div className={CLASS.HEAD}>
        <span className={CLASS.DATE}>{Number(props.day.slice(8))}</span>
        <Show when={hidden}>
          {(count) => (
            <button type="button" className={CLASS.MORE} aria-label={`Show the week, with ${count} more`} onClick={showWeek}>
              {count} more
            </button>
          )}
        </Show>
      </div>
      <For each={visible}>{(event) => <EventChip event={event} />}</For>
    </div>
  );
}, 'CalendarDay');

/**
 * An event as its line in a day: when it starts, unless it lasts all day, and its summary, in its
 * calendar's tint. An invite still waiting on a reply, and one declined, read apart.
 */
const EventChip = setup<{ event: CalendarEvent }>((props) => {
  const calendar = calendarCtx.get();
  const picked = () => calendar.state.picked === props.event.path;
  const pick = () => {
    calendar.state.picked = props.event.path;
  };
  const open = () => calendar.open(props.event.path);

  // Enter on the picked event opens it, as in every Wedyan gallery; on any other, it picks it.
  const press = (key: KeyboardEvent) => {
    if (key.key !== 'Enter' || !picked()) return;
    key.preventDefault();
    open();
  };

  return () => (
    <button
      type="button"
      className={CLASS.CHIP}
      style={tintOf(calendarOf(props.event))}
      data-all-day={props.event.allDay || undefined}
      data-response={props.event.response}
      aria-current={picked() ? 'true' : undefined}
      onClick={pick}
      onDoubleClick={open}
      onKeyDown={press}
    >
      <Show when={() => !props.event.allDay}>{() => <span className={CLASS.TIME}>{timeOf(props.event)}</span>}</Show>
      <span className={CLASS.SUMMARY}>{props.event.summary}</span>
    </button>
  );
}, 'EventChip');
