import type { AgentProfile, AgentSkill } from '../kernel/agent.js';
import { june } from './june.js';
import { lita } from './lita.js';
import { rita } from './rita.js';
import { SKILLS } from './skills.js';
import { wendy } from './wendy.js';

/** The agent every ask starts with: Rita, who decides where it goes. */
export const ENTRY = 'rita';

/** The agent that composes every widget and form the others describe: June. */
export const COMPOSER = 'june';

/** A model an agent runs on, and how hard it reasons (the provider's default when unset). */
export interface AgentModel {
  model: string;
  effort?: string;
}

/** The models agents run on: a fast one for routing, a capable one for the work. */
export interface AgentModels {
  router: AgentModel;
  agents: AgentModel;
}

/** Meta-hosted Muse Spark at minimal effort for both: about 4 s per ask in live timings. */
export const DEFAULT_MODELS: AgentModels = {
  router: { model: 'muse-spark-1.3', effort: 'minimal' },
  agents: { model: 'muse-spark-1.3', effort: 'minimal' },
};

/**
 * Wedyan's agents, by code name: Rita routes, Wendy handles common asks, Lita does a specialized
 * job with the skill she is handed, and June composes the widgets they describe. The user hears none
 * of these names.
 *
 * @param models - Which model, and effort, each kind of agent runs on.
 * @param skills - The skills Lita can be handed, for Rita's catalog.
 * @returns The agents by name, for the kernel's config.
 */
export function createAgents(
  models: AgentModels = DEFAULT_MODELS,
  skills: Record<string, AgentSkill> = SKILLS,
): Record<string, AgentProfile> {
  const on = (profile: AgentProfile, spec: AgentModel): AgentProfile => ({
    ...profile,
    ...(spec.effort ? { effort: spec.effort } : {}),
  });

  return {
    rita: on(rita(models.router.model, Object.values(skills)), models.router),
    wendy: on(wendy(models.agents.model), models.agents),
    lita: on(lita(models.agents.model), models.agents),
    june: on(june(models.agents.model), models.agents),
  };
}
