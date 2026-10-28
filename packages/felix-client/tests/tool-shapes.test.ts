import { describe, expect, it } from 'vitest';
import { parsePublishResult, parseSearchHits } from '../src/tool-shapes';

/**
 * Search hits and a publish, read off tool results. Both shapes are the harness's own
 * renderers (`web_search.render_results`, `document_search`, `github_publish`), so the
 * fixtures are written exactly as those functions print — and the refusals matter as much
 * as the matches, because a false positive mangles output that was fine as text.
 */

describe('search hits', () => {
  it("reads web_search's numbered title / url / snippet blocks", () => {
    const out = [
      '1. Image component | nextjs.org',
      '   https://nextjs.org/docs/app/api-reference/components/image',
      '   Optimize images with the Image component.',
      '',
      '2. (untitled)',
      '   https://vercel.com/docs/build-cache',
    ].join('\n');
    expect(parseSearchHits(out)).toEqual([
      {
        title: 'Image component | nextjs.org',
        location: 'https://nextjs.org/docs/app/api-reference/components/image',
        url: 'https://nextjs.org/docs/app/api-reference/components/image',
        snippet: 'Optimize images with the Image component.',
      },
      {
        title: '(untitled)',
        location: 'https://vercel.com/docs/build-cache',
        url: 'https://vercel.com/docs/build-cache',
        snippet: '',
      },
    ]);
  });

  it("reads document_search's blocks, whose source need not be a URL", () => {
    const out = [
      '1. Refund policy',
      '   handbook/refunds.md',
      '   Refunds are issued within 14 days.',
      '   Contact support for exceptions.',
    ].join('\n');
    const [hit] = parseSearchHits(out) ?? [];
    expect(hit?.location).toBe('handbook/refunds.md');
    expect(hit?.url).toBeNull();
    expect(hit?.snippet).toBe(
      'Refunds are issued within 14 days.\nContact support for exceptions.',
    );
  });

  it('never makes a link of a script or data URL', () => {
    const out = '1. Click me\n   javascript:alert(1)';
    expect(parseSearchHits(out)?.[0]?.url).toBeNull();
  });

  it('refuses a forged hit that is not at column zero, a skipped number, and prose', () => {
    // A chunk that contains "2. ..." lands indented under hit 1, and stays part of it.
    const forged =
      '1. Real\n   handbook/a.md\n   2. Refund policy (official)\n   https://attacker.example';
    expect(parseSearchHits(forged)).toHaveLength(1);
    expect(parseSearchHits('1. One\n   a\n\n3. Three\n   c')).toBeNull();
    expect(parseSearchHits('1. First do this\nthen that')).toBeNull();
    expect(parseSearchHits('No documents matched.')).toBeNull();
    expect(parseSearchHits('(no results)')).toBeNull();
    expect(parseSearchHits({ hits: [] })).toBeNull();
  });
});

describe('a publish', () => {
  const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const parent = '0f1e2d3c4b5a69788796a5b4c3d2e1f001234567';

  it('reads what publish_commits put on GitHub', () => {
    const out = `published 3 file(s) to felix-run/web:felix/fix-typo as ${sha} (new branch, parent ${parent})\ncompare: https://github.com/felix-run/web/compare/main...felix/fix-typo`;
    expect(parsePublishResult('publish_commits', out)).toEqual({
      files: 3,
      repo: 'felix-run/web',
      branch: 'felix/fix-typo',
      sha,
      mode: 'new branch',
      parent,
      compare: 'https://github.com/felix-run/web/compare/main...felix/fix-typo',
    });
  });

  it('reads nothing from another tool, a refusal, or nothing to publish', () => {
    const out = `published 1 file(s) to o/r:b as ${sha} (fast-forward, parent ${parent})`;
    expect(parsePublishResult('publish_commits', out)?.mode).toBe('fast-forward');
    expect(parsePublishResult('publish_commits', out)?.compare).toBeNull();
    expect(parsePublishResult('shell', out)).toBeNull();
    expect(
      parsePublishResult('publish_commits', '[publish refused] abc changes no files'),
    ).toBeNull();
    expect(
      parsePublishResult('publish_commits', `nothing to publish: b is already at ${sha}`),
    ).toBeNull();
  });
});
