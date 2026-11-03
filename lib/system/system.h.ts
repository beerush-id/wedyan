import { createPackage } from '@irpclib/irpc';
import { z } from 'zod';
import type {
  MotionDocument,
  PersonaDocument,
  SoundDocument,
  StageDocument,
  StillDocument,
  TakeDocument,
} from '@/lib/documents/types.js';
import { wsTransport } from '@/src/api.js';

/**
 * The system's own functions for its documents, one per thing that can be done to one. The desktop
 * calls them as stubs and agents reach the same functions as tools (`sys.motion.create`), so nothing
 * is written twice. They speak home paths; a stage's frames reach them as seconds.
 */
export const sys = createPackage({
  name: 'sys',
  version: '1.0.0',
});

sys.use(wsTransport);

const homePath = (what: string) => z.string().min(3).max(1024).describe(what);
const paths = (what: string) => z.array(z.string().max(1024)).max(16).describe(what);
const records = z.record(z.string(), z.unknown());

const CWD = homePath('The folder it goes in; null for where this kind of file lives.').nullish();
const MOTION_PATH = homePath('The project, a .motion by path.');
const STAGE_PATH = homePath('The stage, a .stage by path.');
const PERSONA_PATH = homePath('The person, a .persona by path.');
const STILL_PATH = homePath('The still, a .still by path.');
const SOUND_PATH = homePath('The sound, a .sound by path.');
const TAKE_PATH = homePath('The take, a .take by path.');
const ASSET_PATH = homePath('The asset, a .still, .take or .sound by path.');
const TRACK_ID = z.string().min(1).max(64).describe('The track, by id.');
const CLIP_ID = z.string().min(1).max(64).describe('The clip, by id.');

/** How long a list one call takes: a stage's worth of anything. */
const MAX_ITEMS = 200;
const list = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(MAX_ITEMS);

/** What generating is made with: the model tier, a picture's aspect ratio, how long, how many at once. */
const generation = z.strictObject({
  model: z.string().optional(),
  aspect: z.string().optional(),
  seconds: z.number().positive().optional(),
  batch: z.number().int().min(1).max(4).optional(),
});

const castPictures = z.record(z.string(), z.array(z.string())).describe('Which of each cast’s pictures it’s made from.');

const motionInit = z.strictObject({
  name: z.string().min(1),
  script: z.string().min(1).describe('Markdown: the bible (world, tone, look, cast, locations), then the outline.'),
  aspect: z.enum(['16:9', '9:16', '1:1']).optional(),
  description: z.string().max(255).optional(),
  cover: z.string().optional(),
});

const motionChanges = motionInit.partial();

/** One keyframe of a clip, in seconds from its own start. */
const keyframe = z.strictObject({
  at: z.number().min(0),
  values: records.describe('Any of its own values, plus x, y, scale, rotate and opacity.'),
  ease: z.string().optional().describe('A GSAP ease, e.g. "power2.inOut".'),
});

const clipMeta = z.looseObject({
  source: z.string().optional().describe('The .still, .take, .sound or media file it shows, by path. A clip can have none.'),
  shows: z.string().optional().describe('What the shot shows.'),
  guide: z.string().optional().describe('The caption guide, shown until it has a picture. Not the subtitle.'),
  who: z.array(z.string()).optional().describe('Who’s in it, by name: casts may not exist yet.'),
  speaker: z.string().optional().describe('Who speaks, by name.'),
});

const clipInit = z.strictObject({
  type: z.enum(['video', 'image', 'audio', 'title', 'html', 'svg']).describe('Must fit its track: video holds video and image, html holds html and svg.'),
  at: z.number().min(0).describe('When it starts, in seconds into the stage.'),
  seconds: z.number().positive().optional().describe('How long it runs, any length. Only a sound can leave it out, to run as long as it speaks.'),
  name: z.string().optional(),
  speed: z.number().positive().optional(),
  props: records.optional().describe('What it draws: a title’s text, box and CSS; an HTML or SVG element, attrs and children. `crop`, {x, y, width, height}, each 0 to 1 of its picture, frames part of it.'),
  meta: clipMeta.optional(),
  motion: z.array(keyframe).optional(),
});

const clipChange = clipInit.partial().extend({
  clipId: CLIP_ID,
  trackId: TRACK_ID.optional().describe('Moves it to this track.'),
});

