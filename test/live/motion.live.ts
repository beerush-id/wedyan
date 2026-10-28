import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

// Asks Muse models to edit a real Motion composition through one native tool, `motion.edit`, applies
// the ops they send to a copy of the snapshot, and checks the result: ids, durations, overlaps, frame
// math, and what each task asked for. Writes every sample to MOTION_OUT (if set) and a table to stdout.

const KEY = process.env.MUSE_API_KEY ?? '';
const BASE = 'https://api.meta.ai/v1';
const RUNS = Number(process.env.MOTION_RUNS ?? 2);
const TOOL = 'motion__edit';

type Config = { model: string; effort?: string };

const CONFIGS: Config[] = [
  { model: 'muse-spark-1.3', effort: 'minimal' },
  { model: 'muse-spark-1.3' },
  { model: 'muse-wonder-1.0', effort: 'low' },
];

type Scene = { id: string; options: { atFrame: number; meta?: { ease?: string } }; data: Record<string, unknown> };
type Segment = {
  id: string;
  options: { type: string; name: string; speed: number; duration: number; startFrame: number; meta?: Record<string, unknown> };
  props: Record<string, unknown>;
  scenes?: Scene[];
};
type Track = { id: string; options: { type: string; name: string }; segments: Segment[] };
type Composition = {
  id: string;
  options: { frameRate: number };
  props: { width: number; height: number; background?: string };
  tracks: Track[];
};
type Project = { id: string; name: string; composition: Composition };

/** One edit the Motion agent asks for; which fields matter depends on `op`. */
type Op = {
  op: string;
  segment?: string;
  track?: string;
  after?: string;
  startFrame?: unknown;
  duration?: unknown;
  speed?: unknown;
  atFrame?: unknown;
  data?: Record<string, unknown>;
  ease?: string;
  clip?: { id?: string; name?: string; href?: string; duration?: unknown };
};

const PROJECTS = JSON.parse(
  readFileSync(new URL('../../apps/motions/data/projects.json', import.meta.url), 'utf8'),
) as Project[];
const PROJECT = PROJECTS.find((project) => project.id === 'm01') as Project;

/** The composition schema, shared by the edit and the generate prompts. */
const SCHEMA = `- options.frameRate: frames per second.
- tracks[]: { id, options: { type: video | audio | text | effect, name }, segments[] }.
- segment: { id, options: { type, name, speed, duration, startFrame }, props, scenes? }
  - startFrame: where the segment starts on the timeline, in FRAMES (whole number).
  - duration: how long it lasts on the timeline, in SECONDS. It ends at frame startFrame + duration × frameRate.
  - speed: the source's playback rate (1 normal, 0.5 half speed, 2 double).
  - props: the layer's own values (x, y, width, height, scale, rotate, opacity, href, text…).
- scenes[]: keyframes { id, options: { atFrame, meta?: { ease } }, data }. atFrame is in FRAMES from the segment's own start (0 = its first frame). data holds the layer's values at that moment; numbers ease toward the next keyframe (ease: linear | in | out | in-out).
- "Clips" are the segments on the video track, in startFrame order. Titles, audio and effects are other layers.
- The composition runs until the end of its last segment on any track.`;

const SYSTEM = `You are the Motion agent in Wedyan, a video editor. You edit the user's project only by calling ${TOOL} once, with every op the task needs, in order. Do not answer in prose instead of calling it.

The project's composition (sent as context) is a timeline snapshot:
${SCHEMA}

Ops, applied literally and in order. Nothing ripples: if a change leaves a gap or an overlap, move the later segments yourself.
- trim { segment, duration }: set its duration, in seconds.
- move { segment, startFrame }: set its start frame.
- insert { track, after?, startFrame?, clip: { name, href, duration } }: add an image clip that fills the stage; it starts where segment \`after\` ends, or at startFrame.
- remove { segment }: delete it.
- speed { segment, speed }: set its playback rate.
- keyframe { segment, atFrame, data, ease? }: set a keyframe; merges into one already at that frame.

Rules: segments on one track never overlap; durations are > 0 and land on whole frames; startFrame and atFrame are whole numbers.`;

