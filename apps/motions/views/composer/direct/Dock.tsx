import { AUI_CLASS } from '@airlib/aui/utils';
import { Show, Snippet, setup } from '@airlib/react';
import { Toolbar } from '@airlib/react-aui';
import { WorkOptions } from '../../WorkOptions.js';
import { type Composer, composerCtx } from '../context.js';
import { GeneratedTile, RegenerateOptions } from '../dock/Regenerate.js';

/** Direct's options in the dock: who works on the script, or how the picked generated asset is made again. */
export const DirectDock = setup(() => {
  const composer = composerCtx.get() as Composer;
  const scriptShown = () => {
    if (composer.activeView === 'overview') return composer.motion?.script;
    if (composer.activeView === 'stage') return composer.stage?.script;
  };
  const generated = () => (composer.activeView === 'asset' ? composer.generativeAsset() : undefined);

  return () => (
    <Show when={() => scriptShown() || generated()}>
      {() => (
        <Toolbar label="Motion settings" variant="text" className={AUI_CLASS.TOOLBAR_OPTIONS}>
          <Show when={scriptShown}>{() => <WorkOptions />}</Show>
          <Snippet data={generated}>{(asset) => (asset ? <RegenerateOptions generated={asset} /> : null)}</Snippet>
        </Toolbar>
      )}
    </Show>
  );
}, 'DirectDock');

/** What Direct's options act on: the picked generated asset. */
export const DirectSubject = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => {
    if (composer.activeView !== 'asset') return null;
    const generated = composer.generativeAsset();
    return generated ? <GeneratedTile generated={generated} /> : null;
  };
}, 'DirectSubject');

