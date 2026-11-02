import { AUI_CLASS } from '@airlib/aui/utils';
import { $use, setup } from '@airlib/react';
import { Button, Menu, Tooltip } from '@airlib/react-aui';
import type { FileRow } from '@/lib/documents/rows.js';
import { AddIcon } from '../../icons.js';
import { addCast, newPerson, newStage } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';
import { addGenerated, GENERATED_ITEMS, isGeneratedKind } from '../generated.js';
import { ASSET_TYPES, addAssets } from '../upload.js';

/** Which command makes a new person, among the people to pick. */
const NEW_PERSON = 'new-person';

/** Adds an empty stage at the end of the project, and picks it. */
export const AddStage = setup(() => {
  const composer = composerCtx.get() as Composer;
  const add = () => {
    const { project } = composer;
    if (!project) return;
    composer.activeStage = newStage(project, composer.stages);
    composer.activeView = 'stage';
  };

  return () => (
    <Button aria-label="New stage" size="xs" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={add}>
      <AddIcon />
      <Tooltip>New stage</Tooltip>
    </Button>
  );
}, 'AddStage');

/** Which command uploads, among the new things to make. */
const UPLOAD = 'upload';

/** What the Add menu offers: what's made here, then what's brought in. */
const ADD_ITEMS = [...GENERATED_ITEMS, { name: UPLOAD, label: 'Upload' }];

/**
 * Adds to the project: a new generated image, video or sound, or uploaded pictures, videos and
 * sounds, each under an id, called by its own name. What's new goes to `made`.
 */
export const AddAsset = setup<{ made(asset: FileRow): void }>((props) => {
  const composer = composerCtx.get() as Composer;
  let picker: HTMLInputElement | null = null;

  const upload = async (files: FileList | null) => {
    if (files) await addAssets(composer, files);
    if (picker) picker.value = '';
  };

  const add = async (command: string) => {
    if (command === UPLOAD) return picker?.click();
    if (!isGeneratedKind(command)) return;
    const asset = await addGenerated(composer, command);
    if (asset) props.made(asset);
  };

  return () => (
    <>
      <input
        ref={(input) => {
          picker = input;
        }}
        type="file"
        accept={ASSET_TYPES}
        multiple
        hidden
        aria-label="Files to upload"
        onChange={(event) => void upload(event.target.files)}
      />
      <Menu label="Add asset" size="xs" variant="text" xDir="between" items={ADD_ITEMS} oncommand={(event) => void add(String(event.detail))}>
        <Menu.Snippet for="trigger">{() => <AddIcon />}</Menu.Snippet>
      </Menu>
    </>
  );
}, 'AddAsset');

/** Puts someone in the project: one of the people not cast in it yet, or a new person. Either opens as a cast. */
export const AddCast = setup(() => {
  const composer = composerCtx.get() as Composer;

  const items = () => {
    const cast = new Set(composer.casts.map(({ path }) => path));
    const people = composer.people.filter(({ path }) => !cast.has(path)).map(({ path, name }) => ({ name: path, label: name }));
    return [...people, { name: NEW_PERSON, label: 'New person' }];
  };

  const add = async (command: string) => {
    const { project } = composer;
    if (!project) return;
    const persona = command === NEW_PERSON ? await newPerson() : command;
    addCast(project, persona);
    composer.activeCast = persona;
    composer.activeView = 'cast';
  };

  return () => (
    <Menu label="Add cast" size="xs" variant="text" xDir="between" items={$use(items)} oncommand={(event) => void add(String(event.detail))}>
      <Menu.Snippet for="trigger">{() => <AddIcon />}</Menu.Snippet>
    </Menu>
  );
}, 'AddCast');