const EDIT_TOOL = {
  type: 'function',
  name: TOOL,
  description: "Apply edits to a Motion project's composition, in order.",
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'The project id.' },
      ops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['trim', 'move', 'insert', 'remove', 'speed', 'keyframe'] },
            segment: { type: 'string', description: 'Segment id (trim, move, remove, speed, keyframe).' },
            track: { type: 'string', description: 'Track id (insert).' },
            after: { type: 'string', description: 'Segment id the new clip follows (insert).' },
            startFrame: { type: 'integer', description: 'Timeline frame (move, insert).' },
            duration: { type: 'number', description: 'Seconds (trim).' },
            speed: { type: 'number', description: 'Playback rate (speed).' },
            atFrame: { type: 'integer', description: "Frame from the segment's start (keyframe)." },
            data: { type: 'object', description: 'Layer values at that frame (keyframe).' },
            ease: { type: 'string', enum: ['linear', 'in', 'out', 'in-out'] },
            clip: {
              type: 'object',
              description: 'The new clip (insert).',
              properties: { name: { type: 'string' }, href: { type: 'string' }, duration: { type: 'number', description: 'Seconds.' } },
              required: ['name', 'href', 'duration'],
            },
          },
          required: ['op'],
        },
      },
    },
    required: ['project', 'ops'],
  },
};

type Outcome = { error?: string; notes: string[] };
type Task = { name: string; prompt: string; fixture: Composition; check: (before: Composition, after: Composition) => Outcome };

const close = (a: number | undefined, b: number, tolerance = 1e-6) => a !== undefined && Math.abs(a - b) <= tolerance;
const segment = (composition: Composition, id: string) =>
  composition.tracks.flatMap((track) => track.segments).find((item) => item.id === id);
const ends = (item: Segment, fps: number) => item.options.startFrame + item.options.duration * fps;
const clips = (composition: Composition) =>
  composition.tracks
    .filter((track) => track.options.type === 'video')
    .flatMap((track) => track.segments)
    .sort((a, b) => a.options.startFrame - b.options.startFrame);

/** How long a composition runs, in seconds, the way the app's `runtime` measures it. */
const runtime = (composition: Composition) =>
  Math.max(
    0,
    ...composition.tracks.flatMap((track) =>
      track.segments.map((item) => item.options.startFrame / composition.options.frameRate + item.options.duration),
    ),
  );

/** A numeric layer value at a frame local to the segment, eased the way the app samples keyframes. */
function valueAt(item: Segment, local: number, key: string): number | undefined {
  const scenes = item.scenes ?? [];
  const own = item.props[key];
  if (!scenes.length) return typeof own === 'number' ? own : undefined;
  const index = scenes.findLastIndex((scene) => scene.options.atFrame <= local);
  const from = scenes[Math.max(index, 0)];
  const to = index < 0 ? undefined : scenes[index + 1];
  const start = (from.data[key] ?? own) as number | undefined;
  if (!to || typeof to.data[key] !== 'number' || typeof start !== 'number') return start;
  const t = Math.min(1, Math.max(0, (local - from.options.atFrame) / (to.options.atFrame - from.options.atFrame)));
  return start + ((to.data[key] as number) - start) * t;
}

/** The fixture for "remove the shortest clip": the middle clip is the one shortest segment, so the ask is unambiguous. */
function shortMiddleClip(base: Composition): Composition {
  const composition = structuredClone(base);
  const middle = segment(composition, 'm01-v2') as Segment;
  middle.options.duration = 2.5;
  (middle.scenes as Scene[])[1].options.atFrame = 75;
  (segment(composition, 'm01-v3') as Segment).options.startFrame = 195;
  (segment(composition, 'm01-a1') as Segment).options.duration = 10.5;
  const title = segment(composition, 'm01-t2') as Segment;
  title.options.startFrame = 125;
  title.options.duration = 2;
  (title.scenes as Scene[])[2].options.atFrame = 45;
  (title.scenes as Scene[])[3].options.atFrame = 60;
  (segment(composition, 'm01-t3') as Segment).options.startFrame = 210;
  return composition;
}

