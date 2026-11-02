import type { D1Extension, D1Write, FileInfo } from '@irpclib/r2-file';
import { fsContext } from '@irpclib/r2-file/context';
import { resolvePath } from '@/lib/documents/paths.js';
import type { FileRow, RowKind } from '@/lib/documents/rows.js';
import { posterOf, runtime } from '@/lib/documents/stage.js';
import type { MemoDocument, MotionDocument, PersonaDocument, StageDocument, StillDocument, TakeDocument } from '@/lib/documents/types.js';

/** The columns every kind of file shares, on `_r2_files`, so any list is one query. */
const COLUMNS: Record<string, string> = {
  doc_id: 'TEXT',
  kind: 'TEXT',
  title: 'TEXT',
  description: 'TEXT',
  thumbnail: 'TEXT',
  src: 'TEXT',
  picture: 'TEXT',
  duration: 'REAL',
  status: 'TEXT',
  author: 'TEXT',
  ask: 'TEXT',
  updated: 'TEXT',
  project_id: 'TEXT',
  position: 'INTEGER',
};

/** The longest `ask` a row carries; a list only shows the start of one. */
const ASK_LENGTH = 512;

/** What a file holds of other files: a project's assets and its casts. */
const LINKS = '_wedyan_links';

/** A document's header, which every kind shares. */
type Header = { id: string; name: string; description?: string; updated: string; author?: { kind: string; ask?: string } };

/** A kind of document's own columns, on top of its header's. */
type Columns = (document: never, write: D1Write) => Record<string, unknown>;

const DOCUMENTS: Partial<Record<RowKind, Columns>> = {
  motion: (motion: MotionDocument) => ({ thumbnail: motion.cover, status: motion.status }),
  stage: (stage: StageDocument) => ({
    thumbnail: posterOf(stage),
    duration: runtime(stage.composition),
    project_id: stage.projectId,
    position: stage.order,
  }),
  still: (still: StillDocument) => ({ thumbnail: chosen(still)?.src, src: chosen(still)?.src }),
  take: (take: TakeDocument) => ({ thumbnail: chosen(take)?.poster, src: chosen(take)?.src }),
  sound: (sound: { attempts: { id: string; src: string }[]; chosen?: string }) => ({ src: chosen(sound)?.src }),
  persona: (persona: PersonaDocument, { path }) => {
    const main = persona.head?.main;
    return main?.endsWith('.still') ? { picture: resolvePath(path, main) } : { thumbnail: main };
  },
  agent: (agent: { avatar?: string }) => ({ thumbnail: agent.avatar }),
  memo: (memo: MemoDocument) => ({ status: memo.priority, description: memo.body.slice(0, ASK_LENGTH) }),
};

/**
 * Wedyan's index on `_r2_files`: every file, whatever it is, is one row of shared columns, filled as
 * it's written, whoever writes it, so a list is one query and never reads a file.
 */
