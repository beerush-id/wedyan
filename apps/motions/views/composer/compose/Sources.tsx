import { $bind, mutable, setup } from '@airlib/react';
import { ContextMenu, EmptyState, type GalleryValue, TabButton, TabList, TabPanel, Tabs } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import type { DragEvent } from 'react';
import { WedyanGallery, type WedyanGalleryEntry } from '@/components/WedyanGallery.js';
import type { FileRow, RowKind } from '@/lib/documents/rows.js';
import { type Composer, composerCtx } from '../context.js';
import { ASSET_DRAG, placeOnStage } from '../placement.js';

/** The asset kinds drawn on the stage, as against sound. */
const PICTURE_KINDS = new Set<RowKind>(['image', 'still', 'video', 'take']);

/** What a tile's menu does with its asset. */
const TILE_COMMANDS = [{ name: 'place', label: 'Add to timeline' }];

/**
 * What a stage can be made from, narrowed by kind: everything, or only its pictures and footage, its
 * sound, or its casts. An asset drags onto a track of the timeline, its menu puts it at the playhead,
 * and a generated one opens in Direct on a double click.
 */
export const Sources = setup(() => {
  const composer = composerCtx.get() as Composer;
  const view = mutable({ picked: null as GalleryValue });

  const assets = () => composer.assets;
  const assetOf = (path: unknown) => assets().find((asset) => asset.path === path);
  const entryOf = (row: FileRow): WedyanGalleryEntry => ({
    path: row.path,
    name: row.name,
    kind: row.kind === 'persona' ? 'image' : (row.kind as WedyanGalleryEntry['kind']),
    picture: row.thumbnail,
  });
  const casts = () => composer.casts.map(entryOf);

  // A cast isn't something a track holds, so it doesn't drag.
  const drag = (entry: WedyanGalleryEntry, event: DragEvent<HTMLElement>) => {
    const asset = assetOf(entry.path);
    if (!asset) return event.preventDefault();
    event.dataTransfer.setData(ASSET_DRAG, asset.path);
    event.dataTransfer.effectAllowed = 'copy';
  };
  const openGenerated = (entry: WedyanGalleryEntry) => {
    const asset = assetOf(entry.path);
    if (asset?.kind !== 'still' && asset?.kind !== 'take') return;
    composer.activeAsset = asset;
    composer.activeView = 'asset';
    composer.mode = 'direct';
  };
  const addPicked = () => {
    const asset = assetOf(view.picked);
    if (asset) placeOnStage(composer, asset);
  };

  const gallery = (label: string, entries: WedyanGalleryEntry[], empty: [string, string]) =>
    entries.length ? (
      <WedyanGallery label={label} entries={entries} value={$bind(view, 'picked')} onopen={openGenerated} ondragstart={drag} className="wedyan-compose-gallery">
        {entries.some((entry) => assetOf(entry.path)) && <ContextMenu label="Source" size="xs" items={TILE_COMMANDS} oncommand={addPicked} />}
      </WedyanGallery>
    ) : (
      <EmptyState size="sm" title={empty[0]} description={empty[1]} />
    );

  return () => {
    const pictures = assets().filter((asset) => PICTURE_KINDS.has(asset.kind)).map(entryOf);
    const sounds = assets().filter((asset) => !PICTURE_KINDS.has(asset.kind)).map(entryOf);
    return (
      <WindowPanel role="region" aria-label="Sources" className="wedyan-compose-group wedyan-compose-sources">
        <Tabs size="xs" value="all">
          <TabList label="Show">
            <TabButton name="all">All</TabButton>
            <TabButton name="video">Video</TabButton>
            <TabButton name="audio">Audio</TabButton>
            <TabButton name="cast">Cast</TabButton>
          </TabList>
          <TabPanel name="all">{gallery('Sources', [...assets().map(entryOf), ...casts()], ['Nothing yet', "This project's assets and casts show here."])}</TabPanel>
          <TabPanel name="video">{gallery('Video', pictures, ['No video yet', 'The pictures and footage this project has show here.'])}</TabPanel>
          <TabPanel name="audio">{gallery('Audio', sounds, ['No audio yet', 'The music and sound this project has show here.'])}</TabPanel>
          <TabPanel name="cast">{gallery('Cast', casts(), ['No casts yet', "The people and characters this project's stages name show here."])}</TabPanel>
        </Tabs>
      </WindowPanel>
    );
  };
}, 'Sources');