const trackInit = z.strictObject({
  name: z.string().min(1),
  type: z.enum(['video', 'audio', 'title', 'html']),
  props: records.optional().describe('What its clips read where they don’t say.'),
  clips: z.array(clipInit).max(MAX_ITEMS).optional(),
});

const trackChanges = z.strictObject({ name: z.string().min(1).optional(), props: records.optional() });

const stageInit = z.strictObject({
  name: z.string().min(1).describe('What it’s called, e.g. "Episode 1: The Lake".'),
  order: z.number().int().min(0).optional().describe('Its place in the project, from 0; the end when left out.'),
  script: z.string().optional().describe('Markdown: this stage’s script.'),
  casts: paths('Who’s in it, by .persona path; the project’s when left out.').optional(),
  tracks: z.array(trackInit).max(32).optional().describe('Its tracks and their clips; one of each kind, empty, when left out.'),
});

const stageChanges = z.strictObject({
  name: z.string().min(1).optional(),
  order: z.number().int().min(0).optional(),
  script: z.string().optional(),
  casts: paths('Who’s in it, by .persona path.').optional(),
  props: z.strictObject({ background: z.string() }).optional(),
});

const personaInit = z.strictObject({
  name: z.string().min(1),
  head: z.string().min(1).describe('What to draw: a close portrait of their face and head, with age, features, hair and the art style.'),
  body: z.string().optional().describe('What to draw: their whole body, neutral and plain, showing build, height and posture.'),
  wardrobe: z.string().optional().describe('What to draw: them full length in what they wear.'),
  kind: z.enum(['person', 'character', 'mascot']).optional(),
  description: z.string().max(255).optional(),
  voice: z.strictObject({ name: z.string(), sample: z.string().optional() }).optional(),
  attachDefault: z.boolean().optional(),
});

const personaChanges = personaInit.partial();

const stillInit = z.strictObject({
  name: z.string().min(1),
  prompt: z.string().min(1).max(4000).describe('What to draw: only what it shows.'),
  settings: generation.optional(),
  references: paths('Anything that helps draw it, by path. Never itself.').optional(),
  casts: paths('Who’s in the picture, by .persona path.').optional(),
  castPictures: castPictures.optional(),
});

const stillChanges = stillInit.partial().extend({ chosen: z.string().optional() });

/** A new attempt of a still; asking more of it than that writes it into the still first. */
const stillGeneration = z.union([
  STILL_PATH,
  z.strictObject({
    path: STILL_PATH,
    prompt: z.string().max(4000).optional(),
    settings: generation.optional(),
    references: paths('What it’s made from. The still itself keeps its subject, and isn’t kept among them.').optional(),
  }),
]);

const soundInit = z.strictObject({
  name: z.string().min(1),
  text: z.string().min(1).max(1000).describe('The words it says.'),
  prompt: z.string().optional().describe('How they’re said.'),
  voice: z.string().optional().describe('Who says them, by .persona path.'),
  kind: z.enum(['music', 'speech', 'sfx', 'ambience']).optional(),
  settings: generation.optional(),
  references: paths('Sounds it’s made from, by path.').optional(),
});

const soundChange = soundInit.partial().extend({ path: SOUND_PATH, chosen: z.string().optional() });

const takeInit = z.strictObject({
  name: z.string().min(1),
  prompt: z.string().min(1).max(4000).describe('The video prompt: what moves and how the camera moves.'),
  settings: generation.optional(),
  references: paths('What it’s made from, by path: a .still, .take, .sound, picture, video or audio. Never itself.').optional(),
  casts: paths('Who’s in it, by .persona path.').optional(),
  castPictures: castPictures.optional(),
});

const takeChange = takeInit.partial().extend({ path: TAKE_PATH, chosen: z.string().optional() });

const assetInit = z.discriminatedUnion('type', [
  stillInit.extend({ type: z.literal('still') }),
  soundInit.extend({ type: z.literal('sound') }),
  takeInit.extend({ type: z.literal('take') }),
]);

export type MotionInit = z.infer<typeof motionInit>;
export type MotionChanges = z.infer<typeof motionChanges>;
export type StageInit = z.infer<typeof stageInit>;
export type StageChanges = z.infer<typeof stageChanges>;
export type TrackInit = z.infer<typeof trackInit>;
export type TrackChanges = z.infer<typeof trackChanges>;
export type ClipInit = z.infer<typeof clipInit>;
export type ClipChange = z.infer<typeof clipChange>;
export type PersonaInit = z.infer<typeof personaInit>;
export type PersonaChanges = z.infer<typeof personaChanges>;
export type StillInit = z.infer<typeof stillInit>;
export type StillChanges = z.infer<typeof stillChanges>;
export type StillGeneration = z.infer<typeof stillGeneration>;
export type SoundInit = z.infer<typeof soundInit>;
export type SoundChange = z.infer<typeof soundChange>;
export type TakeInit = z.infer<typeof takeInit>;
export type TakeChange = z.infer<typeof takeChange>;
export type AssetInit = z.infer<typeof assetInit>;

