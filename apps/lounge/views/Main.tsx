import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, mutable, Show, Snippet } from '@airlib/react';
import { Button, Divider, EmptyState, Toggle, ToggleGroup, Tooltip } from '@airlib/react-aui';
import {
  defineWindow,
  Window,
  WindowBody,
  WindowControls,
  WindowPanel,
  WindowToolbar,
} from '@airlib/react-aui/desktop';
import { AddIcon } from '@airlib/react-aui/icons';
import type { FC } from 'react';
import { type DirectItem, DirectList } from '@/components/Direct.js';
import { SaveButton } from '@/components/SaveButton.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { AgentEditor } from './Agent.js';
import { AgentsIcon, PeopleIcon, PersonIcon, SidebarCloseIcon, SidebarOpenIcon, SkillIcon } from './icons.js';
import { agents, byName, KINDS, newAgent, newPerson, newSkill, people, portraitOf, remove, skills } from './library.js';
import { PersonaEditor } from './Persona.js';
import { loungeCtx, PERSON_TABS, type PersonTab } from './session.js';
import { SkillEditor } from './Skill.js';

/** Who and what Lounge shows: the people and characters, the user's own agents, or their own skills. */
type Group = 'people' | 'agents' | 'skills';

/**
 * Each group's name, its glyph, what one of it is called, what making one is, and its rows by
 * name, read live.
 */
const GROUPS: Record<Group, { label: string; Icon: FC; one: string; create: () => string; rows: () => DirectItem[] }> = {
  people: {
    label: 'People',
    Icon: PeopleIcon,
    one: 'person',
    create: newPerson,
    rows: () =>
      byName(people()).map(({ path, document }) => ({
        key: path,
        title: document.name || 'Unnamed',
        description: document.description || KINDS[document.kind],
        picture: portraitOf(path, document),
        icon: PersonIcon,
      })),
  },
  agents: {
    label: 'Agents',
    Icon: AgentsIcon,
    one: 'agent',
    create: newAgent,
    rows: () =>
      byName(agents()).map(({ path, document }) => ({
        key: path,
        title: document.name || 'Unnamed',
        description: document.description,
        picture: document.avatar,
        icon: AgentsIcon,
      })),
  },
  skills: {
    label: 'Skills',
    Icon: SkillIcon,
    one: 'skill',
    create: newSkill,
    rows: () =>
      byName(skills()).map(({ path, document }) => ({
        key: path,
        title: document.name || 'Unnamed',
        description: document.description,
        icon: SkillIcon,
      })),
  },
};

/**
 * Lounge: where the user meets everyone who works or appears with them, and what they can do, in
 * one window, laid out as Motions lays out a project. The toolbar switches between People — the
 * people and characters their images, videos and scripts are made from — their own Agents, and
 * their own Skills. Down the side, the group's list to search, each by its picture or glyph, name,
 * and a line about it; beside it, the one picked, edited in place, with, for a person, how their
 * picked picture was made on the right, and for a skill, what it may call. Someone new opens as
 * they're made.
 */
