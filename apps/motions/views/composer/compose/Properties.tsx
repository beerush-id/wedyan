import { setup, Show, template } from '@airlib/react';
import { EmptyState, TabButton, TabList, TabPanel, Tabs } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import type { FC } from 'react';
import { LayerIcon, PropertiesIcon, SoundIcon, TextIcon } from '../../icons.js';
import type { ClipSound } from '../composition.js';
import { type Composer, composerCtx } from '../context.js';
import { Assigned } from './Assigned.js';
import { LayerProperties } from './LayerProperties.js';
import { SoundProperties } from './SoundProperties.js';
import { TextProperties } from './TextProperties.js';

/** What a clip or a track of a kind has a box for: a sound has none. */
const hasBox = (held?: { type?: string }) => !!held && held.type !== 'audio';

/** What a clip or a track of a kind has sound for: footage, or a sound. */
const hasSound = (held?: { type?: string }) => held?.type === 'video' || held?.type === 'audio';

/** What a track of a kind has words for: titles, or HTML. */
const hasWords = (track?: { type?: string }) => track?.type === 'title' || track?.type === 'html';

/** What's picked when it has words: a title, an element holding text, or a track of those. */
const wordsOf = (composer: Composer) => {
  const picked = composer.picked();
  return picked?.props.text !== undefined || hasWords(composer.pickedTrack()) ? picked : undefined;
};

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
 * What's picked's properties, by kind on tabs: Layer holds its box, Audio a clip's sound, and Text
 * words and how they're set, on a title or an element. Each tab shows its panel while what's picked
 * has what it's for, and a track shows what its clips have, for them to read.
 */
export const Properties = setup(() => {
  const composer = composerCtx.get() as Composer;
  const held = () => composer.pickedTrack() ?? composer.hostClip();

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
            when={() => hasBox(held())}
            fallback={() => <NothingPicked kind="clip" icon={PropertiesIcon} />}
          >
            {() => <LayerProperties />}
          </Show>
        </TabPanel>
        <TabPanel name="audio">
          <Show
            when={() => (hasSound(held()) ? composer.picked() : undefined)}
            fallback={() => <NothingPicked kind="sound" icon={SoundIcon} />}
          >
            {(clip) => <SoundProperties clip={clip as { props: ClipSound }} />}
          </Show>
        </TabPanel>
        <TabPanel name="text">
          <Show
            when={() => wordsOf(composer)}
            fallback={() => <NothingPicked kind="text" icon={TextIcon} />}
          >
            {(clip) => <TextProperties clip={clip} />}
          </Show>
        </TabPanel>
      </Tabs>
    </WindowPanel>
  );
}, 'Properties');