/** A clip as the tools read it: flat, in seconds. */
export type Clip = ClipInit & { id: string; seconds: number };
/** A track as the tools read it. */
export type Track = { id: string; name: string; type: string; props: Record<string, unknown>; clips: Clip[] };

export type MotionFile = MotionDocument & {
  path: string;
  /** Its stages played one after another; never stored. */
  seconds: number;
  /** A link that opens it. */
  open: string;
  stages: { id: string; path: string; name: string; order: number; seconds: number }[];
};

export type StageFile = Omit<StageDocument, 'composition'> & {
  path: string;
  props: StageDocument['composition']['props'];
  seconds: number;
  tracks: Track[];
  /** Clips that should have a picture or a sound and have no source, by id. */
  unfilled: string[];
  /** Clips whose source has nothing to show yet. */
  failed: { clip: string; source: string; why: string }[];
};

export type PersonaFile = PersonaDocument & { path: string; failed?: string };
export type StillFile = StillDocument & { path: string; failed?: string };
export type SoundFile = SoundDocument & { path: string; seconds?: number; failed?: string };
export type TakeFile = TakeDocument & { path: string };
export type AssetFile = StillFile | SoundFile | TakeFile;

export type Deleted = { deleted: number };
export type Removed = { removed: number };

export const motionCreate = sys.declare<(cwd: string | null | undefined, items: MotionInit[]) => Promise<MotionFile[]>>({
  name: 'motion.create',
  description: 'Starts Motion projects, each in its own folder, its script holding the bible and outline. Its stages, casts and assets are added to it after.',
  schema: { input: [CWD, list(motionInit)] },
  mcp: { args: ['cwd', 'items'] },
});

export const motionRead = sys.declare<(motionPath: string) => Promise<MotionFile>>({
  name: 'motion.read',
  description: 'Reads a project: what it is, its stages in order, its casts and assets. `script.path` is its script, for r2-file.read.',
  schema: { input: [MOTION_PATH] },
  mcp: { args: ['motionPath'], readOnlyHint: true },
});

export const motionEdit = sys.declare<(motionPath: string, changes: MotionChanges) => Promise<MotionFile>>({
  name: 'motion.edit',
  description: 'Changes a project; `script` replaces its script. Only what’s named changes.',
  schema: { input: [MOTION_PATH, motionChanges] },
  mcp: { args: ['motionPath', 'changes'] },
});

export const motionDelete = sys.declare<(motionPath: string) => Promise<Deleted>>({
  name: 'motion.delete',
  description: 'Moves a project and its folder to the trash, once the user says yes; it asks them itself. Says deleted: 0 if they say no.',
  schema: { input: [MOTION_PATH] },
  mcp: { args: ['motionPath'], destructiveHint: true },
});

export const motionStageGet = sys.declare<(motionPath: string, stageId: string) => Promise<StageFile>>({
  name: 'motion.stage.get',
  description: 'Reads one of a project’s stages by id, whole: its tracks and clips, what’s unfilled and what failed.',
  schema: { input: [MOTION_PATH, z.string().min(1).max(64).describe('The stage, by id.')] },
  mcp: { args: ['motionPath', 'stageId'], readOnlyHint: true },
});

export const motionStageAdd = sys.declare<(motionPath: string, items: (string | StageInit)[]) => Promise<StageFile[]>>({
  name: 'motion.stage.add',
  description: 'Adds stages to a project: new ones, with their tracks and clips if they have them, or by path, moving a stage here from another project. Clips need no source yet.',
  schema: { input: [MOTION_PATH, list(z.union([STAGE_PATH, stageInit]))] },
  mcp: { args: ['motionPath', 'items'] },
});

export const motionStageRemove = sys.declare<(motionPath: string, stageIds: string[]) => Promise<Removed>>({
  name: 'motion.stage.remove',
  description: 'Moves a project’s stages to the trash, once the user says yes; it asks them itself. Says removed: 0 if they say no.',
  schema: { input: [MOTION_PATH, list(z.string().min(1).max(64))] },
  mcp: { args: ['motionPath', 'stageIds'], destructiveHint: true },
});

