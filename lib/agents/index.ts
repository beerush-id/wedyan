import type { AgentProfile } from '../kernel/agent.js';
import { lita } from './lita.js';
import { onboarding } from './onboarding.js';
import { photos } from './photos.js';
import { router } from './router.js';

/** The agent every ask starts with. */
export const ENTRY = 'router';

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
 * Wedyan's agents, one per speciality in the demo: the router, the user's assistant, photos, and
 * onboarding.
 *
 * @param models - Which model, and effort, each kind of agent runs on.
 * @returns The agents by name, for the kernel's config.
 */
export function createAgents(models: AgentModels = DEFAULT_MODELS): Record<string, AgentProfile> {
  const on = (profile: AgentProfile, spec: AgentModel): AgentProfile => ({
    ...profile,
    ...(spec.effort ? { effort: spec.effort } : {}),
  });

  return {
    router: on(router(models.router.model), models.router),
    lita: on(lita(models.agents.model), models.agents),
    photos: on(photos(models.agents.model), models.agents),
    onboarding: on(onboarding(models.agents.model), models.agents),
  };
}
