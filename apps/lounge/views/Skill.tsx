import { $bind, $static, mutable, Show, Snippet, setup } from '@airlib/react';
import { CheckboxGroup, EmptyState, TextInput, Toggle, ToggleGroup } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import { MarkdownRenderer } from '@airlib/react-aui/markdown';
import { ConfirmButton } from '@/components/ConfirmButton.js';
import { GenerationGroup } from '@/components/GenerationForm.js';
import { Choice } from './Choice.js';
import { DeleteIcon, EditIcon, PreviewIcon, SkillIcon } from './icons.js';
import { type Callable, CALLABLES, edit, type SkillFile, skillAt } from './library.js';
import { loungeCtx, type LoungeSession } from './session.js';

const CLASS = {
  PANEL: 'wedyan-lounge-open',
  SKILL: 'wedyan-lounge-skill-page',
  HEAD: 'wedyan-lounge-editor-head',
  GLYPH: 'wedyan-lounge-skill-glyph',
  NAME: 'wedyan-lounge-editor-name',
  FIELD: 'wedyan-lounge-editor-field',
  FIELD_HEAD: 'wedyan-lounge-editor-field-head',
  FIELD_LABEL: 'wedyan-lounge-editor-field-label',
  INSTRUCTIONS: 'wedyan-lounge-instructions',
  EMPTY: 'wedyan-lounge-instructions-empty',
  FOOT: 'wedyan-lounge-editor-foot',
  SIDE: 'wedyan-lounge-side',
  CALLABLES: 'wedyan-lounge-callables',
};

/**
 * The open skill — a teacher, a scientist — on two panels. In the middle, what it is: its name,
 * what it's for in a line, and its instructions in Markdown, shown drawn or as their source as
 * Motions shows a script. On the right, exactly what it may call: the server tools and the desktop
 * actions, each to grant or take away. Every change is made to the skill itself, so the list
 * beside it sees it at once.
 */
export const SkillEditor = setup(() => {
  const session = loungeCtx.get() as LoungeSession;
  const skill = () => (session.path ? skillAt(session.path) : undefined);

  /**
   * Changes the open skill, while it's still on the drive, and marks when it changed.
   *
   * @param apply - What to change in it.
   */
  const change = (apply: (document: SkillFile) => void) => {
    const document = skill();
    if (document) edit(document, () => apply(document));
  };

  // What the fields edit: the skill's own values, read live and written straight back to it.
  const fields = {
    get name() {
      return skill()?.name ?? '';
    },
    set name(name: string) {
      change((document) => (document.name = name));
    },
    get description() {
      return skill()?.description ?? '';
    },
    set description(description: string) {
      change((document) => (document.description = description));
    },
    get instructions() {
      return skill()?.instructions ?? '';
    },
    set instructions(instructions: string) {
      change((document) => (document.instructions = instructions));
    },
    get tools() {
      return skill()?.tools ?? [];
    },
    set tools(chosen: string[]) {
      change((document) => (document.tools = chosen));
    },
    get actions() {
      return skill()?.actions ?? [];
    },
    set actions(chosen: string[]) {
      change((document) => (document.actions = chosen));
    },
  };

  // The instructions open drawn when there's something to read, and as their source when there's nothing yet.
  const view = mutable({ mode: $static(() => (skill()?.instructions ? 'preview' : 'edit')) });

  return () => (
    <Show
      when={skill}
      fallback={() => (
        <WindowPanel surface="solid" role="region" aria-label="Skill" className={CLASS.PANEL}>
          <EmptyState title="This skill is gone" description="It was deleted from Skills." level={3}>
            <EmptyState.Snippet for="icon">{() => <SkillIcon />}</EmptyState.Snippet>
          </EmptyState>
        </WindowPanel>
      )}
    >
      {() => (
        <>
          <WindowPanel surface="solid" role="region" aria-label="Skill" className={CLASS.PANEL}>
            <article className={CLASS.SKILL}>
              <header className={CLASS.HEAD}>
                <span className={CLASS.GLYPH} aria-hidden="true">
                  <SkillIcon />
                </span>
                <TextInput label="Name" placeholder="What you call it, e.g. Teacher" value={$bind(fields, 'name')} className={CLASS.NAME} />
              </header>
              <div className={CLASS.FIELD}>
                <span className={CLASS.FIELD_LABEL} aria-hidden="true">
                  What it's for
                </span>
                <TextInput
                  multiline
                  rows={2}
                  label="What it's for"
                  placeholder="In a line: Wedyan reads it to know when to use this skill."
                  value={$bind(fields, 'description')}
                />
              </div>
              <div className={CLASS.FIELD}>
                <div className={CLASS.FIELD_HEAD}>
                  <span className={CLASS.FIELD_LABEL} aria-hidden="true">
                    Instructions
                  </span>
                  <ToggleGroup aria-label="Show the instructions" size="sm" value={$bind(view, 'mode')} required>
                    <Toggle value="preview" variant="text" size="sm">
                      <PreviewIcon />
                      <span>Preview</span>
                    </Toggle>
                    <Toggle value="edit" variant="text" size="sm">
                      <EditIcon />
                      <span>Edit</span>
                    </Toggle>
                  </ToggleGroup>
                </div>
                <Snippet data={() => view.mode}>
                  {(mode) =>
                    mode === 'edit' ? (
                      <TextInput
                        multiline
                        rows={10}
                        label="Instructions, in Markdown"
                        placeholder="How to work as this skill, in Markdown."
                        value={$bind(fields, 'instructions')}
                        className={CLASS.INSTRUCTIONS}
                      />
                    ) : (
                      <Show when={() => fields.instructions} fallback={() => <p className={CLASS.EMPTY}>No instructions yet.</p>}>
                        {(text) => <MarkdownRenderer text={text} />}
                      </Show>
                    )
                  }
                </Snippet>
              </div>
              <footer className={CLASS.FOOT}>
                <ConfirmButton
                  size="sm"
                  variant="tonal"
                  title={() => `Delete ${fields.name || 'this skill'}?`}
                  description="It's taken off Skills."
                  action="Delete"
                  onconfirm={() => session.remove?.()}
                >
                  <DeleteIcon />
                  <span>Delete skill</span>
                </ConfirmButton>
              </footer>
            </article>
          </WindowPanel>
          <WindowPanel role="region" aria-label="What it may call" className={CLASS.SIDE}>
            <div className="wedyan-compose-properties-fields">
              <GenerationGroup label="Tools" card>
                {callables('Tools', CALLABLES.tools, fields, 'tools')}
              </GenerationGroup>
              <GenerationGroup label="Actions" card>
                {callables('Actions', CALLABLES.actions, fields, 'actions')}
              </GenerationGroup>
            </div>
          </WindowPanel>
        </>
      )}
    </Show>
  );
}, 'SkillEditor');

/**
 * What a skill may call of one kind, each to grant or take away: its name, and what it does under it.
 *
 * @param label - What the kind is called, for screen readers.
 * @param list - Everything of the kind a skill can be allowed.
 * @param fields - The skill's fields, which the choice is written back to.
 * @param key - Which of its lists it is.
 * @returns The choices.
 */
function callables(label: string, list: Callable[], fields: { tools: string[]; actions: string[] }, key: 'tools' | 'actions') {
  return (
    <CheckboxGroup label={label} value={$bind(fields, key)} className={CLASS.CALLABLES}>
      {list.map(({ name, hint }) => (
        <Choice key={name} value={name} title={name} hint={hint} />
      ))}
    </CheckboxGroup>
  );
}