export const motionCastGet = sys.declare<(motionPath: string, personaPath: string) => Promise<PersonaFile>>({
  name: 'motion.cast.get',
  description: 'Reads someone in a project.',
  schema: { input: [MOTION_PATH, PERSONA_PATH] },
  mcp: { args: ['motionPath', 'personaPath'], readOnlyHint: true },
});

export const motionCastAdd = sys.declare<(motionPath: string, items: (string | PersonaInit)[]) => Promise<PersonaFile[]>>({
  name: 'motion.cast.add',
  description: 'Puts people in a project: someone who exists, by path, or someone new, made first. Each new picture takes a while.',
  schema: { input: [MOTION_PATH, list(z.union([PERSONA_PATH, personaInit]))] },
  mcp: { args: ['motionPath', 'items'] },
});

export const motionCastRemove = sys.declare<(motionPath: string, personaPaths: string[]) => Promise<Removed>>({
  name: 'motion.cast.remove',
  description: 'Takes people out of a project. They stay in People.',
  schema: { input: [MOTION_PATH, list(PERSONA_PATH)] },
  mcp: { args: ['motionPath', 'personaPaths'] },
});

export const motionAssetGet = sys.declare<(motionPath: string, assetPath: string) => Promise<AssetFile>>({
  name: 'motion.asset.get',
  description: 'Reads something a project holds.',
  schema: { input: [MOTION_PATH, ASSET_PATH] },
  mcp: { args: ['motionPath', 'assetPath'], readOnlyHint: true },
});

export const motionAssetAdd = sys.declare<(motionPath: string, items: (string | AssetInit)[]) => Promise<AssetFile[]>>({
  name: 'motion.asset.add',
  description: 'Gives a project stills, takes and sounds: ones that exist, by path, or new ones, written in its folder. New stills and sounds are generated; a new take isn’t.',
  schema: { input: [MOTION_PATH, list(z.union([ASSET_PATH, assetInit]))] },
  mcp: { args: ['motionPath', 'items'] },
});

export const motionAssetRemove = sys.declare<(motionPath: string, assetPaths: string[]) => Promise<Removed>>({
  name: 'motion.asset.remove',
  description: 'Takes assets out of a project. Their files stay.',
  schema: { input: [MOTION_PATH, list(ASSET_PATH)] },
  mcp: { args: ['motionPath', 'assetPaths'] },
});

export const stageRead = sys.declare<(stagePath: string) => Promise<StageFile>>({
  name: 'stage.read',
  description: 'Reads a stage whole: its tracks and clips with their times, its length, what’s unfilled and what failed.',
  schema: { input: [STAGE_PATH] },
  mcp: { args: ['stagePath'], readOnlyHint: true },
});

export const stageEdit = sys.declare<(stagePath: string, changes: StageChanges) => Promise<StageFile>>({
  name: 'stage.edit',
  description: 'Changes a stage’s own fields; `script` replaces its script. Its tracks and clips have their own tools.',
  schema: { input: [STAGE_PATH, stageChanges] },
  mcp: { args: ['stagePath', 'changes'] },
});

export const trackGet = sys.declare<(stagePath: string, trackId: string) => Promise<Track>>({
  name: 'stage.track.get',
  description: 'Reads one track with its clips.',
  schema: { input: [STAGE_PATH, TRACK_ID] },
  mcp: { args: ['stagePath', 'trackId'], readOnlyHint: true },
});

export const trackAdd = sys.declare<(stagePath: string, init: TrackInit) => Promise<Track>>({
  name: 'stage.track.add',
  description: 'Adds a track, later ones drawing over earlier ones. A title track named Subtitles is set low on the stage.',
  schema: { input: [STAGE_PATH, trackInit] },
  mcp: { args: ['stagePath', 'init'] },
});

export const trackEdit = sys.declare<(stagePath: string, trackId: string, changes: TrackChanges) => Promise<Track>>({
  name: 'stage.track.edit',
  description: 'Renames a track or changes what its clips read where they don’t say.',
  schema: { input: [STAGE_PATH, TRACK_ID, trackChanges] },
  mcp: { args: ['stagePath', 'trackId', 'changes'] },
});

export const trackRemove = sys.declare<(stagePath: string, trackId: string) => Promise<Removed>>({
  name: 'stage.track.remove',
  description: 'Removes a track and its clips.',
  schema: { input: [STAGE_PATH, TRACK_ID] },
  mcp: { args: ['stagePath', 'trackId'] },
});

