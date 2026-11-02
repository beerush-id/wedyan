# System document tools

Wedyan's system tools for its documents: 42, each named after what it acts on. They belong to the whole system, not to one app, so no app or skill writes its own version. A skill lists the ones it uses in its `tools` frontmatter, and the Motion skill uses all of them.

**None is built yet.** `SKILL.md` can be written against this list; final names and fields are confirmed when they ship.

## Reading a signature

- `...Path` is a file on the drive. `...Id` is something inside a file already named.
- `...x[]` is a list. On the wire it's the `items` field: `sys.still.create(null, a, b)` is `{ "cwd": null, "items": [a, b] }`.
- `?` is optional.

## Tools

```ts
// Project
sys.motion.create(cwd, ...MotionInit[]) -> MotionFile[]
sys.motion.read(motionPath) -> MotionFile
sys.motion.edit(motionPath, changes) -> MotionFile
sys.motion.delete(motionPath) -> Deleted

// What a project holds
sys.motion.stage.get(motionPath, stageId) -> StageFile
sys.motion.stage.add(motionPath, ...(stagePath | StageInit)[]) -> StageFile[]
sys.motion.stage.remove(motionPath, ...stageId[]) -> Removed

sys.motion.cast.get(motionPath, personaPath) -> PersonaFile
sys.motion.cast.add(motionPath, ...(personaPath | PersonaInit)[]) -> PersonaFile[]
sys.motion.cast.remove(motionPath, ...personaPath[]) -> Removed

sys.motion.asset.get(motionPath, assetPath) -> AssetFile
sys.motion.asset.add(motionPath, ...(assetPath | AssetInit)[]) -> AssetFile[]
sys.motion.asset.remove(motionPath, ...assetPath[]) -> Removed

// A stage
sys.stage.read(stagePath) -> StageFile
sys.stage.edit(stagePath, changes) -> StageFile

sys.stage.track.get(stagePath, trackId) -> Track
sys.stage.track.add(stagePath, TrackInit) -> Track
sys.stage.track.edit(stagePath, trackId, changes) -> Track
sys.stage.track.remove(stagePath, trackId) -> Removed

sys.stage.track.clip.get(stagePath, trackId, clipId) -> Clip
sys.stage.track.clip.add(stagePath, trackId, ...ClipInit[]) -> Clip[]
sys.stage.track.clip.edit(stagePath, trackId, ...ClipChange[]) -> Clip[]
sys.stage.track.clip.remove(stagePath, trackId, ...clipId[]) -> Removed

// A person
sys.persona.create(cwd, ...PersonaInit[]) -> PersonaFile[]
sys.persona.read(personaPath) -> PersonaFile
sys.persona.edit(personaPath, changes) -> PersonaFile
sys.persona.delete(personaPath) -> Deleted
sys.persona.generate(personaPath, part) -> PersonaFile

// A picture
sys.still.create(cwd, ...StillInit[]) -> StillFile[]
sys.still.read(stillPath) -> StillFile
sys.still.edit(stillPath, changes) -> StillFile
sys.still.delete(stillPath) -> Deleted
sys.still.generate(...stillPath[]) -> StillFile[]

// A spoken line
sys.sound.create(cwd, ...SoundInit[]) -> SoundFile[]
sys.sound.read(soundPath) -> SoundFile
sys.sound.edit(...SoundChange[]) -> SoundFile[]
sys.sound.delete(...soundPath[]) -> Deleted
sys.sound.generate(...soundPath[]) -> SoundFile[]

// A video spec
sys.take.create(cwd, ...TakeInit[]) -> TakeFile[]
sys.take.read(takePath) -> TakeFile
sys.take.edit(...TakeChange[]) -> TakeFile[]
sys.take.delete(...takePath[]) -> Deleted
```

## Shapes

Files are the documents in `lib/documents/types.ts`, field for field, with what's added here. Those field names are the only ones used.

