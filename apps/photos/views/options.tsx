import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $static, For, Show, setup } from '@airlib/react';
import { Button, Divider, Select, Stepper, Toolbar, Tooltip } from '@airlib/react-aui';
import type { WindowRenderProps } from '@airlib/react-aui/desktop';
import { AspectRatioIcon, AutoAwesomeIcon } from '@airlib/react-aui/icons';
import { ASPECTS, MODELS, settingsOf } from '@/lib/documents/generation.js';
import { documentAt } from '@/lib/share/documents.js';
import { generation } from './making.js';
import type { StillData } from './Still.js';

/**
 * How the still project in front is made again, in the dock: its model, aspect ratio, and how many
 * images one request makes, written onto the still itself.
 */
export const StillOptions = setup<WindowRenderProps>((props) => {
  // A window shows one still for its whole life.
  const path = $static(() => (props.instance.data as StillData).still);

  return () => (
    <Show when={() => documentAt<'still'>(path)}>
      {(still) => {
        const settings = settingsOf(still);
        return (
          <Toolbar label="Still settings" variant="text" className={AUI_CLASS.TOOLBAR_OPTIONS}>
            <Select size="sm" label="Model" options={MODELS.still} value={$bind(settings, 'model')}>
              <Select.Snippet for="trigger">
                {(value) => (
                  <>
                    <AutoAwesomeIcon /> <span>{MODELS.still[value as string]}</span>
                  </>
                )}
              </Select.Snippet>
            </Select>
            <Select size="sm" label="Aspect ratio" options={ASPECTS} value={$bind(settings, 'aspect')}>
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
              label="Batch size"
              decrementLabel="Smaller batch"
              incrementLabel="Larger batch"
              min={1}
              max={4}
              value={$bind(settings, 'batch')}
            />
          </Toolbar>
        );
      }}
    </Show>
  );
}, 'StillOptions');

/**
 * What a prompt sent while the browser is in front is made with, in the dock. The pictures used as
 * references lead, each a thumbnail that's pressed to stop using it.
 */
export const BrowseOptions = setup(
  () => () => (
    <Toolbar label="Image settings" variant="text" className={AUI_CLASS.TOOLBAR_OPTIONS}>
      <For each={() => generation.references}>
        {(reference) => (
          <Button
            size="sm"
            variant="text"
            aria-label={`Stop using ${reference.name} as a reference`}
            className={`${AUI_CLASS.CONTROL_ICON} wedyan-photos-reference`}
            onClick={() => {
              generation.references = generation.references.filter(({ path }) => path !== reference.path);
            }}
          >
            <img src={reference.picture} alt="" />
            {/* The tooltip shows the picture larger, above it, with its name. */}
            <Tooltip yDir="above">
              <span className="wedyan-photos-reference-tip">
                <img src={reference.picture} alt="" />
                <span>{reference.name}</span>
              </span>
            </Tooltip>
          </Button>
        )}
      </For>
      <Show when={() => generation.references.length > 0}>{() => <Divider orientation="vertical" className="wedyan-photos-references-end" />}</Show>
      <Select size="sm" label="Model" options={MODELS.still} value={$bind(generation, 'model')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <AutoAwesomeIcon /> <span>{MODELS.still[value as string]}</span>
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
      <Stepper size="sm" label="Images" decrementLabel="Fewer images" incrementLabel="More images" min={1} max={4} value={$bind(generation, 'batch')} />
    </Toolbar>
  ),
  'BrowseOptions'
);
