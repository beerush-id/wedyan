import { $bind, $use, Show, Snippet, setup } from '@airlib/react';
import { Avatar, Checkbox, CheckboxGroup, EmptyState, Label, TextInput } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import type { AgentFile } from '@/lib/share/agents.js';
import { ConfirmButton } from './ConfirmButton.js';
import { AgentsIcon, DeleteIcon } from './icons.js';
import { agentAt, byName, edit, factsOf, SKILLS, skillRef, skills } from './library.js';
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
  SKILLS_LABEL: 'wedyan-lounge-skills-label',
  SKILL: 'wedyan-lounge-skill',
  SKILL_HINT: 'wedyan-lounge-skill-hint',
  FACTS: 'wedyan-lounge-editor-facts',
  FOOT: 'wedyan-lounge-editor-foot',
};

/**
 * The open agent, edited where it's listed: its name and picture, what it does — which is how
 * Wedyan knows when to hand it an ask — how it works and talks, and the skills it's given, which
 * are exactly what it may use. Every change is made to the agent itself, so the list beside it
 * sees it at once.
 */
export const AgentEditor = setup(() => {
  const session = loungeCtx.get() as LoungeSession;
  const agent = () => (session.path ? agentAt(session.path) : undefined);

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
  // contract keeps its picture and persona optional, so emptying them leaves them out.
  const fields = {
    get name() {
      return agent()?.name ?? '';
    },
    set name(name: string) {
      change((document) => (document.name = name));
    },
    get description() {
      return agent()?.description ?? '';
    },
    set description(description: string) {
      change((document) => (document.description = description));
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
          <EmptyState title="This agent is gone" description="It was deleted from Agents." level={3}>
            <EmptyState.Snippet for="icon">{() => <AgentsIcon />}</EmptyState.Snippet>
          </EmptyState>
        )}
      >
        {() => (
        <article className={CLASS.AGENT}>
          <header className={CLASS.HEAD}>
            <Avatar src={$use(() => fields.avatar || undefined)} alt={$use(() => fields.name || 'Unnamed')} size="lg" />
            <TextInput label="Name" placeholder="What you call it" value={$bind(fields, 'name')} className={CLASS.NAME} />
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
            {/* One choice across both: the apps' skills, then the user's own on top of them. */}
            <CheckboxGroup label="Skills" value={$bind(fields, 'skills')} className={CLASS.SKILLS}>
              <span className={CLASS.SKILLS_LABEL} aria-hidden="true">
                From apps
              </span>
              {Object.entries(SKILLS).map(([skill, { label, hint }]) => skillChoice(skill, label, hint))}
              <Snippet>
                {() =>
                  skills().length ? (
                    <>
                      <span className={CLASS.SKILLS_LABEL} aria-hidden="true">
                        Your skills
                      </span>
                      {byName(skills()).map(({ path, document }) => skillChoice(skillRef(path), document.name || 'Unnamed', document.description))}
                    </>
                  ) : null
                }
              </Snippet>
            </CheckboxGroup>
          </section>
          <footer className={CLASS.FOOT}>
            <Snippet data={agent}>{(document) => document && <p className={CLASS.FACTS}>{factsOf(document)}</p>}</Snippet>
            <ConfirmButton
              size="sm"
              variant="tonal"
              title={() => `Delete ${fields.name || 'this agent'}?`}
              description="It's taken off Agents."
              action="Delete"
              onconfirm={() => session.remove()}
            >
              <DeleteIcon />
              <span>Delete agent</span>
            </ConfirmButton>
          </footer>
        </article>
        )}
      </Show>
    </WindowPanel>
  );
}, 'AgentEditor');

/**
 * One skill an agent can be given: its name to tick, and what it lets the agent do beside it.
 *
 * @param value - How the agent writes it: an app skill's name, or a user skill's path from the agent's file.
 * @param label - Its name.
 * @param hint - What it lets the agent do.
 * @returns The choice.
 */
function skillChoice(value: string, label: string, hint: string) {
  return (
    <div key={value} className={CLASS.SKILL}>
      <Label label={label}>
        <Checkbox value={value} />
      </Label>
      <span className={CLASS.SKILL_HINT}>{hint}</span>
    </div>
  );
}
