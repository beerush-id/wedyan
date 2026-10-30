import { describe, expect, it } from 'vitest';
import { CALLABLES } from '../../lib/agents/skills.js';
import { userSkillPath } from '../../lib/share/skills.js';

describe('the user’s own skills', () => {
  it('resolves a skill an agent names to its path in the home, and leaves an app’s skill by name', () => {
    expect(userSkillPath('~/Agents/Ivo.agent', '../Skills/Teacher.skill')).toBe('~/Skills/Teacher.skill');
    expect(userSkillPath('~/Agents/Ivo.agent', '~/Skills/Teacher.skill')).toBe('~/Skills/Teacher.skill');
    expect(userSkillPath('~/Agents/Ivo.agent', '../../../Skills/Teacher.skill')).toBe('~/Skills/Teacher.skill');
    expect(userSkillPath('~/Agents/Ivo.agent', 'motions')).toBeUndefined();
  });

  it('offers every tool and action there is to grant, as the kernel describes them', () => {
    const tools = CALLABLES.tools.map(({ name }) => name);
    const actions = CALLABLES.actions.map(({ name }) => name);

    expect(tools).toEqual(expect.arrayContaining(['r2-file.read', 'memory.recall', 'sys.image.generate']));
    expect(actions).toEqual(expect.arrayContaining(['app.open', 'work.assign']));
    expect(CALLABLES.tools.every(({ hint }) => hint.length > 0)).toBe(true);
  });
});
