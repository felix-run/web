import type { Location } from 'react-router';

/** The working copy's side of a comparison, named as the URL names it. */
export const EDITOR = 'editor';

/**
 * The tabs of one skill's page, declared once.
 *
 * `ready: false` entries are the slots for what the harness does not serve yet:
 * per-version evals and the feedback inbox arrive with the harness's skill
 * feedback-and-evals routes (`POST …/eval`, `GET {name}/evals`,
 * `GET|POST {name}/feedback`). They are **hidden** rather than drawn disabled —
 * a disabled tab cannot be focused or hovered, so it could never say why it is
 * there — and turning one on is this table, a panel in the switch below and a
 * client module beside `management/skills.ts`.
 */
export const SKILL_TABS = [
  { id: 'edit', label: 'Edit', ready: true },
  { id: 'versions', label: 'Versions', ready: true },
  { id: 'review', label: 'Review', ready: true },
  { id: 'files', label: 'Files', ready: true },
  { id: 'evals', label: 'Evals', ready: false },
  { id: 'feedback', label: 'Feedback', ready: false },
] as const;

export type SkillTab = (typeof SKILL_TABS)[number]['id'];

export function isSkillTab(value: string | null): value is SkillTab {
  return SKILL_TABS.some((t) => t.ready && t.id === value);
}

/** Leaving the skill page is a different path or a different `skill`; a tab or a compare is not. */
export function leavesSkill(from: Location, to: Location): boolean {
  if (from.pathname !== to.pathname) return true;
  return (
    new URLSearchParams(from.search).get('skill') !== new URLSearchParams(to.search).get('skill')
  );
}

export interface SkillAddress {
  tab: SkillTab;
  /** The version the Versions, Review and Files tabs are looking at. */
  version: string | null;
  /** The other side of a comparison: a version, or `editor`. */
  against: string | null;
}
