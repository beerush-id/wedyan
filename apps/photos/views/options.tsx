import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $static, For, mutable, Show, setup } from '@airlib/react';
import { Button, Divider, Select, Stepper, Toolbar, Tooltip } from '@airlib/react-aui';
import type { WindowRenderProps } from '@airlib/react-aui/desktop';
import { AspectRatioIcon, AutoAwesomeIcon } from '@airlib/react-aui/icons';
import { ASPECTS as STILL_ASPECTS, MODELS, settingsOf } from '@/lib/documents/generation.js';
import { documentAt } from '@/lib/documents/store.js';
import { byId } from './library.js';
import type { PhotosData } from './Main.js';

const ASPECTS = { '1:1': '1:1', '4:5': '4:5', '16:9': '16:9' };

/**
 * How Photos generates: set from the dock while Photos is in front, read when a prompt is sent.
 * `references` are the photos the next images start from, by id, in the order they were added.
 */
export const generation = mutable({ model: 'standard', aspect: '1:1', count: 1, references: [] as string[] });

/**
 * Photos' options in the dock, for the window in front: in a still project's window, how that
 * still is made again — the same settings its panel shows — and in the browser, what a prompt sent
 * while it's in front is made with.
 */
export const PhotosDockOptions = setup<WindowRenderProps>((props) => {
  // A window opened on a still project shows that project for its whole life.
  const still = $static(() => (props.instance.data as PhotosData)?.still);
  return () => (still ? <StillOptions path={still} /> : <BrowseOptions />);
}, 'PhotosDockOptions');

/**
 * How the still project in front is made again: its model, aspect ratio, and how many images one
 * request makes, written onto the still itself.
 */
const StillOptions = setup<{ path: string }>((props) => {
  const source = $static(() => documentAt<'still'>(props.path));
  const settings = source && settingsOf(source);

  return () =>
    settings ? (
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
        <Select size="sm" label="Aspect ratio" options={STILL_ASPECTS} value={$bind(settings, 'aspect')}>
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
    ) : null;
}, 'StillOptions');

/**
 * What a prompt sent while the browser is in front is made with. The photos used as references
 * lead, each a thumbnail that's pressed to stop using it.
 */
const BrowseOptions = setup(() => () => (
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
), 'BrowseOptions');