const TASKS: Task[] = [
  {
    name: 'trim',
    prompt: 'Trim the second clip to 3 seconds.',
    fixture: PROJECT.composition,
    check: (_, after) => {
      const middle = segment(after, 'm01-v2');
      if (!middle) return { error: 'm01-v2 missing', notes: [] };
      const next = segment(after, 'm01-v3');
      const notes = [next?.options.startFrame === 210 ? 'closed the gap' : `left v3 at ${next?.options.startFrame}`];
      if (!close(middle.options.duration, 3)) return { error: `m01-v2 is ${middle.options.duration} s, want 3`, notes };
      return { notes };
    },
  },
  {
    name: 'insert',
    prompt: 'Add the photo ~/pictures/sofa-edited.jpg as a 4-second clip right after the last video clip.',
    fixture: PROJECT.composition,
    check: (before, after) => {
      const known = new Set(before.tracks.flatMap((track) => track.segments.map((item) => item.id)));
      const added = after.tracks.flatMap((track) =>
        track.segments.filter((item) => !known.has(item.id)).map((item) => ({ track: track.id, item })),
      );
      if (added.length !== 1) return { error: `${added.length} segments added, want 1`, notes: [] };
      const [{ track, item }] = added;
      const notes = [`href ${String(item.props.href)}`];
      if (track !== 'm01-video') return { error: `added to ${track}`, notes };
      if (!String(item.props.href).includes('sofa-edited.jpg')) return { error: 'wrong href', notes };
      if (!close(item.options.duration, 4)) return { error: `new clip is ${item.options.duration} s, want 4`, notes };
      if (item.options.startFrame !== 390) return { error: `new clip starts at ${item.options.startFrame}, want 390`, notes };
      return { notes };
    },
  },
  {
    name: 'slow+zoom',
    prompt: 'Slow the first clip to half speed and zoom it in from 1 to 1.2 over its length.',
    fixture: PROJECT.composition,
    check: (_, after) => {
      const first = segment(after, 'm01-v1');
      if (!first) return { error: 'm01-v1 missing', notes: [] };
      const last = Math.round(first.options.duration * after.options.frameRate);
      const notes = [`v1 ${first.options.duration} s`, `keys ${JSON.stringify(first.scenes?.map((scene) => [scene.options.atFrame, scene.data]))}`];
      if (!close(first.options.speed, 0.5)) return { error: `speed ${first.options.speed}, want 0.5`, notes };
      if (!close(valueAt(first, 0, 'scale'), 1, 0.01)) return { error: `scale at start ${valueAt(first, 0, 'scale')}`, notes };
      if (!close(valueAt(first, last, 'scale'), 1.2, 0.01)) return { error: `scale at end (f${last}) ${valueAt(first, last, 'scale')}`, notes };
      return { notes };
    },
  },
  {
    name: 'remove',
    prompt: 'Remove the shortest clip and close the gap.',
    fixture: shortMiddleClip(PROJECT.composition),
    check: (_, after) => {
      if (segment(after, 'm01-v2')) return { error: 'm01-v2 (shortest) still there', notes: [] };
      if (!segment(after, 'm01-v1') || !segment(after, 'm01-v3')) return { error: 'removed another clip too', notes: [] };
      const fps = after.options.frameRate;
      const video = clips(after);
      for (let index = 1; index < video.length; index += 1) {
        if (video[index].options.startFrame !== ends(video[index - 1], fps)) return { error: `gap before ${video[index].id}`, notes: [] };
      }
      return { notes: [] };
    },
  },
  {
    name: 'faster',
    prompt: 'Make it feel faster — about 20% shorter overall.',
    fixture: PROJECT.composition,
    check: (before, after) => {
      const ratio = runtime(after) / runtime(before);
      const notes = [`runtime ${runtime(before)} → ${runtime(after)} s (${ratio.toFixed(3)})`];
      if (ratio < 0.75 || ratio > 0.85) return { error: `runtime ratio ${ratio.toFixed(3)}, want ~0.8`, notes };
      return { notes };
    },
  },
];

