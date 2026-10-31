import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, effect, mutable, Show, Snippet } from '@airlib/react';
import { Button, Divider, EmptyState, Toggle, ToggleGroup, Tooltip } from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowSidebar,
  WindowSidebarLabel,
  WindowSidebarPanel,
  WindowTitle,
} from '@airlib/react-aui/desktop';
import { ArrowLeft, ArrowRight } from '@airlib/react-aui/icons';
import type { ReactNode } from 'react';
import { deleteConfirm } from '@/components/confirm.js';
import { type SelectionAction, SelectionActions } from '@/components/SelectionActions.js';
import { BROWSE_CLASS, WedyanGallerySearch } from '@/components/WedyanGallery.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { type CalendarState, calendarCtx } from './context.js';
import { monthTitle, stepped, todayKey } from './dates.js';
import { EventDetails } from './Event.js';
import { CalendarGrid } from './Grid.js';
import { DeleteIcon, InvitesIcon, LibraryIcon, PreviewIcon, SidebarCloseIcon, SidebarOpenIcon } from './icons.js';
import { CALENDARS, type CalendarEvent, eventAt, library, type ListingRequest, listing, opening, tintOf } from './library.js';

const CLASS = {
  BROWSE: BROWSE_CLASS.ROOT,
  PREVIEW: BROWSE_CLASS.PREVIEW,
  DOT: 'wedyan-calendar-dot',
  COUNT: 'wedyan-calendar-count',
};

/**
 * Calendar: the events and invites in the Calendar inbox, by the day, in one window. Down the side:
 * Calendar itself, the invites waiting on a reply, and each calendar, which narrow what the days
 * show. The days: a month of weeks, or one week, today marked; Today and the arrows move between
 * them. Beside them, a preview of the picked event, off until it's turned on or an event opens, where an invite is
 * accepted or declined. A double click, or Enter on the picked event, opens it there, showing the
 * preview if it was hidden.
 */
