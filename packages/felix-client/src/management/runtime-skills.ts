/**
 * An agent's skills as the harness resolves them at run time (`/skills/{manifest}`) — the
 * other half from `skills.ts`, which is the tenant's *library*: what is drafted, reviewed and
 * published. This is what a given agent can actually reach right now, whichever source it came
 * from, and which of those are switched on.
 *
 * Read-only. The answers it gives are the ones a transcript cannot: `list_skills` describes the
 * chat's agent as of its last call, while these describe any agent, now — including what the
 * model is never shown (`model_invocable: false`) and a declared skill whose body was never found
 * (`has_body: false`), which is why an operator opens the page.
 */

import type { FelixHttp } from '../http';

/** Where a skill came from: the host's directories, an uploaded object, or the tenant library. */
export type AgentSkillSource = 'bundled' | 'store' | 'library' | (string & {});

/** One row of `GET /skills/{manifest}`. */
export interface AgentSkill {
  name: string;
  description: string;
  version?: string | null;
  /** Switched on for this agent now. */
  active: boolean;
  /** False is a ref the loader could not find a body for: activating it hands the model nothing. */
  has_body: boolean;
  /** False is a skill in the catalog the model is never offered (`disable_model_invocation`). */
  model_invocable: boolean;
  /** False is reachable because it is on the host, not because the manifest named it. */
  declared: boolean;
  source: AgentSkillSource;
}

export interface AgentSkills {
  manifest: string;
  /** The manifest limits the agent to the skills it names. */
  declared_only: boolean;
  items: AgentSkill[];
  active: string[];
}

/** `GET /skills/{manifest}/{skill}`: one skill with its instructions, secrets redacted. */
export interface AgentSkillDetail extends Omit<AgentSkill, 'has_body'> {
  filename: string | null;
  metadata: Record<string, unknown>;
  body: string;
}

/** One row of `GET /skills/{manifest}/activations/recent`, read from the audit trail. */
export interface SkillActivation {
  ts: number;
  skill: string;
  /** `activate` or `deactivate`. */
  action: string;
  /** `org`, a personal library's digest, or `''` for a host skill. */
  library: string;
  thread_id: string;
  tool_call_id: string;
  /** `ok`, or `unknown_skill` when the model named one that does not exist. */
  status: string;
}

export function createRuntimeSkillsClient(http: FelixHttp) {
  const { chatFetch } = http;

  /** GET /skills/{manifest} → every skill the agent can reach, and which are active. */
  async function listAgentSkills(manifest: string): Promise<AgentSkills> {
    const res = await chatFetch(`/skills/${encodeURIComponent(manifest)}`);
    if (!res.ok) throw new Error(`skills: ${res.status}`);
    const body = (await res.json()) as Partial<AgentSkills>;
    return {
      manifest: body.manifest ?? manifest,
      declared_only: body.declared_only ?? false,
      items: body.items ?? [],
      active: body.active ?? [],
    };
  }

  /** GET /skills/{manifest}/{skill} → one skill, with the body `activate_skill` would return. */
  async function getAgentSkill(manifest: string, skill: string): Promise<AgentSkillDetail> {
    const res = await chatFetch(
      `/skills/${encodeURIComponent(manifest)}/${encodeURIComponent(skill)}`,
    );
    if (!res.ok) throw new Error(`skills: ${res.status}`);
    return (await res.json()) as AgentSkillDetail;
  }

  /** GET /skills/{manifest}/activations/recent → which skill was switched on or off, newest first. */
  async function recentSkillActivations(manifest: string, limit = 20): Promise<SkillActivation[]> {
    const res = await chatFetch(
      `/skills/${encodeURIComponent(manifest)}/activations/recent?limit=${limit}`,
    );
    if (!res.ok) throw new Error(`skills: ${res.status}`);
    const body = (await res.json()) as { items?: SkillActivation[] };
    return body.items ?? [];
  }

  return { listAgentSkills, getAgentSkill, recentSkillActivations };
}
