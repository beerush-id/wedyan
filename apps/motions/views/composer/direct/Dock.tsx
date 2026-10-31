import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, mutable, Show, Snippet, setup, template } from '@airlib/react';
import { Select, Toolbar } from '@airlib/react-aui';
import { WRITING_MODELS } from '@/lib/documents/generation.js';
import { EffortIcon, ModelIcon } from '../../icons.js';
import { type Composer, composerCtx } from '../context.js';
import { GeneratedTile, RegenerateOptions } from '../dock/Regenerate.js';

const EFFORTS = { low: 'Low effort', medium: 'Medium effort', high: 'High effort' };

/**
 * How the script is written: set from the dock while one shows, read when a prompt is sent. The
 * models are placeholders until the kernel names its own.
 */
export const writing = mutable({ model: 'balanced', effort: 'medium' });

/** Direct's options in the dock: how the script is written, or how the picked generated asset is made again. */
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
          <Show when={scriptShown}>{() => <WritingOptions />}</Show>
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
    return generated ? <GeneratedTile source={generated.source} /> : null;
  };
}, 'DirectSubject');

/** How the script is written: which model writes it, and how hard it thinks. */
const WritingOptions = template(
  () => (
    <>
      <Select size="sm" label="Model" options={WRITING_MODELS} value={$bind(writing, 'model')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <ModelIcon /> <span>{WRITING_MODELS[value as keyof typeof WRITING_MODELS]}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
      <Select size="sm" label="Reasoning effort" options={EFFORTS} value={$bind(writing, 'effort')}>
        <Select.Snippet for="trigger">
          {(value) => (
            <>
              <EffortIcon /> <span>{EFFORTS[value as keyof typeof EFFORTS]}</span>
            </>
          )}
        </Select.Snippet>
      </Select>
    </>
  ),
  'WritingOptions',
);
