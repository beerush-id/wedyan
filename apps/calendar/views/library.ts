import { mutable } from '@airlib/react';
import type { CSSProperties } from 'react';
import LISTING from '../data/events.json';

/** Where Calendar reads from: the Calendar inbox at the drive's root, one `.ics` per event or invite. */
export const ROOT = '/Calendar';

/** A calendar: the tag its events carry, its name, and the tint its events wear. */
export type CalendarInfo = { tag: string; label: string; color: string };

/** The user's calendars, each a tag on the events in it. */
export const CALENDARS: CalendarInfo[] = LISTING.calendars;

/** Someone on an event: who they are, by name and address. */
export type Person = { name: string; email: string };

/** How an attendee answered, as an `.ics` ATTENDEE's PARTSTAT says it. */
export type AttendeeResponse = 'accepted' | 'declined' | 'tentative' | 'needs-action';

/** Someone invited, and how they answered. */
export type Attendee = Person & { response: AttendeeResponse };

/** How the user answered an invite: not yet, yes, or no. */
export type InviteResponse = 'needs-reply' | 'accepted' | 'declined';

/**
 * An event in the Calendar inbox: what its `.ics` VEVENT gives — its uid, summary, when, where,
 * who organized it, who's invited and how they answered, and what it's about — and what Calendar
 * keeps: the calendars it's in, as tags, and, for an invite, how the user answered. An all-day
 * event's `start` and `end` are dates, its end the day after its last, as DTEND has it.
 */
export type CalendarEvent = {
  uid: string;
  path: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  /** Who sent it, when someone else did; the user's own events have none. */
  organizer?: Person;
  attendees: Attendee[];
  description?: string;
  tags: string[];
  /** How the user answered, on an invite only. */
  response?: InviteResponse;
};

/** What a listing is asked for: every event, the invites waiting on a reply, or every event in a calendar. */
export type ListingRequest = { view: 'calendar' } | { view: 'invites' } | { tag: string };

/** Every event in the inbox, answered as the user replies. A mock listing, until the drive serves one. */
export const EVENTS: CalendarEvent[] = mutable(LISTING.events as CalendarEvent[]);

/** What changes as Calendar is used, for this session: the events deleted, by path. */
export const library = mutable({ deleted: [] as string[] });

/**
 * Lists the inbox as asked: every event, the invites waiting on a reply, or a calendar's events.
 * A mock of the drive's listing request, answered from the events at hand.
 *
 * @param request - Everything, the invites, or a calendar's tag.
 * @returns The events, in the order they start.
 */
export function listing(request: ListingRequest): CalendarEvent[] {
  const kept = EVENTS.filter((event) => !library.deleted.includes(event.path));
  if ('tag' in request) return kept.filter((event) => event.tags.includes(request.tag));
  return request.view === 'invites' ? kept.filter((event) => event.response === 'needs-reply') : kept;
}

/**
 * The event at a path, while it's still in the inbox.
 *
 * @param path - The event's `.ics` path.
 * @returns The event, or nothing once it's deleted.
 */
export function eventAt(path: string): CalendarEvent | undefined {
  return library.deleted.includes(path) ? undefined : EVENTS.find((event) => event.path === path);
}

/**
 * Answers an invite. UI only: the reply isn't sent anywhere yet.
 *
 * @param event - The invite.
 * @param response - Yes or no.
 */
export function respond(event: CalendarEvent, response: Exclude<InviteResponse, 'needs-reply'>) {
  event.response = response;
}

/**
 * The calendar an event shows in: the first of its tags that is one.
 *
 * @param event - The event.
 * @returns Its calendar, or nothing when it's in none.
 */
export function calendarOf(event: CalendarEvent): CalendarInfo | undefined {
  return CALENDARS.find((calendar) => event.tags.includes(calendar.tag));
}

/**
 * The tint an event or calendar wears, as the style that hands it to Calendar's styles.
 *
 * @param calendar - The calendar, if any.
 * @returns The style carrying its tint.
 */
export function tintOf(calendar: CalendarInfo | undefined): CSSProperties {
  return { '--wedyan-calendar-tint': calendar?.color } as CSSProperties;
}
