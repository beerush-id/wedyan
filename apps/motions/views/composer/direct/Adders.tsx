import { AUI_CLASS } from '@airlib/aui/utils';
import { $use, setup } from '@airlib/react';
import { Button, Menu, Tooltip } from '@airlib/react-aui';
import { AddIcon } from '../../icons.js';
import { addCast, newPerson, newStage } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';
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

/** Uploads pictures, videos and sounds into the project, each under an id, called by its own name. */
export const AddAsset = setup(() => {
  const composer = composerCtx.get() as Composer;
  let picker: HTMLInputElement | null = null;

  const upload = async (files: FileList | null) => {
    if (files) await addAssets(composer, files);
    if (picker) picker.value = '';
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
      <Button aria-label="Upload" size="xs" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={() => picker?.click()}>
        <AddIcon />
        <Tooltip>Upload</Tooltip>
      </Button>
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
