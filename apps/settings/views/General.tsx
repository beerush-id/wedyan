import { $bind, $use, Snippet, setup } from '@airlib/react';
import { Button, NumberStepper, Radio, RadioGroup, Slider, Spinner, Switch, TextInput, Toggle, ToggleGroup } from '@airlib/react-aui';
import { type Theme, themeCtx } from '@/lib/systems/theme.js';
import { PreviewIcon } from './icons.js';
import { SettingsGroup, SettingsRow, descriptionOf } from './parts.js';
import { DEFAULT_ASSISTANT_NAME, type SettingsFiles, settingsCtx, VOICES } from './profile.js';

const CLASS = {
  VOICES: 'wedyan-settings-voices',
  VOICE: 'wedyan-settings-voice',
  VOICE_TEXT: 'wedyan-settings-voice-text',
  VOICE_DESCRIPTION: 'wedyan-settings-voice-description',
  RATE: 'wedyan-settings-rate',
  RATE_VALUE: 'wedyan-settings-rate-value',
  MINUTES: 'wedyan-settings-minutes',
};

const ID = {
  THEME: 'wedyan-settings-theme',
  NAME: 'wedyan-settings-assistant-name',
  VOICE: 'wedyan-settings-voice',
  RATE: 'wedyan-settings-speech-rate',
  PROACTIVE: 'wedyan-settings-proactive',
  PERSONA: 'wedyan-settings-persona',
  IDLE: 'wedyan-settings-idle-after',
  BRIEF: 'wedyan-settings-brief-after',
  TRY: 'wedyan-settings-try-idle',
};

/** How far the speed goes, and in what steps. */
const RATES = { min: 0.75, max: 1.5, step: 0.05 };

/**
 * General: how the desktop looks, then the assistant — what it's called and sounds like, how it
 * works with the user, and how it notices them stepping away and catches them up when they're back.
 */
export const GeneralPage = setup(() => {
  const files = settingsCtx.get() as SettingsFiles;
  const { shown, assistantName, tryIdle, previewing, preview } = files;
  const theme = themeCtx.get() as Theme;

  /** The assistant's name, live, inside the page's words. */
  const Name = () => <Snippet>{assistantName}</Snippet>;

  return () => (
    <>
      <SettingsGroup title="Appearance">
        <SettingsRow label="Theme" labelId={ID.THEME} description="Light or dark, or as your device is set.">
          <ToggleGroup aria-labelledby={ID.THEME} aria-describedby={descriptionOf(ID.THEME)} value={$bind(theme, 'mode')} required size="sm">
            <Toggle value="system" size="sm">
              System
            </Toggle>
            <Toggle value="light" size="sm">
              Light
            </Toggle>
            <Toggle value="dark" size="sm">
              Dark
            </Toggle>
          </ToggleGroup>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Assistant">
        <SettingsRow label="Name" labelId={ID.NAME} description="What you call it, and what it calls itself.">
          <TextInput
            aria-labelledby={ID.NAME}
            aria-describedby={descriptionOf(ID.NAME)}
            placeholder={DEFAULT_ASSISTANT_NAME}
            value={$bind(files.settings, 'assistantName')}
          />
        </SettingsRow>
        <div hidden>
          <SettingsRow label="Voice" labelId={ID.VOICE} description={<>How <Name /> sounds when it speaks.</>} stacked>
            <RadioGroup aria-labelledby={ID.VOICE} name={ID.VOICE} value={$bind(shown, 'voice')} className={CLASS.VOICES} disabled>
              {VOICES.map((voice) => (
                <div key={voice.value} className={CLASS.VOICE}>
                  <Radio value={voice.value}>
                    <span className={CLASS.VOICE_TEXT}>
                      <span>{voice.label}</span>
                      <span className={CLASS.VOICE_DESCRIPTION}>{voice.description}</span>
                    </span>
                  </Radio>
                  <Button size="sm" variant="text" aria-label={`Preview ${voice.label}`} disabled onClick={() => void preview(voice.value)}>
                    <Snippet>{() => (previewing.voice === voice.value ? <Spinner size="sm" label={`Previewing ${voice.label}`} /> : <PreviewIcon />)}</Snippet>
                    <span>Preview</span>
                  </Button>
                </div>
              ))}
            </RadioGroup>
          </SettingsRow>
        </div>
        <SettingsRow label="Speed" labelId={ID.RATE} description={<>How fast <Name /> speaks.</>}>
          <span className={CLASS.RATE}>
            <Slider
              size="sm"
              aria-labelledby={ID.RATE}
              aria-describedby={descriptionOf(ID.RATE)}
              min={RATES.min}
              max={RATES.max}
              step={RATES.step}
              valuetext={rateOf}
              value={$bind(shown, 'speechRate')}
            />
            <span className={CLASS.RATE_VALUE}>
              <Snippet>{() => rateOf(shown.speechRate)}</Snippet>
            </span>
          </span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Behavior">
        <SettingsRow
          label="Ask what my words answer"
          labelId={ID.PROACTIVE}
          description={<>When your words could also answer something earlier, <Name /> asks whether they do.</>}
        >
          <Switch aria-labelledby={ID.PROACTIVE} aria-describedby={descriptionOf(ID.PROACTIVE)} checked={$bind(shown, 'proactive')} />
        </SettingsRow>
        <SettingsRow label="How it behaves" labelId={ID.PERSONA} description="In your own words: its manner, its pace, what it leaves out." stacked>
          <TextInput
            multiline
            rows={3}
            aria-labelledby={ID.PERSONA}
            aria-describedby={descriptionOf(ID.PERSONA)}
            placeholder="Warm and brief. Gets to the point first."
            value={$bind(files.settings, 'persona')}
          />
        </SettingsRow>
      </SettingsGroup>

      <div hidden>
        <SettingsGroup title="Idle" anchor="idle" description={<>When you step away and come back, <Name /> catches you up on what happened.</>}>
          <SettingsRow label="Count me away after" labelId={ID.IDLE} description="Minutes without typing, clicking or moving the pointer.">
            <span className={CLASS.MINUTES}>
              <NumberStepper
                aria-labelledby={ID.IDLE}
                aria-describedby={descriptionOf(ID.IDLE)}
                min={1}
                step={1}
                valuetext={$use(() => minutesOf(shown.idleAfter))}
                value={$bind(shown, 'idleAfter')}
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
                valuetext={$use(() => minutesOf(shown.briefAfter))}
                value={$bind(shown, 'briefAfter')}
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
      </div>
    </>
  );
}, 'GeneralPage');

/**
 * A speech rate as it's shown and read aloud.
 *
 * @param rate - The multiple of the voice's own pace.
 * @returns E.g. `1.25×`.
 */
function rateOf(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

/**
 * A duration in minutes as it's read aloud.
 *
 * @param count - How many minutes.
 * @returns E.g. `1 minute` or `5 minutes`.
 */
function minutesOf(count: number): string {
  return count === 1 ? '1 minute' : `${count} minutes`;
}
