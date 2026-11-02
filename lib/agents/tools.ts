import type { ChatTool } from '@irpclib/ai-kit';
import { type IRPCData, IRPCRouter, type IRPCTransport } from '@irpclib/irpc';
import { transport as fileTransport } from '@irpclib/r2-file';
import { WORK_ASSIGN } from '../kernel/chat.h.js';
import { DOC_CLOSE, DOC_OPEN, DOC_UPDATE } from '../kernel/document.h.js';
import { memory } from '../memory/memory.h.js';
import type { ActionSpec } from './format.js';

/*
 * The tools and actions agents share. A tool (`ChatTool`) is a system thing on the server, a package
 * tool (`r2-file.*`) or `sys.*`, whose result the model reads in the same turn. An action
 * (`ActionSpec`) is written into the answer and runs on the desktop without waiting. Asking the user
 * or an app is neither: it's an ask the format teaches.
 */

/**
 * A package's tools as its declarations describe them, by tool name (`r2-file.read`).
 *
 * @param transport - The transport the packages are on.
 * @returns The tools, as the model is given them.
 */
function packageTools(transport: IRPCTransport): Record<string, ChatTool> {
  return Object.fromEntries(
    new IRPCRouter(transport)
      .getTools()
      .map(({ name, description, inputSchema }) => [
        name,
        { name, description, parameters: inputSchema as Record<string, IRPCData> } satisfies ChatTool,
      ]),
  );
}

const files = packageTools(fileTransport);
const memories = packageTools(memory.transport as IRPCTransport);

/** The r2-file tools that only look: what agents use to find and read the user's files. */
export const FILE_LOOKUPS: ChatTool[] = ['r2-file.list', 'r2-file.read', 'r2-file.search', 'r2-file.stat'].map(
  (name) => files[name],
);

/** The memory package's tools: recalling what Wedyan knows, and saving something new. */
export const MEMORY = { recall: memories['memory.recall'], save: memories['memory.save'] };

const object = (properties: Record<string, IRPCData>, required: string[] = []): Record<string, IRPCData> => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});

const text = (description: string) => ({ type: 'string', description });

/** How a clip moves over its time. */
const KEYFRAMES = {
  type: 'array',
  description:
    'How it moves: keyframes in seconds from its own start, each eased into the next. Its values are any of its own, plus `x`, `y`, `scale`, `rotate` and `opacity`.',
  items: object(
    {
      at: { type: 'number', minimum: 0 },
      ease: text('A GSAP ease, e.g. "power2.inOut".'),
      values: { type: 'object', additionalProperties: true },
    },
    ['at', 'values'],
  ),
};

