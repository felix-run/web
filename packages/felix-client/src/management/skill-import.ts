/**
 * Skills from GitHub: browse a repository, import a skill from it as a draft, follow the source
 * as it moves, and adopt an imported version once an operator has read it.
 *
 * - **Browse** lists every `SKILL.md` folder of a repository at one commit, and records that the
 *   tenant has now seen those files: the minimum import age (`import_min_age_days`) counts from
 *   the first sighting, by Felix's clock, never the pusher's commit date.
 * - **Import** saves one skill as a draft (`source: import`), never live. Imported text is
 *   third-party: the gate judges it as an import and an agent's use of it is screened.
 * - **Upstream** says which imported skills' sources have moved; a skill's own check diffs the
 *   source against its newest version, and **update** imports that as a new draft.
 * - **Adopt** is an operator vouching for an imported version with a reason: a new draft of the
 *   same files that no longer counts as an import from there on. It never publishes either.
 *
 * All tenant-library only (`skills:write` to change anything). Refusals are `SkillLibraryError`s
 * with the library's codes: `too_recent` (403, the cooldown), `rate_limited` (429, this tenant's
 * hourly GitHub budget), `upstream_error` / `upstream_rate_limited` / `egress_blocked` (502),
 * `source_not_found`, `source_not_allowed`, `invalid_source`, `not_imported`, `origin_mismatch`.
 */

import type { FelixHttp } from '../http';
import {
  nameSegment,
  refusalOf,
  type SkillUpstreamState,
  type SkillWriteResult,
  versionSegment,
} from './skills';

/** One skill a repository offers. */
export interface SkillSourceItem {
  /** From its SKILL.md frontmatter; the folder's name when it names none. */
  name: string;
  description: string;
  /** The folder in the repository. */
  path: string;
  /** What to import it by: `github:owner/repo/path`. */
  source: string;
  /** When this tenant first saw these exact files, and when the import age lets them in (epoch ms). */
  first_seen_at: number;
  eligible_at: number;
  /** Whether an import now would pass the minimum age. */
  eligible: boolean;
}

/** `GET /-/browse`: the skills a repository offers at one commit. */
export interface SkillSourceListing {
  source: string;
  ref: string;
  commit: string;
  license: string | null;
  min_age_days: number;
  /** At most 50; `found` says how many there were. */
  items: SkillSourceItem[];
  found: number;
  truncated: boolean;
}

/** A write from a source: the draft, whether the files were already the newest version's, and what was left out. */
export interface SkillImportResult extends SkillWriteResult {
  /** The source's files were already the newest version's: nothing was saved. */
  unchanged: boolean;
  /** Files the import did not keep: `evals/`, dot-paths, tests, build output, what did not fit. */
  dropped_files: string[];
  /**
   * Files the bundle has no place for, kept anyway: source path → where it went (`references/…`,
   * or `assets/…` for a binary asset), with the SKILL.md's references rewritten to match. Absent
   * from a harness older than felix-run/felix#613, which dropped them.
   */
  relocated_files?: Record<string, string>;
}

/** One file that differs between two versions of a skill, or a skill and its source. */
export interface SkillFileChange {
  path: string;
  change: 'added' | 'removed' | 'modified';
  /** A binary asset: sizes only, never a diff. */
  binary: boolean;
  old_size: number | null;
  new_size: number | null;
  /** A unified diff of a text file, or null (binary, too large, or past the answer's budget). */
  diff: string | null;
  /** The diff was cut short, or left out. */
  truncated: boolean;
}

/** The files that differ, unchanged ones left out. Third-party text: treat it as untrusted. */
export interface SkillDiff {
  /** The version compared against; null when there is none. */
  compared_with: string | null;
  files: SkillFileChange[];
  diff_truncated: boolean;
}

export interface SkillUpdateResult extends SkillImportResult {
  diff: SkillDiff;
}

