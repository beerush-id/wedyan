import { Snippet, setup, template } from '@airlib/react';
import { DescriptionList } from '@airlib/react-aui';
import { DirectContent } from '@/components/Direct.js';
import { GenerationForm } from '@/components/GenerationForm.js';
import { generationCtx } from '@/components/generation.js';
import { RenameField } from '@/components/RenameField.js';
import { addressAt, attemptPicture, chosenAttempt, PICTURE_FILE } from '@/lib/documents/generation.js';
import { ASSET_KINDS, type FileRow } from '@/lib/documents/rows.js';
import type { GenerativeDocument } from '@/lib/documents/types.js';
import { dfs } from '@/lib/share/dfs.js';
import { duration } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';

/** The picked asset: a generated one as its own document, otherwise the media itself, as it plays or shows. */
export const AssetView = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => {
    if (composer.activeView !== 'asset') return null;
    const asset = composer.activeAsset;
    if (!asset) return null;

    if (asset.kind === 'still' || asset.kind === 'take' || asset.kind === 'sound') {
      return (
        <DirectContent>
          <GeneratedAsset />
        </DirectContent>
      );
    }

    return (
      <DirectContent>
        <MediaView asset={asset} />
      </DirectContent>
    );
  };
}, 'AssetView');

/**
 * A generated asset, the same for whoever made it: the attempt it shows, as it plays, and the form
 * that says how it's made, with every attempt to choose from. With none yet, that's all there is.
 */
const GeneratedAsset = setup(() => {
  const composer = composerCtx.get() as Composer;

  generationCtx.set({
    get path() {
      return composer.generativeAsset()?.path;
    },
    get source() {
      return composer.generativeAsset()?.source;
    },
    get busy() {
      return composer.generating;
    },
    get pictures() {
      return composer.pictures;
    },
    generate() {
      const asset = composer.generativeAsset();
      if (asset) composer.generate(asset);
    },
    choose(id) {
      const asset = composer.generativeAsset();
      if (asset) asset.source.chosen = id;
    },
  });

  return () => (
    <article className="wedyan-direct-pane">
      <Snippet>
        {() => {
          const asset = composer.generativeAsset();
          return asset ? <AttemptShown path={asset.path} source={asset.source} /> : null;
        }}
      </Snippet>
      <GenerationForm />
    </article>
  );
}, 'GeneratedAsset');

/** The attempt a generated document shows: a picture, its footage, or its sound. */
const AttemptShown = template<{ path: string; source: GenerativeDocument }>(({ path, source }) => {
  const chosen = chosenAttempt(source);
  const src = chosen && addressAt(path, chosen.src);
  if (!src) return null;
  if (source.type === 'sound') return <audio className="wedyan-direct-hero" src={src} controls aria-label={source.name} />;
  if (PICTURE_FILE.test(src)) return <img className="wedyan-direct-hero" src={src} alt={source.name} />;
  // biome-ignore lint/a11y/useMediaCaption: a generated clip has no words to caption.
  return <video className="wedyan-direct-hero" src={src} poster={attemptPicture(path, source, chosen)} controls />;
}, 'AttemptShown');

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