/** Applies ops literally, in order, to a copy of the composition; throws on an unknown id or a malformed op. */
function apply(source: Composition, ops: Op[]): Composition {
  const composition = structuredClone(source);
  const fps = composition.options.frameRate;
  let made = 0;

  const find = (id: unknown) => {
    for (const track of composition.tracks) {
      const index = track.segments.findIndex((item) => item.id === id);
      if (index >= 0) return { track, index, item: track.segments[index] };
    }
    throw new Error(`unknown segment ${JSON.stringify(id)}`);
  };
  const number = (value: unknown, name: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} not a number: ${JSON.stringify(value)}`);
    return value;
  };

  for (const op of ops) {
    switch (op.op) {
      case 'trim':
        find(op.segment).item.options.duration = number(op.duration, 'duration');
        break;
      case 'move':
        find(op.segment).item.options.startFrame = number(op.startFrame, 'startFrame');
        break;
      case 'speed':
        find(op.segment).item.options.speed = number(op.speed, 'speed');
        break;
      case 'remove': {
        const { track, index } = find(op.segment);
        track.segments.splice(index, 1);
        break;
      }
      case 'keyframe': {
        const { item } = find(op.segment);
        const atFrame = number(op.atFrame, 'atFrame');
        if (!op.data || typeof op.data !== 'object') throw new Error('keyframe without data');
        item.scenes ??= [];
        const existing = item.scenes.find((scene) => scene.options.atFrame === atFrame);
        if (existing) {
          Object.assign(existing.data, op.data);
          if (op.ease) existing.options.meta = { ...existing.options.meta, ease: op.ease };
        } else {
          item.scenes.push({
            id: `${item.id}-new-k${(made += 1)}`,
            options: { atFrame, ...(op.ease ? { meta: { ease: op.ease } } : {}) },
            data: { ...op.data },
          });
          item.scenes.sort((a, b) => a.options.atFrame - b.options.atFrame);
        }
        break;
      }
      case 'insert': {
        const track = composition.tracks.find((candidate) => candidate.id === op.track);
        if (!track) throw new Error(`unknown track ${JSON.stringify(op.track)}`);
        if (!op.clip?.href) throw new Error('insert without clip.href');
        const startFrame = op.after ? Math.round(ends(find(op.after).item, fps)) : number(op.startFrame, 'startFrame');
        track.segments.push({
          id: op.clip.id ?? `${track.id}-new${(made += 1)}`,
          options: { type: 'svg', name: op.clip.name ?? 'Photo', speed: 1, duration: number(op.clip.duration, 'clip.duration'), startFrame },
          props: {
            element: 'image',
            href: op.clip.href,
            x: 0,
            y: 0,
            width: composition.props.width,
            height: composition.props.height,
            preserveAspectRatio: 'xMidYMid slice',
          },
          scenes: [],
        });
        break;
      }
      default:
        throw new Error(`unknown op ${JSON.stringify(op.op)}`);
    }
  }

  for (const track of composition.tracks) track.segments.sort((a, b) => a.options.startFrame - b.options.startFrame);
  return composition;
}

/** Structural invariants every edited composition must keep; warnings are suspicious but playable. */
function invariants(composition: Composition): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fps = composition.options.frameRate;
  const ids = new Set<string>();
  const unique = (id: string) => {
    if (ids.has(id)) errors.push(`duplicate id ${id}`);
    ids.add(id);
  };

  for (const track of composition.tracks) {
    unique(track.id);
    for (const item of track.segments) {
      unique(item.id);
      const { duration, startFrame, speed } = item.options;
      if (!(duration > 0)) errors.push(`${item.id} duration ${duration}`);
      if (!close(duration * fps, Math.round(duration * fps))) errors.push(`${item.id} duration ${duration} s is not whole frames`);
      if (!Number.isInteger(startFrame) || startFrame < 0) errors.push(`${item.id} startFrame ${startFrame}`);
      if (!(speed > 0)) errors.push(`${item.id} speed ${speed}`);
      for (const scene of item.scenes ?? []) {
        unique(scene.id);
        const { atFrame } = scene.options;
        if (!Number.isInteger(atFrame) || atFrame < 0) errors.push(`${scene.id} atFrame ${atFrame}`);
        else if (atFrame > Math.round(duration * fps)) warnings.push(`${scene.id} at f${atFrame} past ${item.id}'s end`);
      }
    }
    for (let index = 1; index < track.segments.length; index += 1) {
      const previous = track.segments[index - 1];
      if (track.segments[index].options.startFrame < ends(previous, fps) - 1e-6) {
        errors.push(`${previous.id} overlaps ${track.segments[index].id}`);
      }
    }
  }
  return { errors, warnings };
}

