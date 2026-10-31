import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, $use, type AnyType, type Bindable, For, Show, setup } from '@airlib/react';
import {
  Avatar,
  Gallery,
  type GalleryEntry,
  type GalleryValue,
  Listbox,
  ListboxOption,
  SearchInput,
  Toggle,
  ToggleGroup,
  Tooltip,
} from '@airlib/react-aui';
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode, SyntheticEvent } from 'react';
import { GridViewIcon, ListViewIcon } from './icons.js';

/** What a file is, as every Wedyan view shows it: a folder, a plain file by its kind, or one of Wedyan's documents. */
export type WedyanFileKind =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'archive'
  | 'still'
  | 'take'
  | 'sound'
  | 'motion'
  | 'stage';

/**
 * One file from a listing, as every Wedyan gallery shows it: what it is and where, its picture,
 * what matters about it, and when it last changed. The app that lists it fills these in; the
 * gallery decides how each kind looks.
 */
export type WedyanGalleryEntry = {
  /** Where it is, which is also what picking it holds. */
  path: string;
  name: string;
  kind: WedyanFileKind;
  /** Its picture, when there's one to show: an image itself, a still's chosen attempt, a take's poster. Without one, it shows its kind's art. */
  picture?: string;
  /** What matters about it, in a line: its size, how much a folder holds, a project's length and status. */
  detail?: string;
  /** When it last changed, short. */
  modified?: string;
  /** What it says, under its row, for what's read rather than looked at, like a message. Two lines at most. */
  summary?: string;
  /** Who it's from, for what comes from someone: their avatar leads its row in place of a picture. */
  person?: string;
};

/** How a gallery shows its files: as picture tiles, or as rows with their details. */
export type WedyanGalleryLayout = 'grid' | 'list';

export type WedyanGalleryProps = {
  /** Names the gallery for screen readers, e.g. the folder's name. */
  label?: string;
  entries?: WedyanGalleryEntry[];
  /** The picked file's path, or the checked paths while picking several. */
  value?: Bindable<GalleryValue>;
  /** Whether several files are picked at once. */
  multiple?: Bindable<boolean>;
  /** Puts a check on each tile, to pick several. */
  checkable?: boolean;
  /** Whether the tiles wrap into rows; false for one row. */
  flow?: boolean;
  /** How the files show: as picture tiles, or as rows with their details. Tiles by default. */
  layout?: WedyanGalleryLayout;
  /** Narrows the files to those whose name holds it, ignoring case; all of them while empty. */
  query?: string;
  className?: string;
  /** Called with the file a double click, or Enter on the picked tile, opens. */
  onopen?: (entry: WedyanGalleryEntry) => void;
  /** Makes the tiles draggable, and is called with the file whose tile starts being dragged, to say what it carries. */
  ondragstart?: (entry: WedyanGalleryEntry, event: DragEvent<HTMLElement>) => void;
  /** What else belongs to the gallery, e.g. a `ContextMenu` acting on the file a secondary click picked. */
  children?: ReactNode;
};

/** A play mark, for anything that plays as a video. */
const PLAY_GLYPH = '<path d="M212 140v80l68-40z"/>';

/** A note, for anything that plays as a sound. */
const NOTE_GLYPH =
  '<circle cx="222" cy="218" r="22"/><rect x="236" y="134" width="10" height="86"/><path d="M246 134q30 8 30 36q-12-16-30-16z"/>';

/**
 * Each kind's tint and glyph, drawn on the art's 480 × 360 canvas: what every file but an image
 * shows. Wedyan's generated kinds share one tint, so what was made reads apart from what was kept.
 */