export const TOOLS = {
  photosSearch: {
    name: 'sys.photos.search',
    description: 'Finds photos by what they show, e.g. "the cat on the sofa".',
    parameters: object({ query: text('What the photo shows.') }, ['query']),
  },
  imageSegment: {
    name: 'sys.image.segment',
    description: 'Finds an object in a photo and returns its mask and box.',
    parameters: object({ image: text('The photo’s path.'), prompt: text('The object, as a short noun phrase.') }, [
      'image',
      'prompt',
    ]),
  },
  imageEdit: {
    name: 'sys.image.edit',
    description: 'Edits a photo as described, inside the mask when one is given. Writes a new file next to it.',
    parameters: object(
      {
        image: text('The photo’s path.'),
        prompt: text('The edit, e.g. "remove the cat".'),
        mask: text('A mask returned by sys.image.segment, if any.'),
      },
      ['image', 'prompt'],
    ),
  },
  imageGenerate: {
    name: 'sys.image.generate',
    description:
      'Generates one image from a description and keeps it in the user’s drive, in the folder you name. Returns its path.',
    parameters: object(
      {
        prompt: text('What to draw.'),
        saveTo: text('The folder to keep it in, in the home: e.g. "~/Motions/Lantern River/People".'),
        aspect: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
      },
      ['prompt', 'saveTo'],
    ),
  },
  stillGenerate: {
    name: 'sys.still.generate',
    description:
      'Makes new attempts of a still: a generated image kept as an editable source, with its prompt, settings, references and every attempt. Creates the still when it doesn’t exist yet. What you pass is written into it first, then its attempts are made and added to its history. To change a still (an expression, a pose, a detail), pass its prompt with the change and the still itself as a reference, so it stays the same subject. Returns each new attempt with an address to show it at (url), and a link that opens the still (open): show the attempts on a card, the pictures with an Open link.',
    parameters: object(
      {
        path: text('The still, a .still in the home: e.g. "~/People/Ayla/Head.still".'),
        prompt: text('What to draw. Needed for a new still; leave it out to make more of the same.'),
        aspect: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
        batch: { type: 'integer', minimum: 1, maximum: 4, description: 'How many to make at once.' },
        references: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Images to make it from, so someone or somewhere looks the same: a .still (its chosen image) or a picture, by path in the home.',
        },
      },
      ['path'],
    ),
  },
  motionCreate: {
    name: 'sys.motion.create',
    description:
      'Starts a Motion project in its own folder. Its script holds the whole work’s bible and outline. Returns its path, which every other sys.motion tool takes as project, and a link that opens it (open).',
    parameters: object(
      {
        name: text('What it’s called.'),
        description: text('What it is, in a line.'),
        aspect: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
        length: { type: 'integer', description: 'How long the whole work is meant to run, in seconds.' },
        script: text('Markdown: the bible (world, tone, look, cast, locations), then the outline, one `##` heading per stage.'),
      },
      ['name', 'script'],
    ),
  },
  motionCast: {
    name: 'sys.motion.cast',
    description:
      'Makes someone in a project, with a generated face, figure and outfit that go with them into every scene they’re cast in, so they stay the same person. Returns their .persona (path), which scenes name in casts. Says failed if a picture didn’t come back.',
    parameters: object(
      {
        project: text('The project’s .motion.'),
        name: text('Their name.'),
        kind: { type: 'string', enum: ['person', 'character', 'mascot'] },
        description: text('Who they are, in a line.'),
        look: text('What to draw: a close portrait of their face and head, with age, features, hair and the work’s art style.'),
        figure: text('What to draw: their whole body, neutral and plain, showing build, height and posture, in the work’s art style.'),
        outfit: text('What to draw: them full length in what they wear, in the work’s art style.'),
      },
      ['project', 'name', 'look'],
    ),
  },
  motionStill: {
    name: 'sys.motion.still',
    description:
      'Makes a generated picture a project holds, for anything its scenes can be drawn from: a place, a prop, a look. It shows what its prompt describes and nothing else. Returns the .still (path), which scenes can name in references. Says failed if no picture came back.',
    parameters: object(
      {
        project: text('The project’s .motion.'),
        name: text('What it’s called.'),
        prompt: text('What to draw, in the work’s art style.'),
        references: { type: 'array', items: { type: 'string' }, description: 'Stills or pictures that help draw it, by path, if any.' },
        casts: { type: 'array', items: { type: 'string' }, description: 'Who’s in the picture, by .persona path, if anyone is.' },
      },
      ['project', 'name', 'prompt'],
    ),
  },
  motionStage: {
    name: 'sys.motion.stage',
    description:
      'Adds a stage to a project, such as an episode or a chapter, its scenes laid out one after another. A scene shows a new picture as a playable take, or something already made as a picture clip, or only its layers, over the stage’s background. Each can have words spoken over it, a subtitle, keyframes, and layers of titles, HTML or SVG over it, each timed within it. Takes a while. Returns the stage (path), how long it really runs (seconds), how long each scene runs and its words were spoken for (scenes), and what didn’t come back (failed).',
    parameters: object(
      {
        project: text('The project’s .motion.'),
        name: text('What it’s called, e.g. "Episode 1: The Lake".'),
        order: { type: 'integer', minimum: 1, description: 'Its place in the project, from 1.' },
        script: text('Markdown: this stage’s script, one `##` heading per scene.'),
        scenes: {
          type: 'array',
          minItems: 1,
          items: object(
            {
              name: text('The scene’s name.'),
              picture: text('Makes a new picture for this scene, as a take: exactly what the frame shows, in the work’s art style.'),
              video: text('With a picture, the video prompt: what moves and how the camera moves, from that picture.'),
              still: text('Instead of a picture, shows a .still or a picture that’s already made, by path.'),
              seconds: {
                type: 'number',
                exclusiveMinimum: 0,
                description: 'How long it runs, of any length, 0.5 or 300 alike. Leave it out to run as long as its words. Words longer than this run on over what follows.',
              },
              references: {
                type: 'array',
                items: { type: 'string' },
                description: 'Anything else that helps draw this shot and its casts don’t already give, by .still path, if any. Never its own picture.',
              },
              casts: { type: 'array', items: { type: 'string' }, description: 'Who’s in this shot, by .persona path, if anyone is. They bring their own face, figure and outfit.' },
              words: text('What’s spoken from the scene’s start, up to 1000 characters. Leave it out when nothing is said.'),
              delivery: text('How the words are said.'),
              voice: text('Who says them, by .persona path.'),
              subtitle: text('Words shown low on the stage for as long as the scene’s words are spoken, or the scene runs.'),
              motion: KEYFRAMES,
              layers: {
                type: 'array',
                description: 'What’s drawn over the scene, later ones on top, with no limit on how they overlap.',
                items: object(
                  {
                    kind: { type: 'string', enum: ['title', 'html', 'svg'] },
                    name: text('What it’s called on the timeline.'),
                    at: { type: 'number', minimum: 0, description: 'When it starts, in seconds into the scene.' },
                    seconds: { type: 'number', exclusiveMinimum: 0, description: 'How long it shows; leave it out for the rest of the scene.' },
                    props: {
                      type: 'object',
                      additionalProperties: true,
                      description:
                        'What it is, in stage units. A title: its `text`, box (`x`, `y`, `width`, `height`), and any CSS by camel-case name, e.g. `fontSize`, `fontFamily`, `color`. HTML: an `element`, its `text`, `attrs`, box, CSS, and `children`, each `{id, props, scenes: []}` nested the same way. SVG: an `element`, `attrs`, its `text`, and its attributes.',
                    },
                    motion: KEYFRAMES,
                  },
                  ['kind'],
                ),
              },
            },
            ['name'],
          ),
        },
      },
      ['project', 'name', 'order', 'scenes'],
    ),
  },
} satisfies Record<string, ChatTool>;

