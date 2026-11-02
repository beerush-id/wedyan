import { $bind, Snippet, template } from '@airlib/react';
import { Button, Select, Stepper } from '@airlib/react-aui';
import type { FC } from 'react';
import { asksSeconds, attemptPicture, chosenAttempt, MODELS, settingsOf, TIERED_MODELS } from '@/lib/documents/generation.js';
import { GenerativeIcon, ModelIcon } from '../../icons.js';
import { type Composer, composerCtx, type GenerativeSource } from '../context.js';

/** How a picked generated image or video is made again: the model, how long a video runs, and Generate. */
export const RegenerateOptions = template<{ generated: GenerativeSource }>(({ generated }) => {
  const composer = composerCtx.get() as Composer;
  const { source } = generated;
  const models = MODELS[source.type];
  const settings = settingsOf(source);

  return (
    <>
      <Select size="sm" label="Model" disabled={!TIERED_MODELS} options={models} value={$bind(settings, 'model')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <ModelIcon /> <span>{models[value as string]}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
      <Snippet>
        {() =>
          asksSeconds(source) && (
            <Stepper size="sm" label="Seconds" decrementLabel="Shorter" incrementLabel="Longer" min={2} max={10} value={$bind(settings, 'seconds')} />
          )
        }
      </Snippet>
      <Button size="sm" variant="filled" onClick={() => composer.generate(generated)}>
        <GenerativeIcon />
        <span>Generate</span>
      </Button>
    </>
  );
}, 'RegenerateOptions');

/** What the dock's options act on: a square tile, a picture or a glyph without one, named for screen readers. */
export const SubjectTile = template<{ name: string; picture?: string; glyph?: FC }>(
  ({ name, picture, glyph: Glyph }) => (
    <span role="img" aria-label={name} className="wedyan-motions-subject">
      {picture ? <img src={picture} alt="" /> : Glyph && <Glyph />}
    </span>
  ),
  'SubjectTile',
);

/** A generated document's tile: the picture of its chosen attempt, when it has one. */
export const GeneratedTile = template<{ generated: GenerativeSource }>(({ generated: { path, source } }) => (
  <SubjectTile name={source.name} picture={attemptPicture(path, source, chosenAttempt(source))} />
), 'GeneratedTile');
