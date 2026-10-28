import { DescriptionList, Gallery, type GalleryEntry } from '@airlib/react-aui';
import { template } from '@airlib/react';
import type { MouseEvent } from 'react';
import { documentAt, follow } from '@/lib/documents/store.js';
import type { MotionAsset, StillDocument } from '@/lib/documents/types.js';
import { runtime } from './composition.js';
import { duration, length, posterOf, type Project, shortDate, stagesOf } from './library.js';

type ProjectViewProps = {
  project: Project;
  /** Opens one of the project's documents, by path, in its own view. */
  open: (path: string) => void;
};

/**
 * A project open: the ask it started from and where it stands, its script scene by scene, its
 * stages in playing order, the assets they use, and the memos and chats around it. Opening a
 * scene or a stage edits that stage; opening an asset, memo or chat shows it in its own view.
 */
export const ProjectView = template<ProjectViewProps>((props) => {
  const { project, open } = props;
  const motion = project.document;
  const stages = stagesOf(project);
  const notes = [...(motion.memos ?? []), ...(motion.chats ?? [])].map((path) => follow(project.path, path));

  return (
    <div className="wedyan-motion">
      <section className="wedyan-motion-brief" aria-label="Brief">
        <blockquote>{motion.brief}</blockquote>
        <DescriptionList
          size="sm"
          items={[
            { label: 'Length', value: motion.length ? `${duration(length(project))} of ${duration(motion.length)}` : duration(length(project)) },
            { label: 'Aspect', value: motion.aspect },
            { label: 'Status', value: motion.status === 'rendered' ? 'Rendered' : 'Draft' },
            { label: 'Made by', value: motion.author.kind === 'agent' ? 'Wedyan' : 'You' },
            { label: 'Updated', value: shortDate(motion.updated) },
          ]}
        />
      </section>

      <section className="wedyan-motion-section" aria-labelledby="wedyan-motion-script">
        <h3 id="wedyan-motion-script">Script</h3>
        <ol className="wedyan-motion-script">
          {motion.script.map((scene, at) => (
            <li key={scene.id}>
              <button
                type="button"
                disabled={!scene.stage}
                onClick={() => scene.stage && open(follow(project.path, scene.stage).path)}
              >
                <span className="wedyan-motion-scene-number">{at + 1}</span>
                <span className="wedyan-motion-scene-title">{scene.title}</span>
                <span className="wedyan-motion-scene-time">{duration(scene.seconds)}</span>
                {(scene.onScreen || scene.narration) && (
                  <span className="wedyan-motion-scene-words">{scene.onScreen ?? scene.narration}</span>
                )}
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="wedyan-motion-section" aria-label="Stages">
        <h3>Stages</h3>
        <div onDoubleClick={(event) => openTile(event, stages.map((stage) => stage.path), open)}>
          <Gallery
            label="Stages"
            items={stages.map(
              (stage): GalleryEntry => ({
                value: stage.path,
                src: posterOf(stage.document) ?? motion.cover,
                alt: stage.document.name,
                title: stage.document.name,
                description: duration(runtime(stage.document.composition)),
              })
            )}
          />
        </div>
      </section>

      <section className="wedyan-motion-section" aria-label="Assets">
        <h3>Assets</h3>
        <div
          onDoubleClick={(event) =>
            openTile(
              event,
              motion.assets.map((asset) => (asset.kind === 'still' || asset.kind === 'take' ? follow(project.path, asset.src).path : '')),
              open
            )
          }
        >
          <Gallery label="Assets" items={motion.assets.map((asset) => assetTile(project.path, asset))} />
        </div>
      </section>

      {notes.length > 0 && (
        <section className="wedyan-motion-section" aria-label="Notes">
          <h3>Notes</h3>
          <ul className="wedyan-motion-notes">
            {notes.map((note) => (
              <li key={note.path}>
                <button type="button" onClick={() => open(note.path)} disabled={!note.document}>
                  <span className="wedyan-motion-note-name">{note.document?.name ?? note.path}</span>
                  <span className="wedyan-motion-note-kind">{note.document ? noteKind(note.document.type, note.document) : 'Missing'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}, 'ProjectView');

/**
 * An asset as a tile: its picture — a still's chosen attempt — captioned with its name and kind.
 *
 * @param from - The project's path, which the asset's own path is written from.
 * @param asset - The asset.
 * @returns The tile.
 */
function assetTile(from: string, asset: MotionAsset): GalleryEntry {
  let src = asset.kind === 'image' ? asset.src : undefined;
  if (asset.kind === 'still') {
    const still = documentAt<'still'>(follow(from, asset.src).path) as StillDocument | undefined;
    src = still?.attempts.find((attempt) => attempt.id === still.chosen)?.src;
  }
  // Audio has no picture: its tile shows its name alone rather than an empty image.
  return { value: asset.id, ...(src ? { src } : {}), alt: asset.name, title: asset.name, description: ASSET_KINDS[asset.kind] } as GalleryEntry;
}

const ASSET_KINDS: Record<MotionAsset['kind'], string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  still: 'Generated image',
  take: 'Generated video',
};

/**
 * What a note is, as its row says it: a memo's kind, or a chat.
 *
 * @param type - The document's type.
 * @param document - The document.
 * @returns E.g. "Project memo" or "Chat".
 */
function noteKind(type: string, document: { kind?: string }): string {
  if (type === 'chat') return 'Chat';
  const kind = document.kind ?? 'note';
  return `${kind[0].toUpperCase()}${kind.slice(1)} memo`;
}

/**
 * Opens the tile double-clicked in a gallery, found by its place among the tiles.
 *
 * @param event - The double click.
 * @param paths - Each tile's document, in tile order; an empty path opens nothing.
 * @param open - Opens a document by path.
 */
function openTile(event: MouseEvent<HTMLElement>, paths: string[], open: (path: string) => void): void {
  const tile = (event.target as Element).closest('[role="option"]');
  if (!tile) return;
  const path = paths[[...event.currentTarget.querySelectorAll('[role="option"]')].indexOf(tile)];
  if (path) open(path);
}