/** What changed between two compositions, compactly, for reading what a model did. */
function diff(before: Composition, after: Composition): string {
  const index = (composition: Composition) =>
    new Map(composition.tracks.flatMap((track) => track.segments.map((item) => [item.id, item] as const)));
  const was = index(before);
  const now = index(after);
  const parts: string[] = [];
  for (const [id, old] of was) {
    const item = now.get(id);
    if (!item) {
      parts.push(`-${id}`);
      continue;
    }
    const changes: string[] = [];
    for (const key of ['startFrame', 'duration', 'speed'] as const) {
      if (old.options[key] !== item.options[key]) changes.push(`${key} ${old.options[key]}→${item.options[key]}`);
    }
    if (JSON.stringify(old.scenes) !== JSON.stringify(item.scenes)) {
      changes.push(`keys ${JSON.stringify(item.scenes?.map((scene) => [scene.options.atFrame, scene.data]))}`);
    }
    if (changes.length) parts.push(`${id}: ${changes.join(', ')}`);
  }
  for (const [id, item] of now) {
    if (!was.has(id)) parts.push(`+${id} @${item.options.startFrame} ${item.options.duration}s`);
  }
  return parts.join('; ');
}

type Call = { name: string; arguments: string };
type Sample = {
  model: string;
  effort: string;
  task: string;
  run: number;
  status: number;
  firstCall?: number;
  total: number;
  calls: Call[];
  answer: string;
  pass: boolean;
  failure?: string;
  warnings: string[];
  notes: string[];
  diff?: string;
};

/** The fields of a Responses API stream event this harness reads. */
type StreamEvent = {
  type: string;
  delta?: string;
  message?: string;
  item?: { id: string; type: string; name?: string; arguments?: string };
  response?: { error?: { message?: string } };
};

/** Streams one edit turn, timing it, and collects the function calls and any prose. */
async function ask(task: Task, config: Config, run: number): Promise<Sample> {
  const started = performance.now();
  const at = () => Math.round(performance.now() - started);
  const sample: Sample = {
    model: config.model,
    effort: config.effort ?? 'default',
    task: task.name,
    run,
    status: 0,
    total: 0,
    calls: [],
    answer: '',
    pass: false,
    warnings: [],
    notes: [],
  };

  const response = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      instructions: SYSTEM,
      input: [
        { role: 'user', content: JSON.stringify({ context: { project: { id: PROJECT.id, name: PROJECT.name, composition: task.fixture } } }) },
        { role: 'user', content: task.prompt },
      ],
      tools: [EDIT_TOOL],
      reasoning: { summary: 'auto', ...(config.effort ? { effort: config.effort } : {}) },
    }),
  });
  sample.status = response.status;
  if (!response.ok || !response.body) {
    sample.total = at();
    sample.failure = `HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`;
    return sample;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((part) => part.startsWith('data: '));
      if (!line || line === 'data: [DONE]') continue;
      const event = JSON.parse(line.slice(6)) as StreamEvent;
      if (event.type === 'response.output_text.delta') sample.answer += event.delta ?? '';
      if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
        sample.firstCall ??= at();
        sample.calls.push({ name: event.item.name ?? '', arguments: event.item.arguments ?? '' });
      }
      if (event.type === 'error' || event.type === 'response.failed') {
        sample.failure = `stream ${event.type}: ${event.message ?? event.response?.error?.message ?? ''}`.slice(0, 160);
      }
    }
  }
  sample.total = at();
  return sample;
}