export const lounge = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  // Wide enough for the side, a person, and how their picked picture was made, side by side.
  window: { snap: '.aui-window', minWidth: 1024, minHeight: 400 },
}).render(() => {
  // Each group keeps its own pick; until the user picks, its first one is open.
  const view = mutable({
    group: 'people' as Group,
    tab: 'profile' as PersonTab,
    picked: { people: null, agents: null, skills: null } as Record<Group, string | null>,
    query: '',
    sidebar: true,
  });

  const opened = () => view.picked[view.group] ?? GROUPS[view.group].rows()[0]?.key ?? null;
  loungeCtx.set({
    get path() {
      return opened();
    },
    get tab() {
      return view.tab;
    },
    remove() {
      const path = opened();
      if (!path) return;
      view.picked[view.group] = null;
      remove([path]);
    },
  });

  // What the toolbar's tabs pick: the group, which starts its search afresh.
  const tabs = {
    get value() {
      return view.group;
    },
    set value(group: string) {
      view.group = group as Group;
      view.query = '';
    },
  };

  // What the side's list picks: the open one, written back as the group's pick.
  const pick = {
    get value() {
      return opened() ?? '';
    },
    set value(path: string) {
      view.picked[view.group] = path;
    },
  };

  // The side's rows, narrowed by the search, so a rename, a new picture, a new one, or the search shows at once.
  const rows = (): DirectItem[] => {
    const query = view.query.trim().toLowerCase();
    const items = GROUPS[view.group].rows();
    return query ? items.filter((item) => `${item.title} ${item.description ?? ''}`.toLowerCase().includes(query)) : items;
  };

  return () => (
    <Window>
      {/* As in a Motions project, the toolbar rests on the window's glass and the panels sit on it. */}
      <Window.Snippet for="body">
        {() => (
          <WindowBody className="wedyan-editor">
            <WindowToolbar className="wedyan-editor-toolbar">
              <Toggle aria-label="Sidebar" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(view, 'sidebar')}>
                <Snippet>{() => (view.sidebar ? <SidebarCloseIcon /> : <SidebarOpenIcon />)}</Snippet>
                <Tooltip>Sidebar</Tooltip>
              </Toggle>
              <Divider orientation="vertical" variant="ghost" size="sm" />
              <ToggleGroup aria-label="Show" size="sm" variant="glass" value={$bind(tabs, 'value')} required>
                {(Object.keys(GROUPS) as Group[]).map((group) => {
                  const { label, Icon } = GROUPS[group];
                  return (
                    <Toggle key={group} value={group} variant="text" size="sm">
                      <Icon />
                      <span>{label}</span>
                    </Toggle>
                  );
                })}
              </ToggleGroup>
              <WindowControls>
                {/* What an open person shows, as the group is picked: tabs on the toolbar, apart from the app's buttons. */}
                <Show when={() => view.group === 'people' && opened()}>
                  {() => (
                    <>
                      <ToggleGroup aria-label="Show" size="sm" variant="glass" value={$bind(view, 'tab')} required>
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
                      aria-label={`New ${GROUPS[view.group].one}`}
                      size="sm"
                      variant="text"
                      className={AUI_CLASS.CONTROL_ICON}
                      onClick={() => (view.picked[view.group] = GROUPS[view.group].create())}
                    >
                      <AddIcon />
                      <Tooltip>{`New ${GROUPS[view.group].one}`}</Tooltip>
                    </Button>
                  )}
                </Snippet>
                <Show when={opened}>{() => <SaveButton />}</Show>
                {/* Sets the app's own buttons apart from the window's. */}
                <Divider orientation="vertical" variant="ghost" size="sm" />
              </WindowControls>
            </WindowToolbar>
            <div className="wedyan-lounge">
              <Snippet>
                {() =>
                  view.sidebar && (
                    <DirectList
                      label={GROUPS[view.group].label}
                      listLabel={GROUPS[view.group].label}
                      groups={() => [{ items: rows() }]}
                      value={$bind(pick, 'value')}
                      query={$bind(view, 'query')}
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
                          title={`No ${GROUPS[view.group].label.toLowerCase()} yet`}
                          description="Add one with + in the toolbar."
                          level={3}
                        >
                          <EmptyState.Snippet for="icon">
                            {() => {
                              const { Icon } = GROUPS[view.group];
                              return <Icon />;
                            }}
                          </EmptyState.Snippet>
                        </EmptyState>
                      </WindowPanel>
                    );
                  }
                  if (path.endsWith('.agent')) return <AgentEditor key={path} />;
                  if (path.endsWith('.skill')) return <SkillEditor key={path} />;
                  return <PersonaEditor key={path} />;
                }}
              </Snippet>
            </div>
          </WindowBody>
        )}
      </Window.Snippet>
    </Window>
  );
});
