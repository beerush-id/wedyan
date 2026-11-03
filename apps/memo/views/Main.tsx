import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, derived, effect, Snippet } from '@airlib/react';
import { Button, Divider, EmptyState, Toggle, ToggleGroup, Tooltip } from '@airlib/react-aui';
import { defineWindow, Window, WindowBody, WindowControls, WindowPanel, WindowToolbar } from '@airlib/react-aui/desktop';
import { AddIcon } from '@airlib/react-aui/icons';
import type { FC } from 'react';
import { type DirectItem, DirectList } from '@/components/Direct.js';
import { shortDate } from '@/lib/documents/rows.js';
import { attachFacts } from '@/lib/systems/public.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';
import { createMemos } from './context.js';
import { MemosIcon, MemoryIcon, SidebarCloseIcon, SidebarOpenIcon } from './icons.js';
import { type MemoGroup, opening, PRIORITIES, rowPriority } from './library.js';
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
}).render((props) => {
  const memos = createMemos();
  const { state: view, opened } = memos;
  memoCtx.set({ remove: () => void memos.remove(), changed: memos.changed });
  attachFacts(props.instance, () => ({
    showing: view.group,
    memo: opened.value,
    ...(view.query ? { searching: view.query } : {}),
  }));

  // A link's memo opens in its own tab, picked, once it's listed.
  effect(() => {
    if (opening.path && memos.open(opening.path)) opening.path = null;
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
      return opened.value ?? '';
    },
    set value(path: string) {
      view.picked[view.group] = path;
    },
  };

  // The side's rows, narrowed by the search through names and words, each saying how much it weighs, when it isn't normal, and when it changed.
  const items = derived((): DirectItem[] => {
    const query = view.query.trim().toLowerCase();
    const { Icon } = GROUPS[view.group];
    return memos.rows.value
      .filter(({ name, description }) => !query || `${name} ${description ?? ''}`.toLowerCase().includes(query))
      .map((row) => {
        const priority = rowPriority(row);
        return {
          key: row.path,
          title: row.name || 'Untitled',
          description: [priority !== 'normal' && `${PRIORITIES[priority]} priority`, row.updated && shortDate(row.updated)].filter(Boolean).join(' · '),
          icon: Icon,
        };
      });
  });

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
                <Button aria-label="New memo" size="sm" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={() => void memos.create()}>
                  <AddIcon />
                  <Tooltip>New memo</Tooltip>
                </Button>
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
                      groups={() => [{ items: items.value }]}
                      value={$bind(pick, 'value')}
                      query={$bind(view, 'query')}
                    />
                  )
                }
              </Snippet>
              {/* A memo picked anew starts its editor afresh, so its fields hold it from the start. */}
              <Snippet data={() => opened.value}>
                {(path) =>
                  path ? (
                    <MemoEditor key={path} path={path} />
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
