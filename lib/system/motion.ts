import { list, move, remove, write } from '@irpclib/r2-file';
import { GENERATIVE_TAG } from '@/lib/documents/generation.js';
import { homePath, newHeader, newId, parentOf } from '@/lib/documents/paths.js';
import type { FileRow } from '@/lib/documents/rows.js';
import { stageAt } from '@/lib/documents/stage.js';
import type { MotionDocument, StageDocument } from '@/lib/documents/types.js';
import { openLink } from '@/lib/share/links.js';
import { pathFrom, pathTo } from '@/lib/share/paths.js';
import type { setupFiles } from './files.js';
import { soundFile } from './files.js';
import { layOut, stageFile } from './stage.js';
import { changeDocument, documentOf, eachOf, folderOf, trash, userAgrees } from './store.js';
import {
  type AssetFile,
  type AssetInit,
  motionAssetAdd,
  motionAssetGet,
  motionAssetRemove,
  motionCastAdd,
  motionCastGet,
  motionCastRemove,
  motionCreate,
  motionDelete,
  motionEdit,
  motionRead,
  motionStageAdd,
  motionStageGet,
  motionStageRemove,
  type MotionChanges,
  type MotionFile,
  type MotionInit,
  type StageFile,
  type StageInit,
  sys,
} from './system.h.js';

/** Where projects live until they're told otherwise. */
const MOTIONS = '~/Motions';

/** What makes people, stills, sounds and takes. */
type Makers = ReturnType<typeof setupFiles>;

/**
 * Sets up Motion projects, and what they hold: stages, casts and assets.
 *
 * @param makers - What makes what they hold.
 */
export function setupMotion(makers: Makers): void {
  sys.construct(motionCreate, (cwd, items) => Promise.all(items.map((init) => makeMotion(folderOf(cwd, MOTIONS), init))));
  sys.construct(motionRead, async (path) => motionFile(path, await documentOf(path, 'motion')));
  sys.construct(motionEdit, editMotion);
  sys.construct(motionDelete, async (path) => {
    const motion = await documentOf(path, 'motion');
    if (!(await userAgrees(`Move ${motion.name} and everything in its folder to the trash?`))) return { deleted: 0 };
    await remove(parentOf(path), { soft: true, recursive: true });
    return { deleted: 1 };
  });

  sys.construct(motionStageGet, async (path, id) => {
    const stage = `${parentOf(path)}/${id}.stage`;
    return stageFile(stage, await documentOf(stage, 'stage'));
  });
  sys.construct(motionStageAdd, addStages);
  sys.construct(motionStageRemove, removeStages);

  sys.construct(motionCastGet, async (path, persona) => {
    const motion = await documentOf(path, 'motion');
    if (!holds(path, motion.casts ?? [], persona)) throw new Error(`${persona} isn't in ${motion.name}`);
    return { ...(await documentOf(persona, 'persona')), path: persona };
  });
  sys.construct(motionCastAdd, async (path, items) => {
    await documentOf(path, 'motion');
    const people = await eachOf(items, async (item) =>
      typeof item === 'string' ? { ...(await documentOf(item, 'persona')), path: item } : makers.persona(null, item),
    );
    await changeDocument(path, 'motion', (motion) => {
      const casts = motion.casts ?? [];
      motion.casts = [...casts, ...people.map((person) => person.path).filter((person) => !holds(path, casts, person))];
    });
    return people;
  });
  sys.construct(motionCastRemove, async (path, people) => {
    let removed = 0;
    await changeDocument(path, 'motion', (motion) => {
      const casts = motion.casts ?? [];
      motion.casts = casts.filter((cast) => !people.includes(pathFrom(path, cast)));
      removed = casts.length - motion.casts.length;
    });
    return { removed };
  });

  sys.construct(motionAssetGet, async (path, asset) => {
    const motion = await documentOf(path, 'motion');
    if (!holds(path, motion.assets, asset)) throw new Error(`${motion.name} doesn't hold ${asset}`);
    return assetAt(asset);
  });
  sys.construct(motionAssetAdd, async (path, items) => {
    const motion = await documentOf(path, 'motion');
    const folder = parentOf(path);
    const defaults = { settings: { aspect: motion.aspect } };
    const made = await eachOf(items, (item) => (typeof item === 'string' ? assetAt(item) : makeAsset(makers, folder, item, defaults)));
    await changeDocument(path, 'motion', (changed) => {
      const fresh = made.map((asset) => asset.path).filter((asset) => !holds(path, changed.assets, asset));
      changed.assets.push(...fresh.map((asset) => pathTo(path, asset)));
    });
    return made;
  });
  sys.construct(motionAssetRemove, async (path, assets) => {
    let removed = 0;
    await changeDocument(path, 'motion', (motion) => {
      const kept = motion.assets.filter((asset) => !assets.includes(pathFrom(path, asset)));
      removed = motion.assets.length - kept.length;
      motion.assets = kept;
    });
    return { removed };
  });
}

