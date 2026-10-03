/**
 * A 0-100 quality score from weighted heuristic checks — `felix/skills/review.py`.
 *
 * The score is the weight of the checks that pass over the weight of all of
 * them. An invalid bundle scores 0 and is not checked further. The harness
 * re-runs this on every save and publish; the editor runs it to show the score
 * a save would get before it is made.
 */

import { type SkillBundle, type SkillFrontmatter, validateSkillBundle } from './format';

export interface ReviewCheck {
  id: string;
  label: string;
  passed: boolean;
  message: string;
  weight: number;
}

export interface SkillReviewResult {
  score: number;
  checks: ReviewCheck[];
}

export interface ReviewRubricConfig {
  /** A fraction (0.3 = weight 30) for the `valid-bundle` check. */
  validationWeight?: number;
  checks?: { id: string; weight: number; enabled?: boolean }[];
}

const HEADING_RE = /^#+\s/m;
const STEP_RE = /^\d+\.|^-\s/m;
const IMPACT_CHECKS = new Set(['scripts-dir', 'actionable-steps', 'body-length']);
const length = (text: string) => [...text].length;

export function reviewSkillBundle(
  files: SkillBundle,
  expectedSlug?: string,
  rubric?: ReviewRubricConfig | null,
): SkillReviewResult {
  const validation = validateSkillBundle(files, expectedSlug);
  const overrides = new Map((rubric?.checks ?? []).map((c) => [c.id, c]));
  const disabled = new Set(
    (rubric?.checks ?? []).filter((c) => c.enabled === false).map((c) => c.id),
  );
  const validationWeight =
    rubric?.validationWeight != null
      ? Math.round(rubric.validationWeight * 100)
      : (overrides.get('valid-bundle')?.weight ?? 30);

  const validCheck: ReviewCheck = {
    id: 'valid-bundle',
    label: 'agentskills.io bundle valid',
    passed: validation.valid,
    message: validation.valid
      ? 'Bundle passes agentskills.io validation'
      : validation.errors.map((e) => e.message).join('; '),
    weight: validationWeight,
  };
  if (!validation.valid) return { score: 0, checks: [validCheck] };

  const checks = [
    validCheck,
    ...reviewFrontmatter(validation.frontmatter),
    ...reviewBody(validation.body),
    ...reviewStructure(files),
  ];
  const weighted = checks
    .filter((c) => !disabled.has(c.id))
    .map((c) => {
      const override = overrides.get(c.id);
      return override ? { ...c, weight: override.weight } : c;
    });
  const total = weighted.reduce((s, c) => s + c.weight, 0);
  const earned = weighted.filter((c) => c.passed).reduce((s, c) => s + c.weight, 0);
  return { score: total > 0 ? Math.round((earned / total) * 100) : 0, checks: weighted };
}

function reviewFrontmatter(fm: SkillFrontmatter): ReviewCheck[] {
  const n = length(fm.description);
  return [
    {
      id: 'description-length',
      label: 'Description length',
      passed: n >= 20 && n <= 500,
      message:
        n >= 20 ? 'Description is substantive' : 'Description should be at least 20 characters',
      weight: 15,
    },
    {
      id: 'license-metadata',
      label: 'License or metadata',
      passed: Boolean(fm.license || (fm.metadata && Object.keys(fm.metadata).length > 0)),
      message: 'Includes license or metadata for discoverability',
      weight: 5,
    },
    {
      id: 'compatibility',
      label: 'Compatibility notes',
      passed: Boolean(fm.compatibility),
      message: 'Documents agent/environment compatibility',
      weight: 5,
    },
  ];
}

function reviewBody(body: string): ReviewCheck[] {
  const trimmed = body.trim();
  const substantive = length(trimmed) >= 100;
  return [
    {
      id: 'body-length',
      label: 'Instruction body',
      passed: substantive,
      message: substantive
        ? 'Body has sufficient instruction content'
        : 'Body should be at least 100 characters',
      weight: 15,
    },
    {
      id: 'headings',
      label: 'Structured headings',
      passed: HEADING_RE.test(trimmed),
      message: 'Uses markdown headings for structure',
      weight: 10,
    },
    {
      id: 'actionable-steps',
      label: 'Actionable steps',
      passed: STEP_RE.test(trimmed),
      message: 'Includes numbered or bulleted steps',
      weight: 10,
    },
  ];
}

function reviewStructure(files: SkillBundle): ReviewCheck[] {
  const paths = Object.keys(files);
  const hasScripts = paths.some((p) => p.startsWith('scripts/'));
  const hasReferences = paths.some((p) => p.startsWith('references/'));
  const hasPlugin = 'plugin.json' in files;
  return [
    {
      id: 'scripts-dir',
      label: 'Scripts directory',
      passed: hasScripts,
      message: hasScripts
        ? 'Includes executable scripts'
        : 'Optional scripts/ directory not present',
      weight: 5,
    },
    {
      id: 'references-dir',
      label: 'References directory',
      passed: hasReferences,
      message: hasReferences
        ? 'Includes reference docs'
        : 'Optional references/ directory not present',
      weight: 5,
    },
    {
      id: 'plugin-manifest',
      label: 'Plugin manifest',
      passed: hasPlugin,
      message: hasPlugin ? 'plugin.json present for bundled context' : 'No plugin.json (optional)',
      weight: 5,
    },
  ];
}

/** A heuristic impact estimate from review signals alone — no agent run. */
export function estimateImpactScore(review: SkillReviewResult): number {
  const bonus = review.checks.filter((c) => c.passed && IMPACT_CHECKS.has(c.id)).length;
  return Math.min(100, Math.round(review.score * 0.7 + bonus * 10));
}
