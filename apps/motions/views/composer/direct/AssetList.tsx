import { $use, For, Show, setup } from '@airlib/react';
import { ListboxOption } from '@airlib/react-aui';
import { DirectRow, DirectSection } from '@/components/Direct.js';
import { SoundIcon } from '../../icons.js';
import { pictureOf } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';
import { ASSET_KINDS } from './AssetView.js';

/** What the project's stages are made from, while it has any. Picking one shows it. */
export const AssetList = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <Show when={() => composer.motion?.assets.length}>
      {() => (
        <DirectSection label="Assets">
          <For each={() => composer.motion?.assets ?? []}>
            {(asset) => (
              <ListboxOption
                value={asset.id}
                selected={$use(() => composer.activeView === 'asset' && composer.activeAsset === asset)}
                onchange={() => Object.assign(composer, { activeView: 'asset', activeAsset: asset })}
                className="wedyan-direct-row"
              >
                <DirectRow title={asset.name} description={ASSET_KINDS[asset.kind]} picture={pictureOf(composer.path, asset)} icon={SoundIcon} />
              </ListboxOption>
            )}
          </For>
        </DirectSection>
      )}
    </Show>
  );
}, 'AssetList');
