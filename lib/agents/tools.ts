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