export const ACTIONS = {
  open: { name: 'app.open', args: '{"app": string, "file"?: string}', does: 'Opens an app, optionally with a file.' },
  mailOpen: { name: 'app.mail.open', args: '{"path": string}', does: 'Opens one mail, by its path in the home.' },
  filesReveal: { name: 'app.files.reveal', args: '{"path": string}', does: 'Shows a file or folder in Files.' },
  filesDelete: {
    name: 'app.files.delete',
    args: '{"path": string}',
    does: 'Moves a file to the trash. Only after the user said yes to an ask_user.',
  },
  photosShow: { name: 'app.photos.show', args: '{"paths": string[]}', does: 'Shows photos in Photos.' },
  motionImport: {
    name: 'app.motion.import',
    args: '{"path": string}',
    does: 'Adds a photo or clip to the open Motion project.',
  },
  tile: { name: 'desktop.tile', args: '{"apps": string[]}', does: 'Places the apps’ windows side by side.' },
  focus: { name: 'desktop.focus', args: '{"app": string}', does: 'Brings an app’s window to the front.' },
  close: {
    name: 'desktop.close',
    args: '{"window": string}',
    does: 'Closes an open window, by the `id` it has on the desktop.',
  },
  windowRun: {
    name: 'window.run',
    args: '{"window": string, "command": string, "args"?: object}',
    does: 'Runs one of an open window’s `commands` on that window, by the window’s `id`. It says if it failed.',
  },
  workAssign: {
    name: WORK_ASSIGN,
    args: '{"title": string, "agent": string, "goal": string, "object": {"path": string, "part"?: string, "id"?: string}}',
    does: "Hands one task to one of the user's experts, by its path: a goal about one object, a file or one part of one. Tasks with the same title make one batch. An expert does its tasks one at a time, in the order they were handed out, while you go on with yours.",
  },
  docClose: {
    name: DOC_CLOSE,
    args: '{"path": string}',
    does: 'Lets go of the part you have open in that document, once you are done with it.',
  },
} satisfies Record<string, ActionSpec>;

/** The app asks for working on a document beside the user, one part at a time. */
export const DOCUMENT_ASKS = {
  open: {
    name: DOC_OPEN,
    args: '{"path": string, "part": string, "id": string}',
    does: 'Opens one part of a document to work on, like {"part": "clip", "id": "v3"}. The reply is its current value, {"opened": {...}}, or why you can’t, {"refused": "..."}. Opening another part lets go of this one.',
  },
  update: {
    name: DOC_UPDATE,
    args: '{"path": string, "part": string, "id": string, "value": object}',
    does: 'Writes the part you have open. Write its whole value, every field, changed or not. The reply is {"updated": true}, or why not, {"refused": "..."}.',
  },
} satisfies Record<string, ActionSpec>;

/** Every tool an agent or skill can name, by its tool name: the packages' own and the `sys.*` ones. */
export const TOOLS_BY_NAME: Record<string, ChatTool> = {
  ...files,
  ...memories,
  ...Object.fromEntries(Object.values(TOOLS).map((tool) => [tool.name, tool])),
};

/** Every action an agent or skill can name, by its action name. */
export const ACTIONS_BY_NAME: Record<string, ActionSpec> = Object.fromEntries(
  Object.values(ACTIONS).map((action) => [action.name, action]),
);
