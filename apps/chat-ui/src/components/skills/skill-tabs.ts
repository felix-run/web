import type { Location } from 'react-router';

/** The working copy's side of a comparison, named as the URL names it. */
export const EDITOR = 'editor';

/**
 * The tabs of one skill's page, declared once. A `ready: false` entry is
 * hidden rather than drawn disabled — a disabled tab cannot be focused or
 * hovered, so it could never say why it is there.
 */
export const SKILL_TABS = [
  { id: 'edit', label: 'Edit', ready: true },
  { id: 'versions', label: 'Versions', ready: true },
  // `review` in the address, so links made before the rename still open it.
  // The tab is the publish gate; "Review" also named the queue on the library
  // page, and a reviewer read the two as one place.
  { id: 'review', label: 'Gate', ready: true },
  { id: 'evals', label: 'Evals', ready: true },
  { id: 'feedback', label: 'Feedback', ready: true },
] as const;
// A stored version's files are a section of Versions now, under the comparison
// that already lists what changed in them; `tab=files` falls to Versions with
// the version it named.

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
  /** The version the Versions, Gate, Evals and Feedback tabs are looking at. */
  version: string | null;
  /** The other side of a comparison: a version, or `editor`. */
  against: string | null;
}
