import { AUI_CLASS } from '@airlib/aui/utils';
import { $use, setup } from '@airlib/react';
import { Button, Menu, Tooltip } from '@airlib/react-aui';
import { newPerson } from '@/apps/lounge/views/library.js';
import { FILE_TYPES } from '@/lib/documents/file-types.js';
import { homePath, nameOf } from '@/lib/documents/paths.js';
import { documentAt as personOnDrive } from '@/lib/documents/store.js';
import { dfs } from '@/lib/share/dfs.js';
import { AddIcon } from '../../icons.js';
import { addCast, castsOf, newStage } from '../../motion.js';
import { type Composer, composerCtx } from '../context.js';

/** Where people are kept. */
const PEOPLE = '~/People';

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

/**
 * Puts someone in the project, on every stage: one of the people not cast in it yet, or a new person.
 * Either opens as the project's cast.
 */
export const AddCast = setup(() => {
  const composer = composerCtx.get() as Composer;
  const listed = dfs.list.with(() => [PEOPLE, { filter: { type: FILE_TYPES.persona }, sort: 'name' }]);

  const items = () => {
    const { project } = composer;
    const cast = new Set(project ? castsOf(project).map(({ path }) => path) : []);
    const people = (listed.data?.entries ?? [])
      .map((entry) => homePath(entry.path))
      .filter((path) => !cast.has(path))
      .map((path) => ({ name: path, label: nameOf(path).replace(/\.persona$/, '') }));
    return [...people, { name: NEW_PERSON, label: 'New person' }];
  };

  const add = async (command: string) => {
    const { project } = composer;
    if (!project) return;
    const persona = command === NEW_PERSON ? await writePerson() : command;
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

/**
 * Makes a new person as Lounge does, as a real file.
 *
 * @returns Its home path.
 */
async function writePerson(): Promise<string> {
  const made = newPerson();
  const path = `~${made}`;
  await dfs.write(path, personOnDrive(made) as never);
  return path;
}
