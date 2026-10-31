import { $use, For, setup } from '@airlib/react';
import { ListboxOption } from '@airlib/react-aui';
import { DirectRow, DirectSection } from '@/components/Direct.js';
import { castPicture, castsOf } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';
import { AddCast } from './Adders.js';

/** Everyone the project's stages name, with a way to add someone. Picking one shows them, edited as Lounge edits a person. */
export const CastList = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <DirectSection label="Casts" action={() => <AddCast />}>
      <For each={() => (composer.project ? castsOf(composer.project) : [])}>
        {({ path, document }) => (
          <ListboxOption
            value={path}
            selected={$use(() => composer.activeView === 'cast' && composer.activeCast === path)}
            onchange={() => Object.assign(composer, { activeView: 'cast', activeCast: path })}
            className="wedyan-direct-row"
          >
            <DirectRow title={document.name} description={document.description ?? `${document.kind[0].toUpperCase()}${document.kind.slice(1)}`} picture={castPicture(path)} />
          </ListboxOption>
        )}
      </For>
    </DirectSection>
  );
}, 'CastList');