/** Applies a sample's calls to the task's fixture and records whether the result holds up. */
function judge(task: Task, sample: Sample): Sample {
  if (sample.failure) return sample;
  const edits = sample.calls.filter((call) => call.name === TOOL);
  if (!edits.length) {
    sample.failure = `no ${TOOL} call${sample.calls.length ? ` (called ${sample.calls.map((call) => call.name)})` : ''}: ${sample.answer.slice(0, 100)}`;
    return sample;
  }
  if (edits.length > 1) sample.notes.push(`${edits.length} calls`);

  const ops: Op[] = [];
  for (const call of edits) {
    let args: { project?: string; ops?: Op[] };
    try {
      args = JSON.parse(call.arguments);
    } catch {
      sample.failure = `arguments are not JSON: ${call.arguments.slice(0, 100)}`;
      return sample;
    }
    if (args.project !== PROJECT.id) {
      sample.failure = `unknown project ${JSON.stringify(args.project)}`;
      return sample;
    }
    if (!Array.isArray(args.ops)) {
      sample.failure = 'ops is not an array';
      return sample;
    }
    ops.push(...args.ops);
  }

  let after: Composition;
  try {
    after = apply(task.fixture, ops);
  } catch (error) {
    sample.failure = `apply: ${(error as Error).message}`;
    return sample;
  }
  sample.diff = diff(task.fixture, after);
  const { errors, warnings } = invariants(after);
  sample.warnings = warnings;
  const outcome = task.check(task.fixture, after);
  sample.notes.push(...outcome.notes);
  sample.failure = errors[0] ?? outcome.error;
  sample.pass = !sample.failure;
  return sample;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe.skipIf(!KEY)('Motion edits as one tool call on the Muse API, live', () => {
  it('edits the composition on every config', { timeout: 1_800_000 }, async () => {
    const perConfig = await Promise.all(
      CONFIGS.map(async (config) => {
        const samples: Sample[] = [];
        for (const task of TASKS) {
          for (let run = 0; run < RUNS; run += 1) samples.push(judge(task, await ask(task, config, run)));
        }
        return samples;
      }),
    );
    const samples = perConfig.flat();

    if (process.env.MOTION_OUT) writeFileSync(process.env.MOTION_OUT, JSON.stringify(samples, null, 2));

    const detail = samples.map((sample) =>
      [
        `${sample.model}/${sample.effort}`,
        sample.task,
        sample.run,
        sample.pass ? 'PASS' : `FAIL ${sample.failure}`,
        `${sample.total}ms`,
        sample.notes.join(', '),
        sample.warnings.length ? `warn: ${sample.warnings.join(', ')}` : '',
        sample.diff ?? '',
      ].join(' | '),
    );

    const rows = new Map<string, Sample[]>();
    for (const sample of samples) {
      const key = `${sample.model} | ${sample.effort} | ${sample.task}`;
      rows.set(key, [...(rows.get(key) ?? []), sample]);
    }
    const table = ['model | effort | task | passed | median ms | failures'];
    for (const [key, group] of rows) {
      table.push(
        [
          key,
          `${group.filter((sample) => sample.pass).length}/${group.length}`,
          median(group.map((sample) => sample.total)),
          group.filter((sample) => !sample.pass).map((sample) => sample.failure).join(' ; '),
        ].join(' | '),
      );
    }
    process.stdout.write(`\n=== motion edits, per call\n${detail.join('\n')}\n\n=== summary (${RUNS} runs)\n${table.join('\n')}\n`);
  });
});

// Generation under heavy load: Wonder at maximum effort creates a whole promotional video from one
// ask, through one native tool, `motion.create`. Measures time, tokens and cost, and checks the
// composition the same way edits are checked, plus what a 5-second promo needs. Run it alone with
// `-t generates`; MOTION_GEN_OUT names a folder for the generated compositions.

const CREATE = 'motion__create';
const GEN_RUNS = Number(process.env.MOTION_GEN_RUNS ?? 2);
const GEN_CONFIG: Config = { model: 'muse-wonder-1.0', effort: process.env.MOTION_GEN_EFFORT ?? 'max' };
/** Wonder's list price per million tokens, input and output, for the cost estimate. */
const WONDER_PRICE = { input: 4, output: 20 };

const CREATE_TOOL = {
  type: 'function',
  name: CREATE,
  description: 'Creates a new Motion project from a complete composition.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The project name.' },
      composition: { type: 'object', description: 'The complete composition, in the schema of your instructions.' },
    },
    required: ['name', 'composition'],
  },
};