/** Whether a list written in a document names a file. */
const holds = (from: string, written: string[], path: string) => written.some((each) => pathFrom(from, each) === path);

/** What a path leads to, by its extension: only stills, takes and sounds are assets. */
async function assetAt(path: string): Promise<AssetFile> {
  if (path.endsWith('.still')) return { ...(await documentOf(path, 'still')), path };
  if (path.endsWith('.take')) return { ...(await documentOf(path, 'take')), path };
  if (path.endsWith('.sound')) return soundFile(path, await documentOf(path, 'sound'));
  throw new Error(`${path} isn't a .still, .take or .sound`);
}

/** Makes a new asset in a project's folder, at the project's aspect ratio unless it says otherwise. */
function makeAsset(makers: Makers, folder: string, item: AssetInit, { settings }: { settings: { aspect: string } }): Promise<AssetFile> {
  const merged = { ...settings, ...item.settings };
  if (item.type === 'still') {
    const { type: _, ...init } = item;
    return makers.still(folder, { ...init, settings: merged });
  }
  if (item.type === 'take') {
    const { type: _, ...init } = item;
    return makers.take(folder, { ...init, settings: merged });
  }
  const { type: _, ...init } = item;
  return makers.sound(folder, init);
}

/**
 * Starts a project in its own folder, named by its id, so what it's called can change.
 *
 * @param cwd - The folder its own folder goes in.
 * @param init - What it is.
 * @returns It.
 */
async function makeMotion(cwd: string, { name, script, aspect = '16:9', description, cover = '' }: MotionInit): Promise<MotionFile> {
  const id = newId();
  const folder = `${cwd}/${id}`;
  const path = `${folder}/${id}.motion`;
  const motion: MotionDocument = {
    ...newHeader(path, '.motion'),
    id,
    name,
    description,
    author: { kind: 'agent' },
    tags: [GENERATIVE_TAG],
    type: 'motion',
    aspect,
    cover,
    status: 'draft',
    assets: [],
    casts: [],
    script: { path: await writeScript(folder, name, script) },
  };
  await write(path, motion as never);
  return motionFile(path, motion);
}

/** Writes a script, a Markdown file in its project's folder, and names it. */
async function writeScript(folder: string, name: string, script: string): Promise<string> {
  const file = `${newId()}.md`;
  await write(`${folder}/${file}`, script as never, { metadata: { title: `${name} script` } });
  return file;
}

/**
 * A project as the tools read it: its stages in order, and how long they run.
 *
 * @param path - The project.
 * @param motion - Its document.
 * @returns It.
 */
async function motionFile(path: string, motion: MotionDocument): Promise<MotionFile> {
  const stages = stagesOf(await listed(parentOf(path)));
  return {
    ...motion,
    path,
    open: openLink(path),
    seconds: stages.reduce((total, { seconds }) => total + seconds, 0),
    stages,
  };
}

/** What's in a folder. */
async function listed(folder: string): Promise<FileRow[]> {
  const { entries } = await list(folder);
  return entries as unknown as FileRow[];
}

/** A folder's stages in playing order. */
function stagesOf(rows: FileRow[]): MotionFile['stages'] {
  return rows
    .filter((row) => row.kind === 'stage')
    .sort((a, b) => a.position - b.position)
    .map((row) => {
      const path = homePath(row.path);
      return { id: path.slice(path.lastIndexOf('/') + 1, -'.stage'.length), path, name: row.name, order: row.position, seconds: row.duration };
    });
}