const KIND_ART: Partial<Record<WedyanFileKind, { tint: string; glyph: string }>> = {
  folder: { tint: '#b98a35', glyph: '<path d="M184 128h44l16 18h52q8 0 8 8v78q0 8-8 8H184q-8 0-8-8V136q0-8 8-8z"/>' },
  video: { tint: '#c8553d', glyph: PLAY_GLYPH },
  audio: { tint: '#1f7a6d', glyph: NOTE_GLYPH },
  still: {
    tint: '#6f5aa6',
    glyph:
      '<rect x="186" y="132" width="108" height="96" rx="10" fill-opacity="0.35"/><path d="M198 214l26-30 18 20 14-14 28 24z"/><circle cx="268" cy="156" r="10"/>',
  },
  take: { tint: '#6f5aa6', glyph: PLAY_GLYPH },
  sound: { tint: '#6f5aa6', glyph: NOTE_GLYPH },
  motion: {
    tint: '#8f3552',
    glyph: '<rect x="184" y="132" width="112" height="96" rx="10" fill-opacity="0.35"/><path d="M226 156v48l40-24z"/>',
  },
  stage: {
    tint: '#4f6f8f',
    glyph: '<rect x="192" y="136" width="88" height="66" rx="8" fill-opacity="0.35"/><rect x="204" y="152" width="88" height="66" rx="8"/>',
  },
  pdf: { tint: '#b23a3a', glyph: pageGlyph() },
  document: { tint: '#3e6aa8', glyph: pageGlyph() },
  archive: {
    tint: '#7a6a58',
    glyph: '<rect x="196" y="112" width="88" height="136" rx="10" fill-opacity="0.35"/><rect x="234" y="112" width="12" height="16"/><rect x="234" y="136" width="12" height="16"/><rect x="234" y="160" width="12" height="16"/><rect x="226" y="184" width="28" height="30" rx="6"/>',
  },
};

/** A browser's page, as every Wedyan app lays it out: the gallery, and beside it the preview of the picked file. */
export const BROWSE_CLASS = {
  ROOT: 'wedyan-browse',
  GALLERY: 'wedyan-browse-gallery',
  PREVIEW: 'wedyan-browse-preview',
  PREVIEW_OPEN: 'wedyan-browse-preview-open',
  PREVIEW_NAME: 'wedyan-browse-preview-name',
};

const SEARCH_CLASS = 'wedyan-gallery-search';

const LIST = {
  ROOT: 'wedyan-gallery-list',
  THUMB: 'wedyan-gallery-list-thumb',
  NAME: 'wedyan-gallery-list-name',
  DETAIL: 'wedyan-gallery-list-detail',
  SUMMARY: 'wedyan-gallery-list-summary',
};

/**
 * Files the same in every Wedyan app, as tiles or as rows: each kind drawn one way, picked and
 * checked the same way, and opened by a double click or by Enter on the picked one. A row is drawn
 * from the file's tile, so a file reads the same either way. What opening does is the app's: it
 * hears which file through `onopen`.
 */
export const WedyanGallery = setup<WedyanGalleryProps>((props) => {
  // The files shown: those whose name holds the query, so opening by place finds the one under the pointer.
  const entries = () => {
    const query = props.query?.trim().toLowerCase();
    const all = props.entries ?? [];
    return query ? all.filter((entry) => entry.name.toLowerCase().includes(query)) : all;
  };

  /**
   * The file whose tile an event happened on, found by the tile's place among the tiles.
   *
   * @param event - An event from inside the gallery.
   * @returns The tile's file, or none when the event was beside every tile.
   */
  const entryOf = (event: SyntheticEvent<HTMLElement>): WedyanGalleryEntry | undefined => {
    const tile = (event.target as Element).closest('[role="option"]');
    if (!tile) return;
    return entries()[[...event.currentTarget.querySelectorAll('[role="option"]')].indexOf(tile)];
  };

  // A double click opens the tile. While picking one, its second click unpicks the tile again, so the
  // tile is picked again here; while picking several, its two clicks cancel out.
  const openTile = (event: MouseEvent<HTMLElement>) => {
    const entry = entryOf(event);
    if (!entry) return;
    if (!props.multiple) props.value = entry.path;
    props.onopen?.(entry);
  };

  // A secondary click picks the tile under it, as a file manager does, so a menu acts on that file.
  const pickForMenu = (event: MouseEvent<HTMLElement>) => {
    const entry = entryOf(event);
    if (entry && !props.multiple) props.value = entry.path;
  };

  const dragTile = (event: DragEvent<HTMLElement>) => {
    const entry = entryOf(event);
    if (entry) props.ondragstart?.(entry, event);
  };

  // While picking one, Enter on the picked tile opens it, caught before the gallery would take it as
  // unpicking; on any other tile, or while picking several, Enter picks or checks as usual.
  const openOnEnter = (event: KeyboardEvent<HTMLElement>) => {
    const tile = (event.target as Element).closest('[role="option"]');
    if (event.key !== 'Enter' || props.multiple || tile?.getAttribute('aria-selected') !== 'true') return;
    event.preventDefault();
    event.stopPropagation();
    const entry = entries().find((each) => each.path === props.value);
    if (entry) props.onopen?.(entry);
  };

  return () => (
    <div
      className={props.className}
      onDoubleClick={openTile}
      onKeyDownCapture={openOnEnter}
      onContextMenuCapture={pickForMenu}
      onDragStart={dragTile}
    >
      {props.children}
      <Show
        when={() => props.layout === 'list'}
        fallback={() => (
          <Gallery
            label={props.label}
            items={$use(() => entries().map(tileOf))}
            value={$bind(props as AnyType, 'value')}
            multiple={$bind(props as AnyType, 'multiple')}
            checkable={props.checkable}
            flow={props.flow}
            draggable={Boolean(props.ondragstart)}
          />
        )}
      >
        {() => (
          <Listbox
            label={props.label}
            value={$bind(props as AnyType, 'value')}
            multiple={$bind(props as AnyType, 'multiple')}
            checkable={props.checkable}
            className={LIST.ROOT}
          >
            <For each={entries}>
              {(entry) => {
                const tile = tileOf(entry);
                return (
                  <ListboxOption value={tile.value}>
                    {entry.person ? <Avatar alt={entry.person} size="sm" color="primary" /> :<img src={tile.src} alt="" className={LIST.THUMB} />}
                    <span className={LIST.NAME}>{tile.title}</span>
                    <span className={LIST.DETAIL}>{tile.description}</span>
                    <span className={LIST.DETAIL}>{tile.meta}</span>
                    {entry.summary && <span className={LIST.SUMMARY}>{entry.summary}</span>}
                  </ListboxOption>
                );
              }}
            </For>
          </Listbox>
        )}
      </Show>
    </div>
  );
}, 'WedyanGallery');

