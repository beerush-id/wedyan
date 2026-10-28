import type { ChatTool } from '@irpclib/ai-kit';
import { type IRPCData, IRPCRouter, type IRPCTransport } from '@irpclib/irpc';
import { transport as fileTransport } from '@irpclib/r2-file';
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
  queueList: {
    name: 'sys.queue.list',
    description: 'Lists what finished or arrived while the user was away: renders, mail, meetings, decisions waiting.',
    parameters: object({}),
  },
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
    description: 'Generates images from a description into ~/pictures.',
    parameters: object(
      {
        prompt: text('What to draw.'),
        aspect: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
        count: { type: 'integer', minimum: 1, maximum: 4 },
      },
      ['prompt'],
    ),
  },
  profileSave: {
    name: 'sys.profile.save',
    description: 'Saves the user’s profile: their name, the name they give you, and preferences.',
    parameters: object(
      {
        userName: text('How to call the user.'),
        assistantName: text('The name the user gives you.'),
        preferences: { type: 'array', items: { type: 'string' }, description: 'Preferences, one per item.' },
      },
      ['userName'],
    ),
  },
} satisfies Record<string, ChatTool>;

export const ACTIONS = {
  open: { name: 'app.open', args: '{"app": string, "file"?: string}', does: 'Opens an app, optionally with a file.' },
  mailOpen: { name: 'app.mail.open', args: '{"id": string}', does: 'Opens one mail.' },
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