const GENERATE_SYSTEM = `You are the Motion agent in Wedyan, a video editor. You create a new project by calling ${CREATE} once with its complete composition. Do not answer in prose instead of calling it.

A composition is a timeline: { id, options: { frameRate }, props: { width, height, background }, tracks }.
${SCHEMA}

Layers you can use:
- An image shot on a video track: options.type "svg"; props { element: "image", href, x, y, width, height, preserveAspectRatio }.
- A title on a text track: options.type "html"; props { text, x, y, width, height, style } where style holds CSS properties.
- Music on an audio track: options.type "audio"; props {}.
Animate with scenes: the numbers in a keyframe's data ease toward the next keyframe.

Rules: ids are unique strings; segments on one track never overlap; durations are > 0 and land on whole frames; startFrame and atFrame are whole numbers; frameRate is 30 and the stage is 1920×1080.`;

const PROMO_PROMPT =
  'Create a 5-second promotional video for Wedyan, a browser desktop you share with your AI agent. Make it feel premium: a few image shots with gentle motion, a headline and a tagline that animate in, and a closing card with the name. It must run exactly 5 seconds.';

type Usage = { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };

type Generation = {
  run: number;
  status: number;
  firstReasoning?: number;
  firstCall?: number;
  total: number;
  usage?: Usage;
  reasoning: string;
  calls: Call[];
  failure?: string;
  errors: string[];
  warnings: string[];
  shape?: string;
  composition?: Composition;
};

/** Streams one generation turn, timing it and collecting the call, the reasoning summary and the usage. */
async function generate(run: number): Promise<Generation> {
  const started = performance.now();
  const at = () => Math.round(performance.now() - started);
  const result: Generation = { run, status: 0, total: 0, reasoning: '', calls: [], errors: [], warnings: [] };

  const response = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEN_CONFIG.model,
      stream: true,
      instructions: GENERATE_SYSTEM,
      input: [
        { role: 'user', content: JSON.stringify({ context: { example: PROJECT.composition } }) },
        { role: 'user', content: PROMO_PROMPT },
      ],
      tools: [CREATE_TOOL],
      reasoning: { summary: 'auto', effort: GEN_CONFIG.effort },
    }),
  });
  result.status = response.status;
  if (!response.ok || !response.body) {
    result.total = at();
    result.failure = `HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`;
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((part) => part.startsWith('data: '));
      if (!line || line === 'data: [DONE]') continue;
      const event = JSON.parse(line.slice(6)) as StreamEvent & { response?: { usage?: Usage } };
      if (event.type === 'response.reasoning_summary_text.delta') {
        result.firstReasoning ??= at();
        result.reasoning += event.delta ?? '';
      }
      if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
        result.firstCall ??= at();
        result.calls.push({ name: event.item.name ?? '', arguments: event.item.arguments ?? '' });
      }
      if (event.type === 'response.completed') result.usage = event.response?.usage;
      if (event.type === 'error' || event.type === 'response.failed') {
        result.failure = `stream ${event.type}: ${event.message ?? event.response?.error?.message ?? ''}`.slice(0, 160);
      }
    }
  }
  result.total = at();
  return result;
}