export const fileRows: D1Extension = {
  async migrate(db) {
    for (const [column, type] of Object.entries(COLUMNS)) {
      await db.prepare(`ALTER TABLE _r2_files ADD COLUMN "${column}" ${type}`).run().catch(() => {});
    }
    await db.batch([
      db.prepare('CREATE INDEX IF NOT EXISTS _r2_files_project ON _r2_files(project_id, position)'),
      db.prepare('CREATE INDEX IF NOT EXISTS _r2_files_kind ON _r2_files(directory, kind)'),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS ${LINKS} (
          owner TEXT NOT NULL,
          target TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (owner, target)
        )`,
      ),
      db.prepare(`CREATE INDEX IF NOT EXISTS ${LINKS}_target ON ${LINKS}(target)`),
    ]);
  },

  columns(write) {
    const kind = documentKind(write.path);
    if (!kind) return mediaColumns(write);
    const document = parsed(write.data);
    if (!document) return { kind };
    const { id, name, description, updated, author } = document as unknown as Header;
    return {
      kind,
      doc_id: id,
      title: name,
      description,
      updated,
      author: author?.kind === 'agent' ? 'Wedyan' : 'You',
      ask: author?.ask?.slice(0, ASK_LENGTH),
      ...DOCUMENTS[kind]?.(document as never, write),
    };
  },

  directory: ({ options }) => ({ kind: 'folder', title: options?.metadata?.title }),

  updated: ({ options }) => (options?.metadata?.title ? { title: options.metadata.title } : {}),

  statements(db, write) {
    if (documentKind(write.path) !== 'motion') return [];
    const motion = parsed(write.data) as MotionDocument | undefined;
    if (!motion) return [];
    const targets = [...(motion.assets ?? []), ...(motion.casts ?? [])].map((path) => storagePath(write.path, path));
    return [
      db.prepare(`DELETE FROM ${LINKS} WHERE owner = ?`).bind(write.path),
      ...targets.map((target, position) => db.prepare(`INSERT OR REPLACE INTO ${LINKS} (owner, target, position) VALUES (?, ?, ?)`).bind(write.path, target, position)),
    ];
  },

  query({ options }) {
    const select = [`${THUMBNAIL} AS row_thumbnail`, `${PROJECT} AS project`];
    const holds = options?.scope?.holds;
    if (!holds) return { select };
    // A project's window, in one query: its stages, what it holds, and who can be cast or assigned.
    const project = storagePath('', holds);
    return {
      select: [...select, `(SELECT l.position FROM ${LINKS} l WHERE l.owner = ? AND l.target = f.path) AS held`],
      selectParams: [project],
      where: `f.project_id = (SELECT p.doc_id FROM _r2_files p WHERE p.path = ?) OR f.kind IN ('agent', 'persona') OR f.path IN (SELECT l.target FROM ${LINKS} l WHERE l.owner = ?)`,
      params: [project, project],
    };
  },

  entry(row, info) {
    if (row.project) {
      const { path, ...project } = JSON.parse(row.project as string);
      return { ...info, ...project, kind: 'motion', path: homeOf(path), isDirectory: false, position: 0 };
    }
    // A folder a write made on its way to a file has no row of its own to say what it is, nor has a
    // document written before its kind had one.
    const kind = row.kind ?? (info.isDirectory ? 'folder' : documentKind(info.path));
    if (!kind) return { ...info, path: homeOf(info.path) };
    const entry: FileRow = {
      ...info,
      path: homeOf(info.path),
      name: (row.title as string) ?? info.name,
      kind: kind as RowKind,
      id: orUndefined(row.doc_id),
      description: orUndefined(row.description),
      thumbnail: orUndefined(row.row_thumbnail ?? row.thumbnail),
      src: orUndefined(row.src),
      duration: (row.duration as number) ?? 0,
      position: ((row.held ?? row.position) as number) ?? 0,
      held: row.held !== undefined && row.held !== null,
      status: orUndefined(row.status),
      author: orUndefined(row.author),
      ask: orUndefined(row.ask),
      updated: orUndefined(row.updated) ?? new Date(info.mtime).toISOString(),
    };
    return entry as unknown as FileInfo;
  },

  moved(db, paths) {
    return paths.flatMap(({ source, destination }) => [
      db.prepare(`UPDATE ${LINKS} SET owner = ? WHERE owner = ?`).bind(destination, source),
      db.prepare(`UPDATE ${LINKS} SET target = ? WHERE target = ?`).bind(destination, source),
    ]);
  },
};

/** What a row shows as its picture: its own, a person's still, or a stage's project's cover. */
const THUMBNAIL = `COALESCE(
  f.thumbnail,
  (SELECT t.thumbnail FROM _r2_files t WHERE t.path = f.picture AND t.deleted_at IS NULL),
  (SELECT c.thumbnail FROM _r2_files c WHERE c.doc_id = f.project_id AND c.kind = 'motion' AND c."user_id" IS f."user_id" AND c.deleted_at IS NULL)
)`;

/** One project as a row's JSON: its time is its stages' together. */
const projectOf = (file: string) => `json_object(
  'path', ${file}.path, 'id', ${file}.doc_id, 'name', ${file}.title, 'thumbnail', ${file}.thumbnail, 'status', ${file}.status,
  'author', ${file}.author, 'ask', ${file}.ask, 'updated', ${file}.updated,
  'duration', (SELECT COALESCE(SUM(s.duration), 0) FROM _r2_files s WHERE s.project_id = ${file}.doc_id AND s.kind = 'stage' AND s."user_id" IS ${file}."user_id" AND s.deleted_at IS NULL)
)`;

/** A project's row, whether what's listed is its `.motion` or the folder holding one of its own name. */
const PROJECT = `CASE
  WHEN f.kind = 'motion' THEN ${projectOf('f')}
  WHEN f.type = 'inode/directory' THEN (SELECT ${projectOf('m')} FROM _r2_files m WHERE m.directory = f.path AND m.name = f.name || '.motion' AND m.kind = 'motion' AND m.deleted_at IS NULL)
END`;

/**
 * The document kind of a path.
 *
 * @param path - The file's path.
 * @returns Its kind, unless it isn't a document.
 */
function documentKind(path: string): RowKind | undefined {
  const extension = path.slice(path.lastIndexOf('.') + 1) as RowKind;
  return extension in DOCUMENTS ? extension : undefined;
}

/**
 * The columns of a picture, a video or a sound, which show and play from where they're delivered.
 *
 * @param write - The write.
 * @returns Its columns, unless it's something else.
 */
function mediaColumns({ path, type, options }: D1Write): Record<string, unknown> | undefined {
  const kind = /^(image|video|audio)\//.exec(type)?.[1];
  if (!kind || options?.metadata?.part) return;
  const src = `/~${homeOf(path).slice(1)}`;
  const { title, thumbnail, duration } = options?.metadata ?? {};
  return {
    kind,
    title: title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''),
    src,
    thumbnail: kind === 'image' ? src : thumbnail,
    duration: duration ? Number(duration) : undefined,
  };
}

/**
 * A chosen attempt of a generated document.
 *
 * @param document - The document.
 * @returns The attempt it shows.
 */
function chosen<T extends { id: string }>(document: { attempts: T[]; chosen?: string }): T | undefined {
  return document.attempts.find((attempt) => attempt.id === document.chosen) ?? document.attempts[0];
}

function parsed(data: unknown): Record<string, unknown> | undefined {
  try {
    return (typeof data === 'string' ? JSON.parse(data) : data) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function orUndefined<T>(value: T): string | undefined {
  return (value as string | null) ?? undefined;
}

/** A stored path as a home path; one outside the home stays as it is. */
function homeOf(path: string): string {
  const home = fsContext.get()?.homeDir;
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * Where a path written in a document leads in storage.
 *
 * @param from - The stored path of the document it's written in.
 * @param path - The path as written: relative, or a home path.
 * @returns The stored path.
 */
function storagePath(from: string, path: string): string {
  return path.startsWith('~') ? `${fsContext.get()?.homeDir ?? ''}${path.slice(1)}` : resolvePath(from, path);
}
