import { $bind, effect, setup, Show, template } from '@airlib/react';
import { Select, Stepper, StepperAdjuster, StepperInput, TextInput, Tooltip } from '@airlib/react-aui';
import { HeightIcon, OpacityIcon, RadiusIcon, RotateIcon, ScaleIcon, WidthIcon, XIcon, YIcon } from '../../icons.js';
import { type Composer, composerCtx, type Picked } from '../context.js';
import { type Group, Groups, KeyedLine } from './Groups.js';

/** The box's values in named groups, as the panel lays them out. */
const BOX_GROUPS: Group[] = [
  {
    label: 'Transform',
    fields: [
      { key: 'width', label: 'Width', icon: WidthIcon, step: 1, rate: 2, min: 0 },
      { key: 'height', label: 'Height', icon: HeightIcon, step: 1, rate: 2, min: 0 },
      { key: 'x', label: 'X', icon: XIcon, fallback: 0, step: 1, rate: 2 },
      { key: 'y', label: 'Y', icon: YIcon, fallback: 0, step: 1, rate: 2 },
      { key: 'scale', label: 'Scale', icon: ScaleIcon, fallback: 1, step: 0.05, min: 0, range: [0, 3] },
    ],
  },
  {
    label: 'Rotation',
    fields: [{ key: 'rotate', label: 'Rotation', icon: RotateIcon, fallback: 0, step: 1, rate: 2, range: [-180, 180] }],
  },
  {
    label: 'Opacity',
    fields: [
      { key: 'opacity', label: 'Opacity', icon: OpacityIcon, fallback: 1, step: 0.05, min: 0, max: 1, range: [0, 1] },
    ],
  },
];

/** What fills a box: on its own, with no relation to its corners. */
const FILL = { label: 'Fill', fields: [{ key: 'background' }] };

/** How round a box's corners are. */
const RADIUS = { label: 'Radius', fields: [{ key: 'borderRadius', step: 1 }] };

/** What can be picked as a picture: what the project holds that's drawn from one file. */
const PICTURE_KINDS = new Set(['image', 'still']);

/**
 * What's picked's box and how it moves, each value shown at the playhead; for what's HTML, how it's
 * filled and rounded, and which picture it shows when it's an image.
 */
export const LayerProperties = setup(() => {
  const composer = composerCtx.get() as Composer;
  const html = () => ((composer.pickedTrack() ?? composer.hostClip())?.type === 'html' ? composer.picked() : undefined);

  return () => (
    <div className="wedyan-compose-properties-fields">
      <Show when={() => (html()?.props.element === 'img' ? html() : undefined)}>
        {(image) => <PictureSource image={image} />}
      </Show>
      <Groups groups={BOX_GROUPS} />
      <Show when={html}>{(box) => <BoxStyle key={box.id} />}</Show>
    </div>
  );
}, 'LayerProperties');

/** Which of the project's pictures an image shows. It's the image's to manage, so it makes what holds that. */
const PictureSource = setup<{ image: Picked }>((props) => {
  const composer = composerCtx.get() as Composer;

  effect(() => {
    if (!props.image.props.attrs) {
      props.image.props.attrs = {};
    }
  });

  const options = () =>
    Object.fromEntries(
      composer.assets.filter((asset) => PICTURE_KINDS.has(asset.kind) && asset.src).map((asset) => [asset.src, asset.name]),
    );

  return ({ image: { props: values } }) => (
    <div className="wedyan-compose-property-row pis-sm">
      <span>Picture</span>
      <Select size="xs" label="Picture" placeholder="None" options={options()} value={$bind(values.attrs, 'src')} />
    </div>
  );
}, 'PictureSource');

/** How a box is filled and rounded, each keyed on its own. */
const BoxStyle = template(
  () => (
    <>
      <KeyedLine group={FILL}>
        {(value, edit) => <TextInput type="color" size="xs" value={value} onInput={edit} />}
      </KeyedLine>
      <KeyedLine group={RADIUS}>
        {(value, edit) => (
          <Stepper size="xs" label="Radius" step={1} min={0} value={value} onInput={edit}>
            <StepperAdjuster rate={2}>
              <RadiusIcon />
            </StepperAdjuster>
            <StepperInput aria-label="Radius" />
            <Tooltip>Radius</Tooltip>
          </Stepper>
        )}
      </KeyedLine>
    </>
  ),
  'BoxStyle',
);
