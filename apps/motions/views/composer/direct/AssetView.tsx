import { setup, template } from '@airlib/react';
import { DescriptionList } from '@airlib/react-aui';
import { DirectContent } from '@/components/Direct.js';
import type { MotionAsset, StillDocument, TakeDocument } from '@/lib/documents/types.js';
import { documentAt } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';
import { StillView } from './StillView.js';

/** What each kind of asset is called. */
export const ASSET_KINDS: Record<MotionAsset['kind'], string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  still: 'Generated image',
  take: 'Generated video',
};

/** The picked asset: a generated one as its own document, otherwise the media itself, as it plays or shows. */
export const AssetView = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => {
    if (composer.activeView !== 'asset') return null;
    const asset = composer.activeAsset;
    if (!asset) return null;

    const generated = asset.kind === 'still' || asset.kind === 'take' ? documentAt(composer.pathOf(asset.src)) : undefined;
    if (generated?.type === 'still') {
      return (
        <DirectContent>
          <StillView document={generated as StillDocument} />
        </DirectContent>
      );
    }
    if (generated?.type === 'take') {
      return (
        <DirectContent>
          <TakeView take={generated as TakeDocument} />
        </DirectContent>
      );
    }

    return (
      <DirectContent>
        <MediaView asset={asset} src={asset.src.includes('://') ? asset.src : composer.pathOf(asset.src)} />
      </DirectContent>
    );
  };
}, 'AssetView');

/** A generated video: its chosen attempt, and how it was asked for. */
const TakeView = template<{ take: TakeDocument }>(({ take }) => {
  const chosen = take.attempts.find((attempt) => attempt.id === take.chosen);
  return (
    <article className="wedyan-direct-pane">
      <video className="wedyan-direct-hero" src={chosen?.src} poster={chosen?.poster} controls />
      <header className="wedyan-direct-heading">
        <h2>{take.name}</h2>
        <p>{chosen?.prompt ?? take.prompt}</p>
      </header>
    </article>
  );
}, 'TakeView');

/** An image, a video or a sound, as it shows or plays, with what it is and where it's from. */
const MediaView = template<{ asset: MotionAsset; src: string }>(({ asset, src }) => (
  <article className="wedyan-direct-pane">
    {asset.kind === 'image' && <img className="wedyan-direct-hero" src={src} alt="" />}
    {asset.kind === 'video' && <video className="wedyan-direct-hero" src={src} controls />}
    {asset.kind === 'audio' && <audio src={src} controls />}
    <header className="wedyan-direct-heading">
      <h2>{asset.name}</h2>
    </header>
    <DescriptionList
      size="sm"
      items={[
        { label: 'Kind', value: ASSET_KINDS[asset.kind] },
        { label: 'From', value: asset.src },
      ]}
    />
  </article>
), 'MediaView');
