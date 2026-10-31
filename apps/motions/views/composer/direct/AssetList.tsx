import { $use, For, Show, setup } from '@airlib/react';
import { ListboxOption } from '@airlib/react-aui';
import { DirectRow, DirectSection } from '@/components/Direct.js';
import { ASSET_KINDS } from '@/lib/documents/rows.js';
import { SoundIcon } from '../../icons.js';
import { type Composer, composerCtx } from '../context.js';

/** What the project's stages are made from, while it has any. Picking one shows it. */
export const AssetList = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <Show when={() => composer.assets.length}>
      {() => (
        <DirectSection label="Assets">
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
      )}
    </Show>
  );
}, 'AssetList');
