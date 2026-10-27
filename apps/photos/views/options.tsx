import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, For, mutable, Show, setup } from '@airlib/react';
import { Button, Divider, Select, Stepper, Toolbar, Tooltip } from '@airlib/react-aui';
import { AspectRatioIcon, AutoAwesomeIcon } from '@airlib/react-aui/icons';
import { byId } from './library.js';

const MODELS = { standard: 'Standard', detailed: 'Detailed' };
const ASPECTS = { '1:1': '1:1', '4:5': '4:5', '16:9': '16:9' };

/**
 * How Photos generates: set from the dock while Photos is in front, read when a prompt is sent.
 * `references` are the photos the next images start from, by id, in the order they were added.
 */
export const generation = mutable({ model: 'standard', aspect: '1:1', count: 1, references: [] as string[] });

/**
 * Photos' options in the dock: what a prompt sent while Photos is in front is made with. The
 * photos used as references lead, each a thumbnail that's pressed to stop using it.
 */
export const PhotosDockOptions = setup(() => () => (
  <Toolbar label="Image settings" variant="text" className={AUI_CLASS.TOOLBAR_OPTIONS}>
    <For each={() => byId(generation.references)}>
      {(photo) => (
        <Button
          size="sm"
          variant="text"
          aria-label={`Stop using ${photo.name} as a reference`}
          className={`${AUI_CLASS.CONTROL_ICON} wedyan-photos-reference`}
          onClick={() => {
            generation.references = generation.references.filter((id) => id !== photo.id);
          }}
        >
          <img src={photo.src} alt="" />
          {/* The tooltip shows the photo larger, above it, with its name. */}
          <Tooltip yDir="above">
            <span className="wedyan-photos-reference-tip">
              <img src={photo.src} alt="" />
              <span>{photo.name}</span>
            </span>
          </Tooltip>
        </Button>
      )}
    </For>
    <Show when={() => byId(generation.references).length > 0}>
      {() => <Divider orientation="vertical" className="wedyan-photos-references-end" />}
    </Show>
    <Select size="sm" label="Model" options={MODELS} value={$bind(generation, 'model')}>
      <Select.Snippet for="trigger">
        {(value) => (
          <>
            <AutoAwesomeIcon /> <span>{MODELS[value as keyof typeof MODELS]}</span>
          </>
        )}
      </Select.Snippet>
    </Select>
    <Select size="sm" label="Aspect ratio" options={ASPECTS} value={$bind(generation, 'aspect')}>
      <Select.Snippet for="trigger">
        {(value) => (
          <>
            <AspectRatioIcon /> <span>{value as string}</span>
          </>
        )}
      </Select.Snippet>
    </Select>
    <Stepper
      size="sm"
      label="Images"
      decrementLabel="Fewer images"
      incrementLabel="More images"
      min={1}
      max={4}
      value={$bind(generation, 'count')}
    />
  </Toolbar>
), 'PhotosDockOptions');