export const clipGet = sys.declare<(stagePath: string, trackId: string, clipId: string) => Promise<Clip>>({
  name: 'stage.track.clip.get',
  description: 'Reads one clip.',
  schema: { input: [STAGE_PATH, TRACK_ID, CLIP_ID] },
  mcp: { args: ['stagePath', 'trackId', 'clipId'], readOnlyHint: true },
});

export const clipAdd = sys.declare<(stagePath: string, trackId: string, items: ClipInit[]) => Promise<Clip[]>>({
  name: 'stage.track.clip.add',
  description: 'Adds clips to a track at exact times. Clips on one track can’t overlap, and the error names the clash.',
  schema: { input: [STAGE_PATH, TRACK_ID, list(clipInit)] },
  mcp: { args: ['stagePath', 'trackId', 'items'] },
});

export const clipEdit = sys.declare<(stagePath: string, trackId: string, items: ClipChange[]) => Promise<Clip[]>>({
  name: 'stage.track.clip.edit',
  description: 'Changes clips: only the fields named, so giving one `meta.source` keeps its timing. Naming a source again shows what that file shows now.',
  schema: { input: [STAGE_PATH, TRACK_ID, list(clipChange)] },
  mcp: { args: ['stagePath', 'trackId', 'items'] },
});

export const clipRemove = sys.declare<(stagePath: string, trackId: string, clipIds: string[]) => Promise<Removed>>({
  name: 'stage.track.clip.remove',
  description: 'Removes clips from a track.',
  schema: { input: [STAGE_PATH, TRACK_ID, list(CLIP_ID)] },
  mcp: { args: ['stagePath', 'trackId', 'clipIds'] },
});

export const personaCreate = sys.declare<(cwd: string | null | undefined, items: PersonaInit[]) => Promise<PersonaFile[]>>({
  name: 'persona.create',
  description: 'Makes people, with a generated face, and a figure and outfit if asked, that stay with them wherever they’re cast. Each picture takes a while. Says failed if one didn’t come back.',
  schema: { input: [CWD, list(personaInit)] },
  mcp: { args: ['cwd', 'items'] },
});

export const personaRead = sys.declare<(personaPath: string) => Promise<PersonaFile>>({
  name: 'persona.read',
  description: 'Reads a person. `head.main`, `body.main` and `wardrobe.main` are stills, by path from the persona.',
  schema: { input: [PERSONA_PATH] },
  mcp: { args: ['personaPath'], readOnlyHint: true },
});

export const personaEdit = sys.declare<(personaPath: string, changes: PersonaChanges) => Promise<PersonaFile>>({
  name: 'persona.edit',
  description: 'Changes a person. `head`, `body` and `wardrobe` change what’s asked of those pictures; nothing is drawn until sys.persona.generate.',
  schema: { input: [PERSONA_PATH, personaChanges] },
  mcp: { args: ['personaPath', 'changes'] },
});

export const personaDelete = sys.declare<(personaPath: string) => Promise<Deleted>>({
  name: 'persona.delete',
  description: 'Moves a person to the trash, once the user says yes; it asks them itself. Says deleted: 0 if they say no.',
  schema: { input: [PERSONA_PATH] },
  mcp: { args: ['personaPath'], destructiveHint: true },
});

export const personaGenerate = sys.declare<(personaPath: string, part: 'head' | 'body' | 'wardrobe') => Promise<PersonaFile>>({
  name: 'persona.generate',
  description: 'Draws one of a person’s pictures again.',
  schema: { input: [PERSONA_PATH, z.enum(['head', 'body', 'wardrobe'])] },
  mcp: { args: ['personaPath', 'part'] },
});

export const stillCreate = sys.declare<(cwd: string | null | undefined, items: StillInit[]) => Promise<StillFile[]>>({
  name: 'still.create',
  description: 'Makes stills, each generated once. It’s kept even if no picture comes back, saying failed, so sys.still.generate can try again.',
  schema: { input: [CWD, list(stillInit)] },
  mcp: { args: ['cwd', 'items'] },
});

export const stillRead = sys.declare<(stillPath: string) => Promise<StillFile>>({
  name: 'still.read',
  description: 'Reads a still: its prompt, what it’s made from, and every attempt.',
  schema: { input: [STILL_PATH] },
  mcp: { args: ['stillPath'], readOnlyHint: true },
});