/**
 * Searching a gallery's files, for the window's toolbar: what's typed narrows them to those whose
 * name holds it. It binds the query the app keeps, which the gallery reads.
 */
export const WedyanGallerySearch = setup<{ query?: Bindable<string> }>(
  (props) => () => (
    <SearchInput size="sm" label="Search" placeholder="Search" value={$bind(props as AnyType, 'query')} className={SEARCH_CLASS} />
  ),
  'WedyanGallerySearch'
);

/**
 * The choice of how a gallery shows its files, as tiles or as rows, for the window's toolbar. It
 * binds the layout the app keeps, which the gallery reads.
 */
export const WedyanGalleryLayoutToggle = setup<{ layout?: Bindable<WedyanGalleryLayout> }>(
  (props) => () => (
    <ToggleGroup aria-label="Layout" value={$bind(props as AnyType, 'layout')} required size="xs">
      <Toggle value="grid" aria-label="Grid" size="xs" className={AUI_CLASS.CONTROL_ICON}>
        <GridViewIcon />
        <Tooltip>Grid</Tooltip>
      </Toggle>
      <Toggle value="list" aria-label="List" size="xs" className={AUI_CLASS.CONTROL_ICON}>
        <ListViewIcon />
        <Tooltip>List</Tooltip>
      </Toggle>
    </ToggleGroup>
  ),
  'WedyanGalleryLayoutToggle'
);

/**
 * A file as its tile: an image by its own picture, anything else by its kind's art; its name over
 * what matters about it and when it changed. A list of files draws its rows from the same tile, so a
 * file reads the same in every view.
 *
 * @param entry - The file.
 * @returns The tile.
 */
export function tileOf(entry: WedyanGalleryEntry): GalleryEntry {
  return {
    value: entry.path,
    src: entry.picture || kindArt(entry.kind),
    alt: entry.name,
    title: entry.name,
    description: entry.detail,
    meta: entry.modified,
  };
}

/**
 * Art for a file with no picture of its own: its kind's tint and glyph.
 *
 * @param kind - The file's kind.
 * @returns The art as a data URL.
 */
function kindArt(kind: WedyanFileKind): string {
  const art = KIND_ART[kind] ?? (KIND_ART.document as { tint: string; glyph: string });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><rect width="480" height="360" fill="${art.tint}"/><g fill="#fff7ef">${art.glyph}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * A page with lines on it, for documents of any kind.
 *
 * @returns The glyph's SVG markup.
 */
function pageGlyph(): string {
  return '<rect x="196" y="112" width="88" height="136" rx="10" fill-opacity="0.35"/><rect x="214" y="142" width="52" height="8" rx="4"/><rect x="214" y="166" width="52" height="8" rx="4"/><rect x="214" y="190" width="34" height="8" rx="4"/>';
}
