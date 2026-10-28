import type { ChatTool } from '@irpclib/ai-kit';
import type { IRPCData } from '@irpclib/irpc';
import type { ActionSpec } from './format.js';

/*
 * The calls and actions agents share. A call (`ChatTool`) returns a result the model reads; an
 * action (`ActionSpec`) is written into the answer and runs on the desktop. `sys.*` runs on the
 * server; `app.*`, `desktop.*` and `ask_user` are answered by the desktop.
 */

const object = (properties: Record<string, IRPCData>, required: string[] = []): Record<string, IRPCData> => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});

const text = (description: string) => ({ type: 'string', description });

export const TOOLS = {
  askUser: {
    name: 'ask_user',
    description:
      'Asks the user a question and waits for the reply. Use it for consent before anything destructive, and when a choice is truly ambiguous.',
    parameters: object(
      {
        question: text('The question, short enough to speak.'),
        options: { type: 'array', items: { type: 'string' }, description: 'Choices to offer, if any.' },
      },
      ['question'],
    ),
  },
  queueList: {
    name: 'sys.queue.list',
    description: 'Lists what finished or arrived while the user was away: renders, mail, meetings, decisions waiting.',
    parameters: object({}),
  },
  memoryRecall: {
    name: 'sys.memory.recall',
    description: 'Searches what you know: saved facts, past asks, and the content of the user’s files.',
    parameters: object(
      {
        scope: { type: 'string', enum: ['memory', 'history', 'files', 'all'] },
        query: text('What to look for, in plain words.'),
      },
      ['query'],
    ),
  },
  memorySave: {
    name: 'sys.memory.save',
    description: 'Remembers one fact about the user for later asks: a preference, a person, a project.',
    parameters: object(
      {
        kind: { type: 'string', enum: ['preference', 'person', 'project', 'fact'] },
        text: text('The fact, in one sentence.'),
      },
      ['kind', 'text'],
    ),
  },
  fsList: {
    name: 'sys.fs.list',
    description: 'Lists a folder. Paths start with ~ for the user’s home, e.g. ~/projects.',
    parameters: object({ path: text('The folder, e.g. ~/projects.') }, ['path']),
  },
  fsRead: {
    name: 'sys.fs.read',
    description: 'Reads a text file. Paths start with ~ for the user’s home, e.g. ~/notes/today.md.',
    parameters: object({ path: text('The file, e.g. ~/notes/today.md.') }, ['path']),
  },
  fsSearch: {
    name: 'sys.fs.search',
    description: 'Finds files and folders by name under the user’s home.',
    parameters: object({ query: text('Part of the name.') }, ['query']),
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
    does: 'Moves a file to the trash. Only after the user said yes through ask_user.',
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
