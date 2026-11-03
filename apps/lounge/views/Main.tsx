import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, effect, Show, Snippet } from '@airlib/react';
import { Button, Divider, EmptyState, Spinner, Toggle, ToggleGroup, Tooltip } from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowBody,
  WindowControls,
  WindowPanel,
  WindowToolbar,
} from '@airlib/react-aui/desktop';
import { AddIcon } from '@airlib/react-aui/icons';
import { IRPC_STATUS } from '@irpclib/irpc';
import type { FC } from 'react';
import { type DirectItem, DirectList } from '@/components/Direct.js';
import type { FileRow } from '@/lib/documents/rows.js';
import { AGENT_EXTENSION } from '@/lib/share/agents.js';
import { pathFrom } from '@/lib/share/paths.js';
import { attachFacts } from '@/lib/systems/public.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { AgentEditor } from './Agent.js';
import { createLounge, type Group } from './context.js';
import { AgentsIcon, PeopleIcon, PersonIcon, SidebarCloseIcon, SidebarOpenIcon } from './icons.js';
import { opening, rowPortrait } from './library.js';
import { PersonaEditor } from './Persona.js';
import { loungeCtx, PERSON_TABS, type PersonTab, pictureShown } from './session.js';

/** Each group's name, its glyph, what one of it is called, and how a listed one reads as a row. */
const GROUPS: Record<Group, { label: string; Icon: FC; one: string; item: (row: FileRow) => DirectItem }> = {
  people: {
    label: 'People',
    Icon: PeopleIcon,
    one: 'person',
    item: (row) => ({ key: row.path, title: row.name || 'Unnamed', description: row.description, picture: rowPortrait(row), icon: PersonIcon }),
  },
  agents: {
    label: 'Agents',
    Icon: AgentsIcon,
    one: 'agent',
    item: (row) => ({ key: row.path, title: row.name || 'Unnamed', description: row.description, picture: row.thumbnail, icon: AgentsIcon }),
  },
};

/**
 * Lounge: where the user keeps everyone who works or appears with them, in one window, laid out as
 * Motions lays out a project. The toolbar switches between People — the people and characters
 * their images, videos and scripts are made from — and their own Agents. Down the side, the
 * group's real files to search, each by its picture or glyph, name, and a line about it; beside it,
 * the one picked, edited in place and saved as it changes, with, for a person's pictures, how the
 * picked one is made on the right. Someone new opens as they're made.
 */
