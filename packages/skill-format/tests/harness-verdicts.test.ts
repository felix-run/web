import { describe, expect, it } from 'vitest';
import { validateSkillBundle } from '../src';
import corpus from './harness-verdicts.json';

/**
 * The editor must refuse exactly what the harness refuses, with the same path
 * and message, or it either blocks a save the harness would take or — worse —
 * offers one it will refuse. Each case's expected errors were produced by the
 * harness's own `validate_skill_bundle`, so a disagreement here is a bug in
 * this package, never a matter of taste.
 */
describe('verdicts match the harness', () => {
  it.each(
    corpus.cases.map((c, i) => [i, c.skill_md, c.errors] as const),
  )('case %i', (_i, skillMd, errors) => {
    const result = validateSkillBundle({ 'SKILL.md': skillMd }, corpus.slug);
    expect(result.errors.map((e) => [e.path, e.message])).toEqual(errors);
  });
});
