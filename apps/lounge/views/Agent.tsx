import { $bind, $static, $use, Show, Snippet, setup } from '@airlib/react';
import { Avatar, Button, CheckboxGroup, EmptyState, Spinner, TextInput } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import type { AgentFile } from '@/lib/share/agents.js';
import { dfs } from '@/lib/share/dfs.js';
import { Choice } from './Choice.js';
import { AgentsIcon, DeleteIcon } from './icons.js';
import { announceName, edit, factsOf, SKILLS } from './library.js';
import { loungeCtx, type LoungeSession } from './session.js';

const CLASS = {
  PANEL: 'wedyan-lounge-open',
  AGENT: 'wedyan-lounge-agent',
  HEAD: 'wedyan-lounge-editor-head',
  NAME: 'wedyan-lounge-editor-name',
  FIELD: 'wedyan-lounge-editor-field',
  FIELD_LABEL: 'wedyan-lounge-editor-field-label',
  SECTION: 'wedyan-lounge-editor-section',
  SKILLS: 'wedyan-lounge-skills',
  FACTS: 'wedyan-lounge-editor-facts',
  FOOT: 'wedyan-lounge-editor-foot',
};

/**
 * The open agent, edited where it's listed: its name and picture, what it does — which is how
 * Wedyan knows when to hand it an ask — how it works and talks, and the skills it's given, which
 * are exactly what it may use. Its file is bound, so every change is saved as it's made, and it's
 * this file the kernel runs the agent from.
 */
export const AgentEditor = setup(() => {
  const session = loungeCtx.get() as LoungeSession;
  // Made afresh for each agent, so which file it works on never changes under it.
  const path = $static(() => session.path) as string;
  const file = dfs.binding<AgentFile>(path);
  const agent = () => file.data;

  /**
   * Changes the open agent, while it's still on the drive, and marks when it changed.
   *
   * @param apply - What to change in it.
   */
  const change = (apply: (document: AgentFile) => void) => {
    const document = agent();
    if (document) edit(document, () => apply(document));
  };

  // What the fields edit: the agent's own values, read live and written straight back to it. The
  // contract keeps its picture and persona optional, so emptying them leaves them out. What the
  // list shows of it is written to its row too, which the listing filled.
  const fields = {
    get name() {
      return agent()?.name ?? '';
    },
    set name(name: string) {
      change((document) => (document.name = name));
      if (session.row) session.row.name = name;
    },
    get description() {
      return agent()?.description ?? '';
    },
    set description(description: string) {
      change((document) => (document.description = description));
      if (session.row) session.row.description = description;
    },
    get persona() {
      return agent()?.persona ?? '';
    },
    set persona(persona: string) {
      change((document) => {
        if (persona) document.persona = persona;
        else delete document.persona;
      });
    },
    get avatar() {
      return agent()?.avatar ?? '';
    },
    set avatar(avatar: string) {
      change((document) => {
        if (avatar) document.avatar = avatar;
        else delete document.avatar;
      });
    },
    get skills() {
      return agent()?.skills ?? [];
    },
    set skills(chosen: string[]) {
      change((document) => (document.skills = chosen));
    },
  };

  return () => (
    <WindowPanel surface="solid" role="region" aria-label="Agent" className={CLASS.PANEL}>
      <Show
        when={agent}
        fallback={() => (
          <EmptyState
            title={$use(() => (file.ready ? 'This agent is gone' : 'Loading this agent'))}
            description={$use(() => (file.ready ? 'It was deleted from Agents.' : undefined))}
            level={3}
          >
            <EmptyState.Snippet for="icon">{() => (file.ready ? <AgentsIcon /> : <Spinner label="Loading this agent" />)}</EmptyState.Snippet>
          </EmptyState>
        )}
      >
        {() => (
          <article className={CLASS.AGENT}>
            <header className={CLASS.HEAD}>
              <Avatar src={$use(() => fields.avatar || undefined)} alt={$use(() => fields.name || 'Unnamed')} size="lg" />
              <TextInput
                label="Name"
                placeholder="What you call it"
                value={$bind(fields, 'name')}
                onchange={() => announceName(path, fields.name)}
                className={CLASS.NAME}
              />
            </header>
            <div className={CLASS.FIELD}>
              <span className={CLASS.FIELD_LABEL} aria-hidden="true">
                What it does
              </span>
              <TextInput
                multiline
                rows={2}
                label="What it does"
                placeholder="The work it takes on, in a line: Wedyan hands it asks of this kind."
                value={$bind(fields, 'description')}
              />
            </div>
            <div className={CLASS.FIELD}>
              <span className={CLASS.FIELD_LABEL} aria-hidden="true">
                How it works and talks
              </span>
              <TextInput
                multiline
                rows={3}
                label="How it works and talks"
                placeholder="E.g. Calm and brief: says why in a line."
                value={$bind(fields, 'persona')}
              />
            </div>
            <div className={CLASS.FIELD}>
              <span className={CLASS.FIELD_LABEL} aria-hidden="true">
                Picture
              </span>
              <TextInput size="sm" label="Picture" placeholder="A picture's address; its initials show without one" value={$bind(fields, 'avatar')} />
            </div>
            <section className={CLASS.SECTION} aria-label="Skills">
              <span className={CLASS.FIELD_LABEL}>Skills — exactly what it may use</span>
              <CheckboxGroup label="Skills" value={$bind(fields, 'skills')} className={CLASS.SKILLS}>
                {Object.entries(SKILLS).map(([skill, { label, hint }]) => (
                  <Choice key={skill} value={skill} title={label} hint={hint} />
                ))}
              </CheckboxGroup>
            </section>
            <footer className={CLASS.FOOT}>
              <Snippet data={agent}>{(document) => document && <p className={CLASS.FACTS}>{factsOf(document)}</p>}</Snippet>
              <Button size="sm" variant="tonal" onClick={() => session.remove?.()}>
                <DeleteIcon />
                <span>Delete agent</span>
              </Button>
            </footer>
          </article>
        )}
      </Show>
    </WindowPanel>
  );
}, 'AgentEditor');
