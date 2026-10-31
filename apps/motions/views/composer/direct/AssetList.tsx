import { $use, For, setup } from '@airlib/react';
import { ListboxOption } from '@airlib/react-aui';
import { DirectRow, DirectSection } from '@/components/Direct.js';
import { ASSET_KINDS } from '@/lib/documents/rows.js';
import { SoundIcon } from '../../icons.js';
import { type Composer, composerCtx } from '../context.js';
import { AddAsset } from './Adders.js';

/** What the project's stages are made from, with a way to upload more. Picking one shows it. */
export const AssetList = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <DirectSection label="Assets" action={() => <AddAsset />}>
      <For each={() => composer.assets}>
        {(asset) => (
          <ListboxOption
            value={asset.path}
            selected={$use(() => composer.activeView === 'asset' && composer.activeAsset?.path === asset.path)}
            onchange={() => Object.assign(composer, { activeView: 'asset', activeAsset: asset })}
            className="wedyan-direct-row"
          >
            <DirectRow title={asset.name} description={ASSET_KINDS[asset.kind]} picture={asset.thumbnail} icon={SoundIcon} />
          </ListboxOption>
        )}
      </For>
    </DirectSection>
  );
}, 'AssetList');