/** Checks a generated promo: the shared invariants, the stage, 5 s of runtime, and the layers it asked for. */
function judgeGeneration(result: Generation): Generation {
  if (result.failure) return result;
  const call = result.calls.find((item) => item.name === CREATE);
  if (!call) {
    result.failure = `no ${CREATE} call`;
    return result;
  }
  let composition: Composition;
  try {
    composition = (JSON.parse(call.arguments) as { composition: Composition }).composition;
  } catch {
    result.failure = `arguments are not JSON (${call.arguments.length} chars)`;
    return result;
  }
  result.composition = composition;
  if (!composition?.tracks?.length || !composition.options) {
    result.failure = 'no tracks or options';
    return result;
  }

  const { errors, warnings } = invariants(composition);
  const segments = composition.tracks.flatMap((track) => track.segments);
  const images = segments.filter((item) => item.props?.element === 'image' && typeof item.props.href === 'string');
  const titles = segments.filter(
    (item) => item.options.type === 'html' && typeof item.props?.text === 'string' && item.props.text,
  );
  const keyframes = segments.reduce((count, item) => count + (item.scenes?.length ?? 0), 0);
  const length = runtime(composition);

  if (composition.options.frameRate !== 30) errors.push(`frameRate ${composition.options.frameRate}`);
  if (composition.props?.width !== 1920 || composition.props?.height !== 1080) errors.push('stage is not 1920×1080');
  if (Math.abs(length - 5) > 0.05) errors.push(`runs ${length.toFixed(2)} s, not 5`);
  if (!images.length) errors.push('no image shot');
  if (titles.length < 2) errors.push(`${titles.length} titles, want headline, tagline and card`);
  if (keyframes < 2) errors.push(`${keyframes} keyframes: nothing moves`);
  if (!titles.some((item) => /wedyan/i.test(String(item.props.text)))) errors.push('no title names Wedyan');

  result.errors = errors;
  result.warnings = warnings;
  result.shape = `${composition.tracks.length} tracks, ${segments.length} segments (${images.length} shots, ${titles.length} titles), ${keyframes} keyframes, ${length.toFixed(2)} s`;
  result.failure = errors[0];
  return result;
}

describe.skipIf(!KEY)('Motion generation on Muse Wonder at maximum effort, live', () => {
  it('generates a 5-second promo', { timeout: 3_600_000 }, async () => {
    const results: Generation[] = [];
    for (let run = 0; run < GEN_RUNS; run += 1) results.push(judgeGeneration(await generate(run)));

    if (process.env.MOTION_GEN_OUT) {
      for (const result of results) {
        if (!result.composition) continue;
        writeFileSync(`${process.env.MOTION_GEN_OUT}/promo-${result.run}.json`, JSON.stringify(result.composition, null, 2));
      }
    }

    const lines = results.map((result) => {
      const usage = result.usage ?? {};
      const cost =
        ((usage.input_tokens ?? 0) * WONDER_PRICE.input + (usage.output_tokens ?? 0) * WONDER_PRICE.output) / 1_000_000;
      return [
        `run ${result.run}`,
        result.failure ? `FAIL ${result.failure}` : 'PASS',
        `total ${result.total} ms, first reasoning ${result.firstReasoning ?? '-'} ms, call ${result.firstCall ?? '-'} ms`,
        `tokens in ${usage.input_tokens ?? '?'}, out ${usage.output_tokens ?? '?'} (reasoning ${usage.output_tokens_details?.reasoning_tokens ?? '?'}), ≈ $${cost.toFixed(3)}`,
        result.shape ?? '',
        result.errors.slice(1).length ? `also: ${result.errors.slice(1).join(', ')}` : '',
        result.warnings.length ? `warn: ${result.warnings.join(', ')}` : '',
        `reasoning: ${result.reasoning.slice(0, 300).replace(/\n+/g, ' / ')}`,
      ]
        .filter(Boolean)
        .join('\n  ');
    });
    process.stdout.write(`\n=== motion generation, ${GEN_CONFIG.model} at ${GEN_CONFIG.effort}\n${lines.join('\n')}\n`);
  });
});
