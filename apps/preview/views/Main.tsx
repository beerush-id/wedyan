import { $bind, $static, $use, mutable, Snippet, setup } from '@airlib/react';
import { EmptyState, ImageViewer, type ImageViewerEntry } from '@airlib/react-aui';
import { defineWindow, Window, WindowTitle } from '@airlib/react-aui/desktop';
import { ImageIcon } from '@airlib/react-aui/icons';
import { FloatingDownload } from '@/components/FloatingDownload.js';
import { chosenAttempt } from '@/lib/documents/generation.js';
import { documentAt, nameOf } from '@/lib/documents/store.js';
import type { SoundDocument, StillDocument, TakeDocument } from '@/lib/documents/types.js';
import type { PreviewTarget } from '@/lib/systems/system.js';
import { fullRect } from '@/lib/systems/window.js';
import manifest from '../manifest.json';

/** What a Preview window shows for its whole life; none when Preview was launched on its own. */
export type PreviewData = { target?: PreviewTarget } | undefined;

/** What the viewer's buttons say. */
const VIEWER_LABELS = {
  previous: 'Previous picture',
  next: 'Next picture',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fullscreen: 'Full screen',
};

const CLASS = {
  PREVIEW: 'wedyan-preview',
  MEDIA: 'wedyan-preview-media',
};

/**
 * Preview: one window for each thing an app asks to see larger, through a `preview:` link. A still
 * shows every attempt, the chosen one first, to step through and zoom; a take plays its chosen
 * attempt, a sound plays its own; a picture, a video or a sound by its address shows as it is. A
 * picture can be downloaded from its corner.
 */
export const preview = defineWindow({
  name: manifest.name,
  label: manifest.label,
  title: manifest.label,
  image: manifest.icon,
  rect: fullRect(),
  window: { snap: '.aui-window', minWidth: 360, minHeight: 280 },
  multiple: true,
}).render((props) => {
  // A window opened on something shows it for its whole life.
  const target = $static(() => (props.instance.data as PreviewData)?.target);

  return () => (
    <Window>
      <Window.Snippet for="title">
        {() => (
          <WindowTitle>
            <Snippet>{() => (target ? titleOf(target) : manifest.label)}</Snippet>
          </WindowTitle>
        )}
      </Window.Snippet>
      <div className={CLASS.PREVIEW}>{target ? <Shown target={target} /> : <Nothing />}</div>
    </Window>
  );
});

/**
 * Opens something in a Preview window of its own, or brings forward the one already showing it.
 *
 * @param target - A document's path, or a picture, a video or a sound by its address.
 */
export function openPreview(target: PreviewTarget): void {
  const key = keyOf(target);
  const showing = preview.instances.find((instance) => {
    const shown = (instance.data as PreviewData)?.target;
    return shown !== undefined && keyOf(shown) === key;
  });
  if (showing) {
    showing.focus();
    return;
  }

  preview.open(
    { target },
    {
      name: 'preview',
      get title() {
        return titleOf(target);
      },
      get thumbnail() {
        return thumbnailOf(target);
      },
    }
  );
}

/** What a target is, for showing it: an addressed picture, video or sound, a document of a kind, or nothing Preview shows. */
type Shape =
  | { kind: 'image' | 'video' | 'audio'; src: string; name: string }
  | { kind: 'still'; document: StillDocument }
  | { kind: 'take' | 'sound'; document: TakeDocument | SoundDocument }
  | { kind: 'none'; name: string };

/** What a target is shown as: the viewer for pictures, a player for a video or a sound. */
const Shown = setup<{ target: PreviewTarget }>((props) => {
  // A window shows one thing for its whole life, so what it is is read once.
  const shape = $static(() => shapeOf(props.target));

  switch (shape.kind) {
    case 'image':
      return () => <Pictures slides={() => [{ src: shape.src, alt: shape.name }]} name={shape.name} />;
    case 'video':
    case 'audio':
      return () => <Player src={shape.src} type={shape.kind} name={shape.name} />;
    case 'still': {
      const still = shape.document;
      // Every attempt, the chosen one shown first.
      return () => (
        <Pictures
          slides={() => still.attempts.map((attempt, at) => ({ src: attempt.src, alt: `Attempt ${at + 1}` }))}
          name={still.name}
          start={still.attempts.indexOf(chosenAttempt(still) ?? still.attempts[0])}
        />
      );
    }
    case 'take':
    case 'sound': {
      const source = shape.document;
      const type = shape.kind === 'take' ? 'video' : 'audio';
      return () => {
        const chosen = chosenAttempt(source);
        return chosen ? <Player src={chosen.src} type={type} name={source.name} /> : <Nothing title="Nothing made yet" />;
      };
    }
    default:
      return () => <Nothing title="Nothing to show" description={`${shape.name} can't be previewed.`} />;
  }
}, 'Shown');