/** Writes what's changed on a project. */
async function editMotion(path: string, { script, ...fields }: MotionChanges): Promise<MotionFile> {
  const motion = await changeDocument(path, 'motion', async (changed) => {
    Object.assign(changed, Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)));
    if (script === undefined) return;
    if (changed.script) await write(pathFrom(path, changed.script.path), script as never);
    else changed.script = { path: await writeScript(parentOf(path), changed.name, script) };
  });
  return motionFile(path, motion);
}

/**
 * Adds stages to a project, one after another, so each knows the place the last one took: a new
 * one, or one moved here. No place is given twice, so an ask repeated makes nothing new.
 *
 * @param path - The project.
 * @param items - New stages, or the paths of stages to move here.
 * @returns The stages, whole.
 */
async function addStages(path: string, items: (string | StageInit)[]): Promise<StageFile[]> {
  const stages: StageFile[] = [];
  await changeDocument(path, 'motion', async (motion) => {
    const taken = stagesOf(await listed(parentOf(path))).map(({ order }) => order);
    const placeFor = (order?: number) => {
      const place = order ?? Math.max(-1, ...taken) + 1;
      if (taken.includes(place)) throw new Error(`${motion.name} already has a stage at order ${place}`);
      taken.push(place);
      return place;
    };
    for (const item of items) {
      stages.push(typeof item === 'string' ? await moveStage(item, path, motion, placeFor()) : await newStage(path, motion, item, placeFor(item.order)));
    }
  });
  return stages;
}

/** Writes a new stage next to its project. */
async function newStage(motionPath: string, motion: MotionDocument, init: StageInit, order: number): Promise<StageFile> {
  const { name, script, casts, tracks } = init;
  const folder = parentOf(motionPath);
  const id = newId();
  const path = `${folder}/${id}.stage`;
  const stage: StageDocument = { ...stageAt(id, folder, name, motion, order), author: { kind: 'agent' } };
  if (script !== undefined) stage.script = await writeScript(folder, name, script);
  if (casts) stage.casts = casts;
  if (tracks) await layOut(path, stage, tracks);
  await write(path, stage as never);
  return stageFile(path, stage);
}

/**
 * Moves a stage here from another project. What it names by path from its old folder is rewritten
 * as home paths, so it still leads there.
 *
 * @param from - Where it is.
 * @param motionPath - The project it joins.
 * @param motion - That project.
 * @param order - Its place there.
 * @returns It, whole.
 */
async function moveStage(from: string, motionPath: string, motion: MotionDocument, order: number): Promise<StageFile> {
  const stage = await documentOf(from, 'stage');
  const name = from.slice(from.lastIndexOf('/') + 1);
  const path = `${parentOf(motionPath)}/${name}`;
  if (path === from) throw new Error(`${stage.name} is already in ${motion.name}`);
  stage.projectId = motion.id;
  stage.order = order;
  if (stage.script) stage.script = pathFrom(from, stage.script);
  stage.casts = stage.casts?.map((cast) => pathFrom(from, cast));
  for (const track of stage.composition.tracks) {
    for (const { options } of track.segments) {
      const source = options.meta?.source;
      if (typeof source === 'string') options.meta = { ...options.meta, source: pathFrom(from, source) };
    }
  }
  await move(from, path);
  await write(path, stage as never);
  return stageFile(path, stage);
}

/** Trashes stages of a project, and each one's script, once they're known and the user agrees. */
async function removeStages(path: string, ids: string[]) {
  const folder = parentOf(path);
  const files = ids.map((id) => `${folder}/${id}.stage`);
  const stages = await Promise.all(files.map((file) => documentOf(file, 'stage')));
  const names = stages.map(({ name }) => name).join(', ');
  if (!(await userAgrees(`Move ${names} to the trash?`))) return { removed: 0 };
  const scripts = stages.flatMap((stage, at) => (stage.script ? [pathFrom(files[at], stage.script)] : []));
  await trash([...files, ...scripts]);
  return { removed: ids.length };
}