export const lounge = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  // Wide enough for the side, a person, and how their picked picture was made, side by side.
  window: { snap: '.aui-window', minWidth: 1024, minHeight: 400 },
}).render((props) => {
  const library = createLounge();
  const { state, opened, rows } = library;
  const picture = pictureShown();

  attachFacts(props.instance, () => {
    const path = opened();
    if (state.group === 'agents') return { showing: 'agents', agent: path };
    const picked = path && picture.read();
    return { showing: 'people', person: path, tab: state.tab, ...(picked ? { picture: pathFrom(path as string, picked) } : {}) };
  });

  // A link's person or agent opens in its group, picked.
  effect(() => {
    const path = opening.path;
    if (!path) return;
    const group: Group = path.endsWith(AGENT_EXTENSION) ? 'agents' : 'people';
    state.group = group;
    state.picked[group] = path;
    opening.path = null;
  });

  loungeCtx.set({
    get path() {
      return opened();
    },
    get tab() {
      return state.tab;
    },
    get row() {
      return library.row;
    },
    remove() {
      void library.remove();
    },
    showPicture: picture.show,
  });

  // What the toolbar's tabs pick: the group, which starts its search afresh.
  const tabs = {
    get value() {
      return state.group;
    },
    set value(group: string) {
      state.group = group as Group;
      state.query = '';
    },
  };

  // What the side's list picks: the open one, written back as the group's pick.
  const pick = {
    get value() {
      return opened() ?? '';
    },
    set value(path: string) {
      state.picked[state.group] = path;
    },
  };

  // The side's rows, narrowed by the search, so a rename, a new one, or the search shows at once.
  const visible = (): DirectItem[] => {
    const query = state.query.trim().toLowerCase();
    const items = rows().map(GROUPS[state.group].item);
    return query ? items.filter((item) => `${item.title} ${item.description ?? ''}`.toLowerCase().includes(query)) : items;
  };

  // Where the group's listing stands, for what shows while nothing is open.
  const listing = () => library.listings[state.group];
  const pending = () => listing().status === IRPC_STATUS.PENDING;
  const label = () => GROUPS[state.group].label.toLowerCase();

  return () => (
    <Window>
      {/* As in a Motions project, the toolbar rests on the window's glass and the panels sit on it. */}
      <Window.Snippet for="body">
        {() => (
          <WindowBody className="wedyan-editor">
            <WindowToolbar className="wedyan-editor-toolbar">
              <Toggle aria-label="Sidebar" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(state, 'sidebar')}>
                <Snippet>{() => (state.sidebar ? <SidebarCloseIcon /> : <SidebarOpenIcon />)}</Snippet>
                <Tooltip>Sidebar</Tooltip>
              </Toggle>
              <Divider orientation="vertical" variant="ghost" size="sm" />
              <ToggleGroup aria-label="Show" size="sm" variant="glass" value={$bind(tabs, 'value')} required>
                {(Object.keys(GROUPS) as Group[]).map((group) => {
                  const { label: name, Icon } = GROUPS[group];
                  return (
                    <Toggle key={group} value={group} variant="text" size="sm">
                      <Icon />
                      <span>{name}</span>
                    </Toggle>
                  );
                })}
              </ToggleGroup>
              <WindowControls>
                {/* What an open person shows, as the group is picked: tabs on the toolbar, apart from the app's buttons. */}
                <Show when={() => state.group === 'people' && opened()}>
                  {() => (
                    <>
                      <ToggleGroup aria-label="Show" size="sm" variant="glass" value={$bind(state, 'tab')} required>
                        {(Object.keys(PERSON_TABS) as PersonTab[]).map((tab) => (
                          <Toggle key={tab} value={tab} variant="text" size="sm">
                            <span>{PERSON_TABS[tab]}</span>
                          </Toggle>
                        ))}
                      </ToggleGroup>
                      <Divider orientation="vertical" variant="ghost" size="sm" />
                    </>
                  )}
                </Show>
                <Snippet>
                  {() => (
                    <Button
                      aria-label={`New ${GROUPS[state.group].one}`}
                      size="sm"
                      variant="text"
                      className={AUI_CLASS.CONTROL_ICON}
                      disabled={$use(() => state.creating)}
                      onClick={library.create}
                    >
                      <AddIcon />
                      <Tooltip>{`New ${GROUPS[state.group].one}`}</Tooltip>
                    </Button>
                  )}
                </Snippet>
                {/* Sets the app's own buttons apart from the window's. */}
                <Divider orientation="vertical" variant="ghost" size="sm" />
              </WindowControls>
            </WindowToolbar>
            <div className="wedyan-lounge">
              <Snippet>
                {() =>
                  state.sidebar && (
                    <DirectList
                      label={GROUPS[state.group].label}
                      listLabel={GROUPS[state.group].label}
                      groups={() => [{ items: visible() }]}
                      value={$bind(pick, 'value')}
                      query={$bind(state, 'query')}
                    />
                  )
                }
              </Snippet>
              {/* Someone picked anew starts their editor afresh, so its fields hold them from the start. */}
              <Snippet data={opened}>
                {(path) => {
                  if (!path) {
                    return (
                      <WindowPanel surface="solid" role="region" aria-label="Open" className="wedyan-lounge-open">
                        <EmptyState
                          title={$use(() => (pending() ? `Loading your ${label()}` : listing().error ? `Couldn't load your ${label()}` : `No ${label()} yet`))}
                          description={$use(() => (pending() ? undefined : (listing().error?.message ?? 'Add one with + in the toolbar.')))}
                          level={3}
                        >
                          <EmptyState.Snippet for="icon">
                            {() => {
                              const { Icon } = GROUPS[state.group];
                              return pending() ? <Spinner label={`Loading your ${label()}`} /> : <Icon />;
                            }}
                          </EmptyState.Snippet>
                          <EmptyState.Snippet for="action">
                            {() =>
                              !pending() && listing().error ? (
                                <Button size="sm" variant="filled" onClick={() => (state.asked[state.group] += 1)}>
                                  Try again
                                </Button>
                              ) : (
                                ''
                              )
                            }
                          </EmptyState.Snippet>
                        </EmptyState>
                      </WindowPanel>
                    );
                  }
                  if (path.endsWith(AGENT_EXTENSION)) return <AgentEditor key={path} />;
                  return <PersonaEditor />;
                }}
              </Snippet>
            </div>
          </WindowBody>
        )}
      </Window.Snippet>
    </Window>
  );
});
