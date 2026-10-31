import type { DockSuggestion } from '@airlib/react-aui/desktop';
import { type Commands, linkTo } from '@/lib/systems/public.js';
import { whenOf } from './dates.js';
import { LibraryIcon } from './icons.js';
import { CALENDARS, EVENTS, ROOT } from './library.js';

/** What Calendar can do, at `system.calendar.name`: nothing `/` offers yet. */
export const COMMANDS: Commands = {
  /** Adds an hour's meeting from a form's title, date, time and location. */
  createEvent: async ({ form, ack, widgetId }) => {
    const uid = crypto.randomUUID();
    const path = `${ROOT}/${uid}.ics`;
    const start = new Date(`${form.date}T${form.time}:00`);
    EVENTS.push({
      uid,
      path,
      summary: form.title,
      start: start.toISOString(),
      end: new Date(start.getTime() + 3_600_000).toISOString(),
      allDay: false,
      location: form.location || undefined,
      attendees: [],
      tags: [CALENDARS[0].tag],
    });
    if (widgetId) await ack?.(widgetId, { ...form, eventId: uid });
    return (
      <p>
        <strong>{form.title}</strong> is on your calendar. <a href={linkTo('calendar', path)}>See it</a>
      </p>
    );
  },
};

/** What a request can mention while Calendar is in front: its events, each by its summary and when it is. */
export const CONTEXTS: DockSuggestion[] = EVENTS.map((event) => ({
  value: event.path,
  label: event.summary,
  hint: whenOf(event),
  icon: <LibraryIcon />,
}));
