import { setup, template } from '@airlib/react';
import { DescriptionList } from '@airlib/react-aui';
import { DirectContent } from '@/components/Direct.js';
import { RenameField } from '@/components/RenameField.js';
import { ASSET_KINDS, type FileRow } from '@/lib/documents/rows.js';
import type { StillDocument, TakeDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { documentAt, duration } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';
import { StillView } from './StillView.js';

/** The picked asset: a generated one as its own document, otherwise the media itself, as it plays or shows. */
export const AssetView = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => {
    if (composer.activeView !== 'asset') return null;
    const asset = composer.activeAsset;
    if (!asset) return null;

    if (asset.kind === 'still') {
      const still = documentAt<'still'>(asset.path);
      return <DirectContent>{still && <StillView document={still as StillDocument} />}</DirectContent>;
    }
    if (asset.kind === 'take') {
      const take = documentAt<'take'>(asset.path);
      return <DirectContent>{take && <TakeView take={take as TakeDocument} />}</DirectContent>;
    }

    return (
      <DirectContent>
        <MediaView asset={asset} />
      </DirectContent>
    );
  };
}, 'AssetView');

/** A generated video: its chosen attempt, and how it was asked for. */
const TakeView = template<{ take: TakeDocument }>(({ take }) => {
  const chosen = take.attempts.find((attempt) => attempt.id === take.chosen);
  return (
    <article className="wedyan-direct-pane">
      {/* biome-ignore lint/a11y/useMediaCaption: a generated clip has no words to caption. */}
      <video className="wedyan-direct-hero" src={chosen?.src} poster={chosen?.poster} controls />
      <header className="wedyan-direct-heading">
        <h2>{take.name}</h2>
        <p>{chosen?.prompt ?? take.prompt}</p>
      </header>
    </article>
  );
}, 'TakeView');

/** An image, a video or a sound, as it shows or plays, with what it is. */
const MediaView = template<{ asset: FileRow }>(({ asset }) => (
  <article className="wedyan-direct-pane">
    {asset.kind === 'image' && <img className="wedyan-direct-hero" src={asset.src} alt="" />}
    {/* biome-ignore lint/a11y/useMediaCaption: an uploaded video comes with no captions to show. */}
    {asset.kind === 'video' && <video className="wedyan-direct-hero" src={asset.src} poster={asset.thumbnail} controls />}
    {/* biome-ignore lint/a11y/useMediaCaption: an uploaded sound comes with no captions to show. */}
    {asset.kind === 'audio' && <audio src={asset.src} controls />}
    <RenameField key={asset.path} name={asset.name} onrename={(title) => void dfs.update(asset.path, { metadata: { title } })} />
    <DescriptionList
      size="sm"
      items={[
        { label: 'Kind', value: ASSET_KINDS[asset.kind] ?? asset.kind },
        ...(asset.duration ? [{ label: 'Length', value: duration(asset.duration) }] : []),
      ]}
    />
  </article>
), 'MediaView');