/** `GET /{name}/-/upstream`: an imported skill against its source now. */
export interface SkillUpstreamCheck {
  name: string;
  current: {
    version: string;
    status: string;
    source: string;
    ref: string;
    commit: string | null;
    tree_hash: string | null;
    live_version: string | null;
  };
  upstream: {
    source: string;
    ref: string;
    commit: string;
    tree_hash: string;
    license: string | null;
    committed_at: number | null;
    first_seen_at: number;
    eligible_at: number;
    eligible: boolean;
  };
  update_available: boolean;
  min_age_days: number;
  diff: SkillDiff;
}

/** One imported skill in `GET /-/upstream`, with its last recorded check. */
export interface OutdatedSkill extends SkillUpstreamState {
  name: string;
  version: string;
  live_version: string | null;
  origin_source: string;
  origin_ref: string;
  origin_commit: string | null;
}

export interface OutdatedSkillPage {
  items: OutdatedSkill[];
  next_cursor: string | null;
  /** Whether this page re-checked GitHub, rather than reading the recorded state. */
  refreshed: boolean;
  min_age_days: number;
  /** Why a refresh stopped early: this tenant's GitHub budget, or the request's deadline. */
  stopped: 'rate_limited' | 'deadline' | null;
}

export function createSkillImportClient(http: FelixHttp) {
  const { chatFetch } = http;

  async function read<T>(route: string, res: Response): Promise<T> {
    if (!res.ok) throw await refusalOf(route, res);
    return (await res.json()) as T;
  }

  const json = (body: unknown): RequestInit => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  /** GET /skill-library/-/browse → the skills a repository offers (`github:owner/repo[/path]`). */
  async function browseSkillSource(source: string, ref?: string): Promise<SkillSourceListing> {
    const q = new URLSearchParams({ source });
    if (ref) q.set('ref', ref);
    return read('skill-library/browse', await chatFetch(`/skill-library/-/browse?${q}`));
  }

  /** POST /skill-library/-/import → one skill from a source, as a draft. Never live. */
  async function importSkill(source: string, ref?: string): Promise<SkillImportResult> {
    return read(
      'skill-library/import',
      await chatFetch('/skill-library/-/import', {
        method: 'POST',
        ...json(ref ? { source, ref } : { source }),
      }),
    );
  }

  /**
   * GET /skill-library/-/upstream → imported skills and their last recorded check. `refresh`
   * re-checks GitHub for this page, against the tenant's hourly budget; without it the answer
   * is what the harness last recorded.
   */
  async function listOutdatedSkills(
    opts: { refresh?: boolean; limit?: number; cursor?: string | null } = {},
  ): Promise<OutdatedSkillPage> {
    const q = new URLSearchParams();
    if (opts.refresh) q.set('refresh', 'true');
    q.set('limit', String(Math.min(25, Math.max(1, opts.limit ?? 25))));
    if (opts.cursor) q.set('cursor', opts.cursor);
    return read('skill-library/upstream', await chatFetch(`/skill-library/-/upstream?${q}`));
  }

  /** GET /skill-library/{name}/-/upstream → the skill's source now, diffed against its newest version. */
  async function checkSkillUpstream(name: string): Promise<SkillUpstreamCheck> {
    return read(
      'skill-library/check',
      await chatFetch(`/skill-library/${nameSegment(name)}/-/upstream`),
    );
  }

  /** POST /skill-library/{name}/-/update → the source's files now, as a new draft. */
  async function updateSkillFromSource(name: string): Promise<SkillUpdateResult> {
    return read(
      'skill-library/update',
      await chatFetch(`/skill-library/${nameSegment(name)}/-/update`, {
        method: 'POST',
        ...json({}),
      }),
    );
  }

  /**
   * POST /skill-library/{name}/versions/{v}/adopt → vouch for an imported version: a new draft of
   * the same files that no longer counts as an import. The reason is required and audited.
   */
  async function adoptSkillVersion(
    name: string,
    version: string,
    reason: string,
  ): Promise<SkillWriteResult> {
    return read(
      'skill-library/adopt',
      await chatFetch(
        `/skill-library/${nameSegment(name)}/versions/${versionSegment(version)}/adopt`,
        { method: 'POST', ...json({ reason }) },
      ),
    );
  }

  return {
    browseSkillSource,
    importSkill,
    listOutdatedSkills,
    checkSkillUpstream,
    updateSkillFromSource,
    adoptSkillVersion,
  };
}
