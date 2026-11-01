import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, setup, Show, Snippet } from '@airlib/react';
import { Button, Divider, Toggle, ToggleGroup, Tooltip } from '@airlib/react-aui';
import { WindowControls, WindowTitle, WindowToolbar } from '@airlib/react-aui/desktop';
import { PERSON_TABS, type PersonTab } from '@/apps/lounge/views/session.js';
import { ComposeIcon, DirectIcon, RenderIcon, SidebarCloseIcon, SidebarOpenIcon } from '../icons.js';
import { assigneeAt } from './compose/assignee.js';
import { AssigneeAvatar } from './compose/assignment.js';
import { type Composer, composerCtx } from './context.js';

/** The project window's toolbar: the side panel, the two modes, and what it's showing. */
export const ComposerToolbar = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <WindowToolbar className="wedyan-editor-toolbar">
      <Toggle aria-label="Sidebar" size="sm" className={AUI_CLASS.CONTROL_ICON} pressed={$bind(composer, 'sidebar')}>
        <Snippet>{() => (composer.sidebar ? <SidebarCloseIcon /> : <SidebarOpenIcon />)}</Snippet>
        <Tooltip>Sidebar</Tooltip>
      </Toggle>
      <Divider orientation="vertical" variant="ghost" size="sm" />
      <ToggleGroup aria-label="Editor" size="sm" variant="glass" value={$bind(composer, 'mode')} required>
        <Toggle value="direct" size="sm">
          <DirectIcon />
          <span>Direct</span>
        </Toggle>
        <Toggle value="compose" size="sm">
          <ComposeIcon />
          <span>Compose</span>
        </Toggle>
      </ToggleGroup>
      <Divider orientation="vertical" variant="ghost" size="sm" />
      {/* A cast open in Direct is edited as in Lounge, its tabs beside the editor's. */}
      <Show when={() => composer.mode === 'direct' && composer.activeView === 'cast'}>{() => <CastTabs />}</Show>
      <WindowTitle>
        <Snippet>{() => (composer.mode === 'compose' ? composer.stage?.name : composer.motion?.name) ?? ''}</Snippet>
      </WindowTitle>
      <WindowControls>
        <Show when={() => composer.mode === 'compose'}>{() => <ComposeActions />}</Show>
      </WindowControls>
    </WindowToolbar>
  );
}, 'ComposerToolbar');

/** What an open cast shows, picked as Lounge picks it. */
const CastTabs = setup(() => {
  const composer = composerCtx.get() as Composer;
  const tab = {
    get value() {
      return composer.person ?? 'profile';
    },
    set value(next: string) {
      composer.person = next as PersonTab;
    },
  };

  return () => (
    <>
      <ToggleGroup aria-label="Show" size="sm" variant="glass" value={$bind(tab, 'value')} required>
        {(Object.keys(PERSON_TABS) as PersonTab[]).map((name) => (
          <Toggle key={name} value={name} size="sm">
            <span>{PERSON_TABS[name]}</span>
          </Toggle>
        ))}
      </ToggleGroup>
      <Divider orientation="vertical" variant="ghost" size="sm" />
    </>
  );
}, 'CastTabs');

/** What can be done with the stage in Compose: what its render says, who it's assigned to, and Render. */
const ComposeActions = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <>
      <Snippet>
        {() => (composer.status ? <span className="wedyan-motions-notice">{composer.status}</span> : null)}
      </Snippet>
      <Snippet data={() => assigneeAt(composer, composer.stage?.assignee)}>
        {(agent) =>
          agent ? (
            <>
              <AssigneeAvatar assignee={agent} />
              <Divider orientation="vertical" variant="ghost" size="sm" />
            </>
          ) : null
        }
      </Snippet>
      <Snippet>
        {() => (
          <Button size="sm" variant="filled" disabled={composer.rendering} onClick={composer.render}>
            <RenderIcon />
            <span>Render</span>
          </Button>
        )}
      </Snippet>
      <Divider orientation="vertical" variant="ghost" size="sm" />
    </>
  );
}, 'ComposeActions');