export const calendar = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 640, minHeight: 420 },
}).render(() => {
  const view = mutable<CalendarState>({
    place: { view: 'calendar' },
    anchor: todayKey(),
    period: 'month',
    picked: null,
    query: '',
    sidebarHidden: false,
    previewShown: false,
  });

  const shown = (): CalendarEvent[] => {
    const query = view.query.trim().toLowerCase();
    const events = listing(view.place);
    return query ? events.filter((entry) => entry.summary.toLowerCase().includes(query)) : events;
  };
  // The picked event stays in the preview after a reply takes it out of the invites.
  const picked = () => (view.picked ? eventAt(view.picked) : undefined);
  const invites = () => listing({ view: 'invites' }).length;
  const isAt = (request: ListingRequest) => samePlace(view.place, request);

  // An event opens in the preview beside the days, the preview showing if it was off.
  const open = (path: string) => {
    Object.assign(view, { picked: path, previewShown: true });
  };

  calendarCtx.set({ state: view, shown, open });

  // A link's event opens like any other.
  effect(() => {
    if (!opening.path) return;
    open(opening.path);
    opening.path = null;
  });

  /**
   * Shows everything, the invites, or a calendar, with nothing picked and nothing searched, as a
   * new place starts. The days shown stay.
   *
   * @param request - Everything, the invites, or a calendar's tag.
   */
  const go = (request: ListingRequest) => {
    Object.assign(view, { place: request, picked: null, query: '' });
  };

  /**
   * Moves the days a month or a week on or back.
   *
   * @param by - How many; negative goes back.
   */
  const step = (by: number) => {
    view.anchor = stepped(view.anchor, view.period, by);
  };

  // Back to the month or week holding today.
  const today = () => {
    view.anchor = todayKey();
  };

  const stepLabel = (by: number) => `${by < 0 ? 'Previous' : 'Next'} ${view.period}`;

  // Takes the picked event out of the calendar for this session.
  const remove = () => {
    const path = view.picked;
    view.picked = null;
    if (path) library.deleted.push(path);
  };

  /** The actions for the picked event: removing it. */
  const selection = (): SelectionAction[][] => [
    [{ label: 'Delete', icon: <DeleteIcon />, run: remove, confirm: deleteConfirm(1, 'event', 'events', 'your calendar') }],
  ];

  /** One place down the side: Calendar itself, the invites, or a calendar. */
  const place = (label: string, icon: ReactNode, request: ListingRequest, extra?: ReactNode) => (
    <Button key={label} variant="text" size="sm" aria-current={$use(() => (isAt(request) ? 'true' : undefined))} onClick={() => go(request)}>
      {icon}
      <span>{label}</span>
      {extra}
    </Button>
  );

  const preview = () => (
    <aside className={`${CLASS.PREVIEW} ${AUI_CLASS.GLASS_PANEL}`} aria-label="Preview">
      <Show
        when={picked}
        fallback={() => (
          <EmptyState title="Nothing picked" description="Pick an event to see it here." level={3}>
            <EmptyState.Snippet for="icon">{() => <LibraryIcon />}</EmptyState.Snippet>
          </EmptyState>
        )}
      >
        {(entry) => <EventDetails event={entry} />}
      </Show>
    </aside>
  );

  return () => (
    <Window sidebarResizeLabel="Resize sidebar">
      <Window.Snippet for="title">
        {() => (
          <>
            <Toggle aria-label="Hide sidebar" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(view, 'sidebarHidden')}>
              <Snippet>{() => (view.sidebarHidden ? <SidebarOpenIcon /> : <SidebarCloseIcon />)}</Snippet>
              <Tooltip>Hide sidebar</Tooltip>
            </Toggle>
            <WindowTitle>
              <Snippet>{() => monthTitle(view.anchor)}</Snippet>
            </WindowTitle>
            {/* While an event is picked, what can be done with it sits beside the title. */}
            <Show when={() => picked()?.path}>{() => <SelectionActions label="Picked event" groups={selection()} />}</Show>
          </>
        )}
      </Window.Snippet>
      <Window.Snippet for="sidebar">
        {() =>
          !view.sidebarHidden && (
            <WindowSidebar>
              <WindowSidebarPanel>
                <WindowSidebarLabel>Library</WindowSidebarLabel>
                {place(manifest.label, <LibraryIcon />, { view: 'calendar' })}
                {place(
                  'Invites',
                  <InvitesIcon />,
                  { view: 'invites' },
                  <Show when={invites}>{(count) => <span className={CLASS.COUNT}>{count}</span>}</Show>
                )}
              </WindowSidebarPanel>
              <WindowSidebarPanel>
                <WindowSidebarLabel>Calendars</WindowSidebarLabel>
                {CALENDARS.map((entry) =>
                  place(entry.label, <span className={CLASS.DOT} style={tintOf(entry)} aria-hidden="true" />, { tag: entry.tag })
                )}
              </WindowSidebarPanel>
            </WindowSidebar>
          )
        }
      </Window.Snippet>
      <Window.Snippet for="actions">
        {() => (
          <>
            <WedyanGallerySearch query={$bind(view, 'query')} />
            <Divider orientation="vertical" variant="ghost" size="sm" />
            <Button size="sm" variant="text" onClick={today}>
              Today
            </Button>
            <Button aria-label={$use(() => stepLabel(-1))} size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={() => step(-1)}>
              <ArrowLeft />
              <Tooltip>
                <Snippet>{() => stepLabel(-1)}</Snippet>
              </Tooltip>
            </Button>
            <Button aria-label={$use(() => stepLabel(1))} size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={() => step(1)}>
              <ArrowRight />
              <Tooltip>
                <Snippet>{() => stepLabel(1)}</Snippet>
              </Tooltip>
            </Button>
            {/* Moving through the days apart from how they show. */}
            <Divider orientation="vertical" variant="ghost" size="sm" />
            <ToggleGroup aria-label="Period" value={$bind(view, 'period')} required size="xs">
              <Toggle value="month" size="xs">
                Month
              </Toggle>
              <Toggle value="week" size="xs">
                Week
              </Toggle>
            </ToggleGroup>
            <Toggle aria-label="Preview" size="sm" variant="text" pressed={$bind(view, 'previewShown')} className={AUI_CLASS.CONTROL_ICON}>
              <PreviewIcon />
              <Tooltip>Preview</Tooltip>
            </Toggle>
            {/* Sets the app's own buttons apart from the window's. */}
            <Divider orientation="vertical" variant="ghost" size="sm" />
          </>
        )}
      </Window.Snippet>
      <div className={CLASS.BROWSE}>
        <CalendarGrid />
        <Show when={() => view.previewShown}>{preview}</Show>
      </div>
    </Window>
  );
});

/**
 * Whether two places down the side are the same: both everything, both the invites, or the same calendar.
 *
 * @param a - One place.
 * @param b - The other.
 * @returns Whether they match.
 */
function samePlace(a: ListingRequest, b: ListingRequest): boolean {
  if ('tag' in a || 'tag' in b) return 'tag' in a && 'tag' in b && a.tag === b.tag;
  return a.view === b.view;
}
