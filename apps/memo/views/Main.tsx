import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, effect, mutable, Show, Snippet } from '@airlib/react';
import { Button, Divider, EmptyState, Toggle, ToggleGroup, Tooltip } from '@airlib/react-aui';
import { defineWindow, Window, WindowBody, WindowControls, WindowPanel, WindowToolbar } from '@airlib/react-aui/desktop';
import { AddIcon } from '@airlib/react-aui/icons';
import type { FC } from 'react';
import { type DirectItem, DirectList } from '@/components/Direct.js';
import { SaveButton } from '@/components/SaveButton.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { MemosIcon, MemoryIcon, SidebarCloseIcon, SidebarOpenIcon } from './icons.js';
import { type MemoGroup, memoAt, memosOf, newMemo, opening, PRIORITIES, priorityOf, remove, shortDate } from './library.js';
import { MemoEditor } from './Memo.js';
import { memoCtx } from './session.js';

/** Each tab's name and glyph, and what it says while it holds nothing. */
const GROUPS: Record<MemoGroup, { label: string; Icon: FC; empty: string }> = {
  personal: { label: 'Personal', Icon: MemosIcon, empty: 'Add one with + in the toolbar.' },
  memory: { label: 'Memory', Icon: MemoryIcon, empty: 'What Wedyan remembers about you shows here.' },
};

/**
 * Memo: what the user keeps, and what Wedyan remembers, in one window laid out as Lounge is. The
 * toolbar switches between Personal — the user's own memos — and Memory — the memos Wedyan saved.
 * Down the side, the tab's memos to search, high priority first; beside them, the one open, its
 * words in Markdown, read or edited in place.
 */
export const memo = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 720, minHeight: 400 },
}).render(() => {
  // Each tab keeps its own pick; until the user picks, its first memo is open.
  const view = mutable({
    group: 'personal' as MemoGroup,
    picked: { personal: null, memory: null } as Record<MemoGroup, string | null>,
    query: '',
    sidebar: true,
  });

  const opened = () => view.picked[view.group] ?? memosOf(view.group)[0]?.path ?? null;
  memoCtx.set({
    get path() {
      return opened();
    },
    remove() {
      const path = opened();
      if (!path) return;
      view.picked[view.group] = null;
      remove(path);
    },
  });

  // A link's memo opens in its own tab, picked.
  effect(() => {
    const path = opening.path;
    const document = path ? memoAt(path) : undefined;
    if (!path || !document) return;
    view.group = document.author.kind === 'agent' ? 'memory' : 'personal';
    view.picked[view.group] = path;
    view.query = '';
    opening.path = null;
  });

  // What the toolbar's tabs pick: the tab, which starts its search afresh.
  const tabs = {
    get value() {
      return view.group;
    },
    set value(group: string) {
      view.group = group as MemoGroup;
      view.query = '';
    },
  };

  // What the side's list picks: the open memo, written back as the tab's pick.
  const pick = {
    get value() {
      return opened() ?? '';
    },
    set value(path: string) {
      view.picked[view.group] = path;
    },
  };

  // The side's rows, narrowed by the search through names and words, each saying how much it weighs, when it isn't normal, and when it changed.
  const rows = (): DirectItem[] => {
    const query = view.query.trim().toLowerCase();
    return memosOf(view.group)
      .filter(({ document }) => !query || `${document.name} ${document.body}`.toLowerCase().includes(query))
      .map(({ path, document }) => {
        const priority = priorityOf(document);
        return {
          key: path,
          title: document.name || 'Untitled',
          description: [priority !== 'normal' && `${PRIORITIES[priority]} priority`, shortDate(document.updated)].filter(Boolean).join(' · '),
          icon: GROUPS[view.group].Icon,
        };
      });
  };

  // A new memo is the user's own, so it opens in Personal.
  const create = () => {
    view.group = 'personal';
    view.query = '';
    view.picked.personal = newMemo();
  };

  return () => (
    <Window>
      {/* As in Lounge, the toolbar rests on the window's glass and the list and the memo are panels on it. */}
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
                {(Object.keys(GROUPS) as MemoGroup[]).map((group) => {
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
                <Button aria-label="New memo" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={create}>
                  <AddIcon />
                  <Tooltip>New memo</Tooltip>
                </Button>
                <Show when={opened}>{() => <SaveButton />}</Show>
                {/* Sets the app's own buttons apart from the window's. */}
                <Divider orientation="vertical" variant="ghost" size="sm" />
              </WindowControls>
            </WindowToolbar>
            <div className="wedyan-memo">
              <Snippet>
                {() =>
                  view.sidebar && (
                    <DirectList
                      label={GROUPS[view.group].label}
                      listLabel={`${GROUPS[view.group].label} memos`}
                      groups={() => [{ items: rows() }]}
                      value={$bind(pick, 'value')}
                      query={$bind(view, 'query')}
                    />
                  )
                }
              </Snippet>
              {/* A memo picked anew starts its editor afresh, so its fields hold it from the start. */}
              <Snippet data={opened}>
                {(path) =>
                  path ? (
                    <MemoEditor key={path} />
                  ) : (
                    <WindowPanel surface="solid" role="region" aria-label="Memo" className="wedyan-memo-open">
                      <EmptyState title="No memos yet" description={GROUPS[view.group].empty} level={3}>
                        <EmptyState.Snippet for="icon">
                          {() => {
                            const { Icon } = GROUPS[view.group];
                            return <Icon />;
                          }}
                        </EmptyState.Snippet>
                      </EmptyState>
                    </WindowPanel>
                  )
                }
              </Snippet>
            </div>
          </WindowBody>
        )}
      </Window.Snippet>
    </Window>
  );
});
