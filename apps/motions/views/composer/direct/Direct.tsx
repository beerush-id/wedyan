import { $use, Show, setup } from '@airlib/react';
import { ListboxOption } from '@airlib/react-aui';
import { DirectPanel, DirectRow, DirectSection } from '@/components/Direct.js';
import { type Composer, composerCtx } from '../context.js';
import { AssetList } from './AssetList.js';
import { AssetView } from './AssetView.js';
import { CastList } from './CastList.js';
import { CastView } from './CastView.js';
import { OverviewView } from './OverviewView.js';
import { StageList } from './StageList.js';
import { StageView } from './StageView.js';

/**
 * Direct: a project's writing and everything around it. Down the side, a list of what it holds;
 * beside it, what's picked, shown in full. A row states what's picked on the composer, and the view
 * of its kind shows it.
 */
export const Direct = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <div className="wedyan-direct">
      <Show when={() => composer.sidebar}>
        {() => (
          <DirectPanel label="Project" listLabel="What the project holds">
            {/* The window's title names the project; its row says what it shows. */}
            <DirectSection label="Project">
              <ListboxOption
                value="overview"
                selected={$use(() => composer.activeView === 'overview')}
                onchange={() => (composer.activeView = 'overview')}
                className="wedyan-direct-row"
              >
                <DirectRow title="Overview" description={composer.motion?.description} picture={composer.motion?.cover} />
              </ListboxOption>
            </DirectSection>
            <StageList />
            <AssetList />
            <CastList />
          </DirectPanel>
        )}
      </Show>
      <OverviewView />
      <StageView />
      <AssetView />
      <CastView />
    </div>
  );
}, 'Direct');
