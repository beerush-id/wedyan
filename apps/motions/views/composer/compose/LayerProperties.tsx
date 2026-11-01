import { template } from '@airlib/react';
import { HeightIcon, OpacityIcon, RotateIcon, ScaleIcon, WidthIcon, XIcon, YIcon } from '../../icons.js';
import { type Group, Groups } from './Groups.js';

/** The box's values in named groups, as the panel lays them out. */
const BOX_GROUPS: Group[] = [
  {
    label: 'Transform',
    fields: [
      { key: 'width', label: 'Width', icon: WidthIcon, step: 1, min: 0 },
      { key: 'height', label: 'Height', icon: HeightIcon, step: 1, min: 0 },
      { key: 'x', label: 'X', icon: XIcon, fallback: 0, step: 1 },
      { key: 'y', label: 'Y', icon: YIcon, fallback: 0, step: 1 },
      { key: 'scale', label: 'Scale', icon: ScaleIcon, fallback: 1, step: 0.05, min: 0, range: [0, 3] },
    ],
  },
  {
    label: 'Rotation',
    fields: [{ key: 'rotate', label: 'Rotation', icon: RotateIcon, fallback: 0, step: 1, range: [-180, 180] }],
  },
  {
    label: 'Opacity',
    fields: [
      { key: 'opacity', label: 'Opacity', icon: OpacityIcon, fallback: 1, step: 0.05, min: 0, max: 1, range: [0, 1] },
    ],
  },
];

/** The picked clip's box and how it moves, each value shown at the playhead. */
export const LayerProperties = template(() => <Groups groups={BOX_GROUPS} />, 'LayerProperties');
