/**
 * `create_skill` / `update_skill` results, read off a tool card.
 *
 * Both tools answer with JSON (`felix/skills/authoring.py`): a saved draft's
 * record, or `{"error": …}` — never a raise into the loop, so a refusal arrives
 * as a successful call whose result says nothing was saved. Reading the error
 * shape is the point: a card that drew `parent_changed` as "done" would tell
 * the operator a skill had changed when it had not.
 */

export const SKILL_AUTHORING_TOOLS = new Set(['create_skill', 'update_skill']);

export interface SkillSaved {
  kind: 'saved';
  /** At save time. A later publish or reject is the library's to report, not this result's. */
  status: string;
  name: string;
  version: string;
  quality_score: number | null;
  security_status: string | null;
  review_hint: string;
  issues: { severity: string; path: string; message: string }[];
  /** Set when an operator wrote the version this edits: a person must publish it. */
  review_required?: string;
  /** The gate's reasons, when the manifest asked to publish and the gate refused. */
  publish_blocked?: string[];
}

export interface SkillRefused {
  kind: 'refused';
  error: string;
  name?: string;
  detail?: string;
  /** `parent_changed`: the version the call named, and the newest one. */
  expected?: string;
  current?: string;
  issues?: { path: string; message: string }[];
}

export type SkillCallResult = SkillSaved | SkillRefused;

function asObject(value: unknown): Record<string, unknown> | null {
  let v = value;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s.startsWith('{')) return null;
    try {
      v = JSON.parse(s);
    } catch {
      return null;
    }
  }
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** A skill authoring call's result, or null when this is not one (or not one this reads). */
export function parseSkillCall(toolName: string, output: unknown): SkillCallResult | null {
  if (!SKILL_AUTHORING_TOOLS.has(toolName)) return null;
  const o = asObject(output);
  if (!o) return null;
  if (typeof o.error === 'string') {
    return {
      kind: 'refused',
      error: o.error,
      name: str(o.name),
      detail: str(o.detail),
      expected: str(o.expected),
      current: str(o.current),
      issues: Array.isArray(o.issues)
        ? (o.issues as { path: string; message: string }[]).filter(
            (i) => i && typeof i.path === 'string',
          )
        : undefined,
    };
  }
  const name = str(o.name);
  const version = str(o.version);
  if (!name || !version) return null;
  return {
    kind: 'saved',
    status: str(o.status) ?? 'draft',
    name,
    version,
    quality_score: typeof o.quality_score === 'number' ? o.quality_score : null,
    security_status: str(o.security_status) ?? null,
    review_hint: str(o.review_hint) ?? '',
    issues: Array.isArray(o.issues)
      ? (o.issues as SkillSaved['issues']).filter((i) => i && typeof i.message === 'string')
      : [],
    review_required: str(o.review_required),
    publish_blocked: Array.isArray(o.publish_blocked) ? o.publish_blocked.map(String) : undefined,
  };
}

/** What the call itself asked for: why, and which version an update edited. */
export function skillCallArgs(input: unknown): { reason?: string; parent?: string } {
  const o = asObject(input) ?? {};
  return { reason: str(o.reason), parent: str(o.parent_version) };
}

/** The library page for a skill, at a version's Versions tab. */
/** A skill's editor — where a version the gate refused gets fixed. */
export function skillEditHref(name: string): string {
  return `/harness/skills?${new URLSearchParams({ skill: name, tab: 'edit' })}`;
}

export function skillLibraryHref(name: string, version?: string): string {
  const q = new URLSearchParams({ skill: name });
  if (version) {
    q.set('v', version);
    q.set('tab', 'versions');
  }
  return `/harness/skills?${q}`;
}