```ts
type MotionInit = {
  name: string;
  script: string; // Markdown. Written to its own file; `script.path` on the document says where.
  aspect?: string;
  description?: string;
  cover?: string;
};
type MotionFile = MotionDocument & {
  path: string;
  seconds: number; // Its stages played one after another; never stored.
  open: string; // A link that opens it.
  stages: { id: string; path: string; name: string; order: number; seconds: number }[];
};

type StageInit = { name: string; order: number; script?: string; casts?: string[]; tracks?: TrackInit[] }; // script: Markdown.
type StageFile = Omit<StageDocument, 'composition'> & {
  path: string;
  props: { width: number; height: number; background?: string };
  seconds: number;
  tracks: Track[];
  unfilled: string[]; // Clips with no source, by id.
  failed: { clip: string; source: string; why: string }[];
};

type TrackType = 'video' | 'audio' | 'title' | 'html';
type TrackInit = { name: string; type: TrackType; props?: object; clips?: ClipInit[] };
type Track = { id: string; name: string; type: TrackType; props: object; clips: Clip[] };

type ClipType = 'video' | 'image' | 'audio' | 'title' | 'html' | 'svg';
type ClipInit = {
  type: ClipType; // Must fit its track: video holds video and image, html holds html and svg.
  at: number; // Seconds into the stage.
  seconds: number; // Any length.
  name?: string;
  speed?: number;
  props?: object; // What it draws, and `crop`: { x, y, width, height }, each 0 to 1 of its picture.
  meta?: {
    source?: string; // A .still, .take, .sound or media file, by path. A clip can have none.
    shows?: string; // What the shot shows.
    guide?: string; // The caption guide. Not the subtitle.
    who?: string[]; // Who's in it, by name: casts may not exist yet.
    speaker?: string; // Who speaks, by name.
  };
  motion?: Keyframe[];
};
type Clip = ClipInit & { id: string };
type ClipChange = Partial<ClipInit> & { clipId: string; trackId?: string }; // trackId moves it.
type Keyframe = { at: number; values: object; ease?: string }; // Seconds from the clip's start; a GSAP ease.

type PersonaInit = {
  name: string;
  head: string; // The prompt for their face. It's kept on the `Head.still` it makes, not on the persona.
  body?: string; // The prompt for their figure, kept the same way.
  wardrobe?: string; // The prompt for their outfit, kept the same way.
  kind?: PersonaDocument['kind'];
  description?: string;
  voice?: PersonaDocument['voice'];
  attachDefault?: boolean;
};
type PersonaFile = PersonaDocument & { path: string; failed?: string };
// sys.persona.generate's part: 'head' | 'body' | 'wardrobe'. `head.main`, `body.main` and
// `wardrobe.main` are .still paths: sys.still.read and sys.still.edit reach their prompts.

type StillInit = Pick<StillDocument, 'name' | 'prompt'> &
  Partial<Pick<StillDocument, 'settings' | 'references' | 'casts' | 'castPictures'>>;
type StillFile = StillDocument & { path: string; failed?: string };

type SoundInit = {
  name: string;
  text: string; // The words it says.
  prompt?: string; // How they're said.
  voice?: string; // Who says them, by .persona path.
  kind?: SoundDocument['kind']; // `speech` unless it says; speech is all that's generated today.
  settings?: SoundDocument['settings'];
  references?: string[];
};
type SoundFile = SoundDocument & { path: string; seconds?: number; failed?: string }; // seconds: its chosen attempt's.
type SoundChange = Partial<SoundInit> & { path: string; chosen?: string };

type TakeInit = Pick<TakeDocument, 'name' | 'prompt'> & // prompt: the video prompt.
  Partial<Pick<TakeDocument, 'settings' | 'references' | 'casts' | 'castPictures'>>;
type TakeFile = TakeDocument & { path: string };
type TakeChange = Partial<TakeInit> & { path: string; chosen?: string };

type AssetInit = ({ type: 'still' } & StillInit) | ({ type: 'sound' } & SoundInit) | ({ type: 'take' } & TakeInit);
type AssetFile = StillFile | SoundFile | TakeFile;

type Deleted = { deleted: number }; // 0 when the user said no.
type Removed = { removed: number };
```

`changes` on a single file is a partial of its init, plus `chosen` on a still.

