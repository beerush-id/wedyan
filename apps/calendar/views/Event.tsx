import { $static, $use, Show, Snippet, setup, template } from '@airlib/react';
import { Button, DescriptionList, EmptyState } from '@airlib/react-aui';
import { Window, WindowTitle } from '@airlib/react-aui/desktop';
import { CheckIcon, CloseIcon } from '@airlib/react-aui/icons';
import { BROWSE_CLASS } from '@/components/WedyanGallery.js';
import { whenOf } from './dates.js';
import { LibraryIcon } from './icons.js';
import {
  type AttendeeResponse,
  type CalendarEvent,
  calendarOf,
  eventAt,
  type InviteResponse,
  respond,
  tintOf,
} from './library.js';

const CLASS = {
  EVENT: 'wedyan-calendar-event',
  CALENDAR: 'wedyan-calendar-of',
  REPLY: 'wedyan-calendar-reply',
  HEADING: 'wedyan-calendar-heading',
};

/** How an attendee answered, in words. */
const ATTENDEE_WORDS: Record<AttendeeResponse, string> = {
  accepted: 'Going',
  declined: 'Not going',
  tentative: 'Maybe',
  'needs-action': 'No reply yet',
};

/** How the user answered an invite, in words. */
const REPLY_WORDS: Record<InviteResponse, string> = {
  'needs-reply': 'Waiting on your reply',
  accepted: 'You accepted',
  declined: 'You declined',
};

/**
 * An event in a window of its own, for as long as it's open: everything about it, and for an
 * invite, the reply. Once the event is deleted, the window says so.
 */
export const EventWindow = setup<{ path: string }>((props) => {
  // A window shows one event for its whole life.
  const path = $static(() => props.path);
  const event = () => eventAt(path);

  return () => (
    <Window>
      <Window.Snippet for="title">
        {() => (
          <WindowTitle>
            <Snippet>{() => event()?.summary ?? ''}</Snippet>
          </WindowTitle>
        )}
      </Window.Snippet>
      <div className={CLASS.EVENT}>
        <Show
          when={event}
          fallback={() => (
            <EmptyState title="Event deleted" description="This event is no longer in your calendar." level={3}>
              <EmptyState.Snippet for="icon">{() => <LibraryIcon />}</EmptyState.Snippet>
            </EmptyState>
          )}
        >
          {(entry) => <EventDetails event={entry} />}
        </Show>
      </div>
    </Window>
  );
}, 'EventWindow');

/**
 * Everything about an event, as its preview and its window show it: its summary and calendar;
 * when, where and who organized it; for an invite, the reply, to accept or decline; who's invited
 * and how they answered; and what it's about.
 */
export const EventDetails = template<{ event: CalendarEvent }>(
  (props) => (
    <>
      <h3 className={BROWSE_CLASS.PREVIEW_NAME}>{props.event.summary}</h3>
      <Show when={() => calendarOf(props.event)}>
        {(calendar) => (
          <p className={CLASS.CALENDAR} style={tintOf(calendar)}>
            {calendar.label}
          </p>
        )}
      </Show>
      <DescriptionList size="sm" items={factsOf(props.event)} />
      <Show when={() => props.event.response}>
        {() => (
          <div className={CLASS.REPLY}>
            <span>
              <Snippet>{() => REPLY_WORDS[props.event.response ?? 'needs-reply']}</Snippet>
            </span>
            <Button size="sm" disabled={$use(() => props.event.response === 'accepted')} onClick={() => respond(props.event, 'accepted')}>
              <CheckIcon />
              <span>Accept</span>
            </Button>
            <Button
              size="sm"
              variant="tonal"
              disabled={$use(() => props.event.response === 'declined')}
              onClick={() => respond(props.event, 'declined')}
            >
              <CloseIcon />
              <span>Decline</span>
            </Button>
          </div>
        )}
      </Show>
      <Show when={() => props.event.attendees.length > 0}>
        {() => (
          <section aria-label="Attendees">
            <h4 className={CLASS.HEADING}>Attendees</h4>
            <DescriptionList
              size="sm"
              items={props.event.attendees.map((attendee) => ({ label: attendee.name, value: ATTENDEE_WORDS[attendee.response] }))}
            />
          </section>
        )}
      </Show>
      <Show when={() => props.event.description}>
        {(description) => <DescriptionList size="sm" layout="stacked" items={[{ label: 'About', value: description }]} />}
      </Show>
    </>
  ),
  'EventDetails'
);

/**
 * The facts of an event, each with its name: when, where, and who organized it, where it has them.
 *
 * @param event - The event.
 * @returns Its facts, in order.
 */
function factsOf(event: CalendarEvent): { label: string; value: string }[] {
  return [
    { label: 'When', value: whenOf(event) },
    ...(event.location ? [{ label: 'Where', value: event.location }] : []),
    ...(event.organizer ? [{ label: 'Organizer', value: event.organizer.name }] : []),
  ];
}