/**
 * What a target is, for showing it.
 *
 * @param target - A document's path, or a picture, a video or a sound by its address.
 * @returns Its kind, with what showing it needs.
 */
function shapeOf(target: PreviewTarget): Shape {
  if (typeof target !== 'string') return { kind: target.type, src: target.src, name: target.name ?? 'Picture' };
  const document = documentAt(target);
  if (document?.type === 'still') return { kind: 'still', document };
  if (document?.type === 'take' || document?.type === 'sound') return { kind: document.type, document };
  return { kind: 'none', name: nameOf(target) };
}

/** Pictures in the viewer, to step through and zoom, with downloading the one shown at its corner. */
const Pictures = setup<{ slides: () => ImageViewerEntry[]; name: string; start?: number }>((props) => {
  const viewer = mutable({ index: $static(() => Math.max(props.start ?? 0, 0)) });

  return () => (
    <>
      <ImageViewer label={props.name} items={$use(props.slides)} index={$bind(viewer, 'index')} labels={VIEWER_LABELS} />
      <Snippet>
        {() => {
          const shown = props.slides()[viewer.index];
          return shown ? <FloatingDownload src={shown.src} name={props.name} /> : null;
        }}
      </Snippet>
    </>
  );
}, 'Pictures');

/** A video or a sound, playing in the window. */
const Player = setup<{ src: string; type: 'video' | 'audio'; name: string }>((props) => () =>
  props.type === 'video' ? (
    // biome-ignore lint/a11y/useMediaCaption: a generated clip has no words to caption.
    <video className={CLASS.MEDIA} src={props.src} controls autoPlay aria-label={props.name} />
  ) : (
    // biome-ignore lint/a11y/useMediaCaption: a generated sound's words, when it has any, are on its document.
    <audio className={CLASS.MEDIA} src={props.src} controls autoPlay aria-label={props.name} />
  ), 'Player');

/** What a window with nothing to show says. */
const Nothing = setup<{ title?: string; description?: string }>((props) => () => (
  <EmptyState
    title={props.title ?? 'Nothing to preview'}
    description={props.description ?? 'Double-click a picture in any app to see it here, larger.'}
    level={3}
  >
    <EmptyState.Snippet for="icon">{() => <ImageIcon />}</EmptyState.Snippet>
  </EmptyState>
), 'Nothing');

/**
 * What makes two previews the same: a document's path, or the address of what's shown.
 *
 * @param target - What's previewed.
 * @returns Its path or address.
 */
function keyOf(target: PreviewTarget): string {
  return typeof target === 'string' ? target : target.src;
}

/**
 * A preview window's title: the document's name, the name given, or the file's name.
 *
 * @param target - What's previewed.
 * @returns E.g. `Ayla at the jetty`.
 */
function titleOf(target: PreviewTarget): string {
  if (typeof target !== 'string') return target.name ?? 'Preview';
  return documentAt(target)?.name ?? nameOf(target);
}

/**
 * A preview window's thumbnail in the dock: the picture it shows, when it shows one.
 *
 * @param target - What's previewed.
 * @returns The picture's address, if it has one.
 */
function thumbnailOf(target: PreviewTarget): string | undefined {
  if (typeof target !== 'string') return target.type === 'image' ? target.src : undefined;
  const document = documentAt(target);
  if (document?.type === 'still') return chosenAttempt(document)?.src;
  if (document?.type === 'take') return (chosenAttempt(document) as { poster?: string } | undefined)?.poster;
}