**Where a stage's shape differs from storage.** A stored track is `{id, options: {type, name, meta}, props, segments}` and a stored clip is `{id, options: {speed, duration, type, name, meta, startFrame}, props, scenes}`. The tools show `options` flat, `segments` as `clips`, frames as seconds in `at` and `seconds`, and `scenes` as `motion`. They convert both ways, and nothing else differs. `shows`, `guide`, `who` and `speaker` are new keys in `meta`, and `crop` is a new key in `props`. No stored type changes.

## How they behave

**`cwd`.** Where a new file goes. `null` falls back to the tool's home:

| Tool | `null` means |
|---|---|
| `sys.motion.create` | `~/Motions` |
| `sys.persona.create` | `~/People` |
| `sys.still.create` | `~/Stills` |
| `sys.sound.create` | `~/Sounds` |
| `sys.take.create` | `~/Takes` |

A stage has no `create`: it's always next to its `.motion`, so `sys.motion.stage.add` writes it there. `sys.motion.asset.add` with an init writes into the project's folder.

**`create` and `add` on relations.**
- `create` only makes a file. Nothing joins a project until `sys.motion.cast.add` or `sys.motion.asset.add` links it. Passing an init there makes and links it in one call.
- `sys.motion.stage.add` with a `stagePath` moves that stage from its project, rewriting its paths.
- `sys.motion.cast.remove` and `sys.motion.asset.remove` only unlink.

**Generating.**
- `sys.persona.create`, `sys.still.create` and `sys.sound.create` make the file and its first attempt.
- `generate` makes a new attempt. `edit` never generates, so changing a prompt costs nothing until `generate` is called.
- `sys.take.create` generates nothing, and there is no `sys.take.generate`. The agent never makes video.
- A failed generation leaves the file in place with `failed` saying why, so `generate` can retry it.
- Generating never moves or touches a clip. A new length comes back as `seconds`, and fitting the cut to it is a separate `sys.stage.track.clip.edit`.

**Clips.**
- `sys.stage.track.clip.edit` changes only the fields it names, so attaching `meta.source` keeps the timing.
- `add` and `edit` refuse a clip that overlaps another on its track, or a `type` the track can't hold, and the error names the clash.
- A subtitle is a `title` clip on a subtitle track, with its own timing, separate from `meta.guide`.
- Removing a track takes its clips with it.

**Asking first.** These need the user's yes through `ask_user`: `sys.motion.delete`, `sys.motion.stage.remove`, and `delete` on persona, still, sound and take. They move files to the trash. Nothing else asks, including removing a track or clip, because no file goes away. How the tool enforces the yes is still open.

**Parallel.** Calls in one turn run together, so one stage's work can run alongside another's. Later calls that need a returned path or id must wait for a later turn.

## Stage changes these tools rely on

- A clip with no source renders, showing its `meta.guide` over the background. (Proposed, not yet confirmed.)
- A take with no attempts shows its referenced still.
- A clip honours `crop`, so one still can act as several shots.

## Motion skill changes

- Remove `r2-file.write` and `r2-file.mkdir`: the object tools are the only way to write a Motion file.
- Remove `sys.motion.cast`, `sys.motion.still` and `sys.motion.stage` as they are today.
- Keep `r2-file.list`, `read`, `search` and `stat`, and the actions.

**Turn limit.** It stays at 12 until changed. A 10-episode run needs about 11 turns with nothing to retry, so the Motion skill is proposed to get 30.

## Tools for each step of the Motion storyboard spec

| Step | Tools |
|---|---|
| Write the script | `sys.motion.create` |
| Create stages and lay out shots | `sys.motion.stage.add` with nested tracks and clips |
| Lay in spoken words | `sys.sound.create`, then `sys.stage.track.clip.add` |
| Edit the cut | `sys.stage.read`, then `sys.stage.track.clip.add`, `edit`, `remove` |
| Make casts and stills | `sys.motion.cast.add`, `sys.motion.asset.add` |
| Prepare the takes | `sys.motion.asset.add`, then `sys.stage.track.clip.edit` with `meta.source` |
| Dress the timeline | `sys.stage.track.clip.add`, `edit`, `sys.stage.track.edit` |
| Review as a viewer | `sys.stage.read`, whose `unfilled` and `failed` list what's missing |
| Hand over | `app.open` |
