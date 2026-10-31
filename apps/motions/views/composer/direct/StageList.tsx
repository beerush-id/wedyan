import { $use, For, setup } from '@airlib/react';
import { ListboxOption } from '@airlib/react-aui';
import { DirectRow, DirectSection } from '@/components/Direct.js';
import { duration } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';
import { AddStage } from './Adders.js';

/**
 * The project's stages, in playing order, with a way to add one. No stage is read until it's picked,
 * which shows it and makes it the stage Compose opens.
 */
export const StageList = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <DirectSection label="Stages" action={() => <AddStage />}>
      <For each={() => composer.stages}>
        {(stage) => (
          <ListboxOption
            value={stage.path}
            selected={$use(() => composer.activeView === 'stage' && composer.activeStage === stage.path)}
            onchange={() => Object.assign(composer, { activeView: 'stage', activeStage: stage.path })}
            className="wedyan-direct-row"
          >
            <DirectRow title={stage.name} description={duration(stage.duration)} picture={stage.thumbnail ?? composer.motion?.cover} />
          </ListboxOption>
        )}
      </For>
    </DirectSection>
  );
}, 'StageList');
