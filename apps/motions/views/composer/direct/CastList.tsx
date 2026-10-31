import { $use, For, setup } from '@airlib/react';
import { ListboxOption } from '@airlib/react-aui';
import { DirectRow, DirectSection } from '@/components/Direct.js';
import { type Composer, composerCtx } from '../context.js';
import { AddCast } from './Adders.js';

/** Who's in the project, with a way to add someone. Picking one shows them, edited as Lounge edits a person. */
export const CastList = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <DirectSection label="Casts" action={() => <AddCast />}>
      <For each={() => composer.casts}>
        {(cast) => (
          <ListboxOption
            value={cast.path}
            selected={$use(() => composer.activeView === 'cast' && composer.activeCast === cast.path)}
            onchange={() => Object.assign(composer, { activeView: 'cast', activeCast: cast.path })}
            className="wedyan-direct-row"
          >
            <DirectRow title={cast.name} description={cast.description} picture={cast.thumbnail} />
          </ListboxOption>
        )}
      </For>
    </DirectSection>
  );
}, 'CastList');
