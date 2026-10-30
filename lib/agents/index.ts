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

/** The agent that answers what Wedyan starts on its own, a briefing or a finished job: Wendy. */
export const BRIEFER = 'wendy';

/** The engine that does a specialized job with the skills it has: Lita, and every user's own agent. */
export const SPECIALIST = 'lita';

/** A model an agent runs on, and how hard it reasons (the provider's default when unset). */
export interface AgentModel {
  model: string;
  effort?: string;
}

/**
 * The models agents run on: a fast one for routing, a capable one for the work, and one for
 * composing widgets (the work's when unset).
 */
export interface AgentModels {
  router: AgentModel;
  agents: AgentModel;
  composer?: AgentModel;
}

/** Meta-hosted Muse Spark at minimal effort for all: about 4 s per ask in live timings. */
export const DEFAULT_MODELS: AgentModels = {
  router: { model: 'muse-spark-1.3', effort: 'minimal' },
  agents: { model: 'muse-spark-1.3', effort: 'minimal' },
};

/** Muse Spark Open, Meta's open-weight Spark, served by Baseten. */
export const SPARK_OPEN = 'meta-models/muse-spark-open-1026';

/**
 * With Baseten: Spark Open routes and composes, Spark 1.3 does the work. In live runs it routes in
 * about 1 s instead of 2.3 s and composes faster, with the same checks passed as Spark 1.3.
 */
export const OPEN_MODELS: AgentModels = {
  router: { model: SPARK_OPEN, effort: 'low' },
  agents: DEFAULT_MODELS.agents,
  composer: { model: SPARK_OPEN, effort: 'low' },
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
    june: on(june((models.composer ?? models.agents).model), models.composer ?? models.agents),
  };
}
