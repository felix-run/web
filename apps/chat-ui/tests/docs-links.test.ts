import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOCS_ORIGIN } from '../src/components/harness/panel';
import { HARNESS_DESTINATIONS, LEDGER_DOCS } from '../src/routes/harness';

/**
 * Every `/harness` page links to its reference on the docs site, and a link to a
 * heading that has been renamed still loads — at the top of the page, with nothing
 * to say the section it promised is gone. So the links are checked against the
 * docs' own source: the page must exist in `apps/docs/src/content`, and the
 * anchor must be one Starlight will generate from a heading on it.
 */

const CONTENT = fileURLToPath(new URL('../../docs/src/content/', import.meta.url));

/** GitHub-style heading slugs, which is what Starlight generates for these headings. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function anchorsOf(file: string): Set<string> {
  const headings = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => /^#{2,6}\s/.test(l))
    .map((l) => l.replace(/^#+\s*/, ''));
  return new Set(headings.map(slug));
}

const links = [
  ...HARNESS_DESTINATIONS.map((d) => [d.label, d.docs] as const),
  ['Ledger · Activity', LEDGER_DOCS.activity] as const,
  ['Ledger · Usage', LEDGER_DOCS.usage] as const,
];

describe('the /harness docs links', () => {
  it.each(links)('%s links to a page and section that exist', (_label, href) => {
    expect(href.startsWith(`${DOCS_ORIGIN}/`)).toBe(true);
    const url = new URL(href);
    const page = `${CONTENT}${url.pathname.replace(/^\//, '').replace(/\/$/, '')}.mdx`;
    expect(existsSync(page), `${url.pathname} has no source at ${page}`).toBe(true);
    if (url.hash) {
      expect(anchorsOf(page).has(url.hash.slice(1)), `${url.hash} is not a heading`).toBe(true);
    }
  });

  it('catches an anchor that is not a heading', () => {
    // The check itself, against a heading that does not exist, so it cannot pass
    // vacuously by reading an empty file.
    const page = `${CONTENT}guide/management-api.mdx`;
    expect(anchorsOf(page).has('memory')).toBe(true);
    expect(anchorsOf(page).has('no-such-section')).toBe(false);
  });
});
