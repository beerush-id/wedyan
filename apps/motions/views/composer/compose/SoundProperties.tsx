import { $bind, setup } from '@airlib/react';
import type { TimelineSegment } from '@airlib/react/timeline';
import { Switch } from '@airlib/react-aui';
import { BalanceIcon, VolumeIcon } from '../../icons.js';
import type { ClipSound } from '../composition.js';
import { type Group, Groups } from './Groups.js';

/** A clip's sound levels, each keyed on its own: how loud, and where between the speakers. */
const SOUND_GROUPS: Group[] = [
  {
    label: 'Volume',
    fields: [
      { key: 'volume', label: 'Volume', icon: VolumeIcon, fallback: 1, step: 0.05, min: 0, max: 1, range: [0, 1] },
    ],
  },
  {
    label: 'Balance',
    fields: [
      { key: 'pan', label: 'Balance', icon: BalanceIcon, fallback: 0, step: 0.05, min: -1, max: 1, range: [-1, 1] },
    ],
  },
];

/** The picked clip's sound: whether it's heard, then its volume and balance, keyed like its box. */
export const SoundProperties = setup<{ clip: TimelineSegment<ClipSound> }>(() => {
  return ({ clip: { props } }) => (
    <div className="wedyan-compose-properties-fields">
      <fieldset aria-label="Sound" className="wedyan-compose-property-group">
        <div className="wedyan-compose-property-head pis-sm">
          <span className="wedyan-compose-property-label" aria-hidden="true">
            Sound
          </span>
        </div>
        <div className="wedyan-compose-property-row pis-sm">
          <span id="wedyan-compose-mute">Mute</span>
          <Switch size="xs" aria-labelledby="wedyan-compose-mute" checked={$bind(props, 'muted')} />
        </div>
      </fieldset>
      <Groups groups={SOUND_GROUPS} />
    </div>
  );
}, 'SoundProperties');
