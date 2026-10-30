import { $bind, $use, For, Show, Snippet, template } from '@airlib/react';
import { Button, List, ListItem, NumberStepper, Radio, RadioGroup, Switch, TextInput } from '@airlib/react-aui';
import { PreviewIcon } from './icons.js';
import { SettingsGroup, SettingsRow, descriptionOf } from './parts.js';
import { assistantName, DEFAULT_ASSISTANT_NAME, minutes, profile, tryIdle, VOICES } from './profile.js';

const CLASS = {
  VOICES: 'wedyan-settings-voices',
  VOICE: 'wedyan-settings-voice',
  VOICE_TEXT: 'wedyan-settings-voice-text',
  VOICE_DESCRIPTION: 'wedyan-settings-voice-description',
  MINUTES: 'wedyan-settings-minutes',
  NONE: 'wedyan-settings-none',
};

const ID = {
  NAME: 'wedyan-settings-assistant-name',
  VOICE: 'wedyan-settings-voice',
  PROACTIVE: 'wedyan-settings-proactive',
  PERSONA: 'wedyan-settings-persona',
  REFINEMENTS: 'wedyan-settings-refinements',
  IDLE: 'wedyan-settings-idle-after',
  BRIEF: 'wedyan-settings-brief-after',
  TRY: 'wedyan-settings-try-idle',
};

/** The assistant's name, live, inside the page's words. */
const Name = () => <Snippet>{assistantName}</Snippet>;

/**
 * General: the assistant — what it's called and sounds like, how it works with the user, and how it
 * notices them stepping away and catches them up when they're back.
 */
export const GeneralPage = template(
  () => (
    <>
      <SettingsGroup title="Assistant">
        <SettingsRow label="Name" labelId={ID.NAME} description="What you call it, and what it calls itself.">
          <TextInput
            aria-labelledby={ID.NAME}
            aria-describedby={descriptionOf(ID.NAME)}
            placeholder={DEFAULT_ASSISTANT_NAME}
            value={$bind(profile, 'assistantName')}
          />
        </SettingsRow>
        <SettingsRow label="Voice" labelId={ID.VOICE} description={<>How <Name /> sounds when it speaks.</>} stacked>
          <RadioGroup aria-labelledby={ID.VOICE} name={ID.VOICE} value={$bind(profile, 'voice')} className={CLASS.VOICES}>
            {VOICES.map((voice) => (
              <div key={voice.value} className={CLASS.VOICE}>
                <Radio value={voice.value}>
                  <span className={CLASS.VOICE_TEXT}>
                    <span>{voice.label}</span>
                    <span className={CLASS.VOICE_DESCRIPTION}>{voice.description}</span>
                  </span>
                </Radio>
                <Button size="sm" variant="text" aria-label={`Preview ${voice.label}`}>
                  <PreviewIcon />
                  <span>Preview</span>
                </Button>
              </div>
            ))}
          </RadioGroup>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Behavior">
        <SettingsRow
          label="Raise what I may have missed"
          labelId={ID.PROACTIVE}
          description={<>When your words could also answer something earlier, <Name /> asks whether they do.</>}
        >
          <Switch aria-labelledby={ID.PROACTIVE} aria-describedby={descriptionOf(ID.PROACTIVE)} checked={$bind(profile, 'proactive')} />
        </SettingsRow>
        <SettingsRow label="How it behaves" labelId={ID.PERSONA} description="In your own words: its manner, its pace, what it leaves out." stacked>
          <TextInput
            multiline
            rows={3}
            aria-labelledby={ID.PERSONA}
            aria-describedby={descriptionOf(ID.PERSONA)}
            placeholder="Warm and brief. Gets to the point first."
            value={$bind(profile, 'persona')}
          />
        </SettingsRow>
        <SettingsRow label="What you've asked it to change" labelId={ID.REFINEMENTS} description="Corrections you gave along the way, kept as you said them." stacked>
          <Show
            when={() => profile.refinements?.length}
            fallback={() => (
              <p className={CLASS.NONE}>
                Nothing yet. Tell <Name /> how to do better, and it shows up here.
              </p>
            )}
          >
            {() => (
              <List aria-labelledby={ID.REFINEMENTS} size="sm">
                <For each={() => profile.refinements ?? []}>{(refinement) => <ListItem title={refinement} />}</For>
              </List>
            )}
          </Show>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Idle" anchor="idle" description={<>When you step away and come back, <Name /> catches you up on what happened.</>}>
        <SettingsRow label="Count me away after" labelId={ID.IDLE} description="Minutes without typing, clicking or moving the pointer.">
          <span className={CLASS.MINUTES}>
            <NumberStepper
              aria-labelledby={ID.IDLE}
              aria-describedby={descriptionOf(ID.IDLE)}
              min={1}
              step={1}
              valuetext={$use(() => minutesOf(minutes.idleAfter))}
              value={$bind(minutes, 'idleAfter')}
            />
            <span aria-hidden="true">min</span>
          </span>
        </SettingsRow>
        <SettingsRow label="Catch me up after" labelId={ID.BRIEF} description="Minutes away before you're caught up on your return. 0 catches you up every time.">
          <span className={CLASS.MINUTES}>
            <NumberStepper
              aria-labelledby={ID.BRIEF}
              aria-describedby={descriptionOf(ID.BRIEF)}
              min={0}
              step={1}
              valuetext={$use(() => minutesOf(minutes.briefAfter))}
              value={$bind(minutes, 'briefAfter')}
            />
            <span aria-hidden="true">min</span>
          </span>
        </SettingsRow>
        <SettingsRow label="See how it works" labelId={ID.TRY} description="Counts you away after 1 minute and catches you up every time. Step away, then come back.">
          <Button size="sm" variant="tonal" aria-describedby={descriptionOf(ID.TRY)} onClick={tryIdle}>
            Try it now
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </>
  ),
  'GeneralPage'
);

/**
 * A duration in minutes as it's read aloud.
 *
 * @param count - How many minutes.
 * @returns E.g. `1 minute` or `5 minutes`.
 */
function minutesOf(count: number): string {
  return count === 1 ? '1 minute' : `${count} minutes`;
}
