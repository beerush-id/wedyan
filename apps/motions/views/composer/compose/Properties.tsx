import { setup, Show, template } from '@airlib/react';
import type { TimelineSegment } from '@airlib/react/timeline';
import { EmptyState, TabButton, TabList, TabPanel, Tabs } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import type { FC } from 'react';
import { LayerIcon, PropertiesIcon, SoundIcon, TextIcon } from '../../icons.js';
import type { ClipSound, TitleClip } from '../composition.js';
import { type Composer, composerCtx } from '../context.js';
import { Assigned } from './Assigned.js';
import { LayerProperties } from './LayerProperties.js';
import { SoundProperties } from './SoundProperties.js';
import { TitleProperties } from './TitleProperties.js';

/** A clip with a box: a sound has none. */
const hasBox = (segment?: TimelineSegment) => !!segment && segment.type !== 'audio';

/** A clip with sound: footage, or a sound. */
const soundOf = (segment?: TimelineSegment) =>
  segment?.type === 'video' || segment?.type === 'audio' ? (segment as TimelineSegment<ClipSound>) : undefined;

/** The picked clip when it has words: a title. */
const titleOf = (segment?: TimelineSegment) =>
  segment?.type === 'title' ? (segment as TimelineSegment<TitleClip>) : undefined;

/** What a tab says while no clip it's for is picked. */
const NothingPicked = template<{ kind: string; icon: FC }>(
  ({ kind, icon: Icon }) => (
    <EmptyState size="sm" title={`No ${kind} picked`} description="Pick one on the timeline.">
      <EmptyState.Snippet for="icon">{() => <Icon />}</EmptyState.Snippet>
    </EmptyState>
  ),
  'NothingPicked',
);

/**
 * The picked clip's properties, by kind on tabs: Layer holds its box, Audio its sound, and Text a
 * title's words and how they're set. Each tab shows its panel while the picked clip has what it's for.
 */
export const Properties = setup(() => {
  const composer = composerCtx.get() as Composer;

  return () => (
    <WindowPanel role="region" aria-label="Properties" className="wedyan-compose-group wedyan-compose-properties">
      <Assigned />
      <Tabs size="xs" value="layer">
        <TabList label="Properties">
          <TabButton name="layer">
            <LayerIcon />
            <span>Layer</span>
          </TabButton>
          <TabButton name="audio">
            <SoundIcon />
            <span>Audio</span>
          </TabButton>
          <TabButton name="text">
            <TextIcon />
            <span>Text</span>
          </TabButton>
        </TabList>
        <TabPanel name="layer">
          <Show
            when={() => hasBox(composer.hostClip())}
            fallback={() => <NothingPicked kind="clip" icon={PropertiesIcon} />}
          >
            {() => <LayerProperties />}
          </Show>
        </TabPanel>
        <TabPanel name="audio">
          <Show
            when={() => soundOf(composer.hostClip())}
            fallback={() => <NothingPicked kind="sound" icon={SoundIcon} />}
          >
            {(clip) => <SoundProperties clip={clip} />}
          </Show>
        </TabPanel>
        <TabPanel name="text">
          <Show
            when={() => titleOf(composer.hostClip())}
            fallback={() => <NothingPicked kind="text" icon={TextIcon} />}
          >
            {(clip) => <TitleProperties clip={clip} />}
          </Show>
        </TabPanel>
      </Tabs>
    </WindowPanel>
  );
}, 'Properties');