export const stillEdit = sys.declare<(stillPath: string, changes: StillChanges) => Promise<StillFile>>({
  name: 'still.edit',
  description: 'Changes a still. Nothing is drawn: that’s sys.still.generate. `chosen` picks the attempt it shows.',
  schema: { input: [STILL_PATH, stillChanges] },
  mcp: { args: ['stillPath', 'changes'] },
});

export const stillDelete = sys.declare<(stillPath: string) => Promise<Deleted>>({
  name: 'still.delete',
  description: 'Moves a still to the trash, once the user says yes; it asks them itself. Says deleted: 0 if they say no.',
  schema: { input: [STILL_PATH] },
  mcp: { args: ['stillPath'], destructiveHint: true },
});

export const stillGenerate = sys.declare<(items: StillGeneration[]) => Promise<StillFile[]>>({
  name: 'still.generate',
  description: 'Makes a new attempt of each still, which it then shows. A path makes more of the same. To change one (an expression, a pose, a detail), pass its prompt with the change and the still itself in references, so it stays the same subject. A clip keeps its picture until its `meta.source` is named again.',
  schema: { input: [list(stillGeneration)] },
  mcp: { args: ['items'] },
});

export const soundCreate = sys.declare<(cwd: string | null | undefined, items: SoundInit[]) => Promise<SoundFile[]>>({
  name: 'sound.create',
  description: 'Makes spoken lines and speaks each once, returning how long it really runs (seconds). It’s kept even if it couldn’t be spoken, saying failed, so sys.sound.generate can try again.',
  schema: { input: [CWD, list(soundInit)] },
  mcp: { args: ['cwd', 'items'] },
});

export const soundRead = sys.declare<(soundPath: string) => Promise<SoundFile>>({
  name: 'sound.read',
  description: 'Reads a sound: its words, how they’re said, how long it runs, and every attempt.',
  schema: { input: [SOUND_PATH] },
  mcp: { args: ['soundPath'], readOnlyHint: true },
});

export const soundEdit = sys.declare<(items: SoundChange[]) => Promise<SoundFile[]>>({
  name: 'sound.edit',
  description: 'Changes sounds. Nothing is spoken: that’s sys.sound.generate. `chosen` picks the attempt it plays.',
  schema: { input: [list(soundChange)] },
  mcp: { args: ['items'] },
});

export const soundDelete = sys.declare<(soundPaths: string[]) => Promise<Deleted>>({
  name: 'sound.delete',
  description: 'Moves sounds to the trash, once the user says yes; it asks them itself. Says deleted: 0 if they say no.',
  schema: { input: [list(SOUND_PATH)] },
  mcp: { args: ['soundPaths'], destructiveHint: true },
});

export const soundGenerate = sys.declare<(soundPaths: string[]) => Promise<SoundFile[]>>({
  name: 'sound.generate',
  description: 'Speaks each sound again as a new attempt, which it then plays, returning how long it really runs (seconds). No clip moves.',
  schema: { input: [list(SOUND_PATH)] },
  mcp: { args: ['soundPaths'] },
});

export const takeCreate = sys.declare<(cwd: string | null | undefined, items: TakeInit[]) => Promise<TakeFile[]>>({
  name: 'take.create',
  description: 'Writes takes: the video each will be, ready for the user to generate. Nothing is generated. On a clip, a take with no attempts shows the first picture among its references.',
  schema: { input: [CWD, list(takeInit)] },
  mcp: { args: ['cwd', 'items'] },
});

export const takeRead = sys.declare<(takePath: string) => Promise<TakeFile>>({
  name: 'take.read',
  description: 'Reads a take: its video prompt, settings, what it’s made from, and every attempt.',
  schema: { input: [TAKE_PATH] },
  mcp: { args: ['takePath'], readOnlyHint: true },
});

export const takeEdit = sys.declare<(items: TakeChange[]) => Promise<TakeFile[]>>({
  name: 'take.edit',
  description: 'Changes takes. `chosen` picks the attempt it shows.',
  schema: { input: [list(takeChange)] },
  mcp: { args: ['items'] },
});

export const takeDelete = sys.declare<(takePaths: string[]) => Promise<Deleted>>({
  name: 'take.delete',
  description: 'Moves takes to the trash, once the user says yes; it asks them itself. Says deleted: 0 if they say no.',
  schema: { input: [list(TAKE_PATH)] },
  mcp: { args: ['takePaths'], destructiveHint: true },
});
