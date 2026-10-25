import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `public/_headers` allows the theme script in index.html by its hash. Edit the script and the
 * hash no longer names it: harmless while the policy is report-only, a missing theme on first
 * paint once it is enforced, and nothing in a build says so.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('the content security policy', () => {
  it('allows every inline script in index.html by its hash', () => {
    const html = read('../index.html');
    const policy = read('../public/_headers').match(/Content-Security-Policy[^:]*: (.+)/)?.[1];
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline.length).toBeGreaterThan(0);
    for (const body of inline) {
      const hash = createHash('sha256').update(body).digest('base64');
      expect(policy).toContain(`'sha256-${hash}'`);
    }
  });
});
