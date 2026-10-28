/**
 * Two tool results with a shape worth drawing, read the way `parseTabular` reads a table:
 * conservatively, because a miss leaves the output as the text it was and a false positive
 * mangles output that was fine.
 */

/**
 * One hit from a search tool. The harness's `web_search` (`felix/tools/web_search.py`) and
 * `document_search` (`felix/tools/document_search.py`) both render numbered blocks — a title
 * at column zero, then lines indented three spaces: the URL or source, then the snippet or the
 * chunk. `location` is that second line; `url` is set only when it is an http(s) URL, since a
 * document's source can be any label the ingester chose.
 */
export interface SearchHit {
  title: string;
  location: string | null;
  url: string | null;
  snippet: string;
}

const HEAD = /^(\d+)\. (.+)$/;
const INDENT = '   ';

/**
 * The hits in a search tool's result, or null for anything else. Every block must be numbered
 * 1..n in order with every other line indented: the harness indents a hit's body precisely so
 * that a `N. ` at column zero can only be its own, and a block that breaks either rule is not a
 * search result. Titles and snippets are third-party text and are returned as text.
 */
export function parseSearchHits(output: unknown): SearchHit[] | null {
  if (typeof output !== 'string') return null;
  const text = output.replace(/\r\n/g, '\n').trim();
  if (!text) return null;
  const hits: SearchHit[] = [];
  for (const [i, block] of text.split(/\n\n+/).entries()) {
    const [head, ...rest] = block.split('\n');
    const m = HEAD.exec(head ?? '');
    if (!m || Number(m[1]) !== i + 1) return null;
    if (!rest.every((line) => line.startsWith(INDENT) || line.trim() === '')) return null;
    const body = rest.map((line) => line.slice(INDENT.length).trimEnd());
    const location = body[0]?.trim() || null;
    hits.push({
      title: (m[2] ?? '').trim(),
      location,
      url: location && httpUrl(location),
      snippet: body.slice(1).join('\n').trim(),
    });
  }
  return hits.length ? hits : null;
}

/** `value` when it parses as an http(s) URL, else null — never a `javascript:` or `data:` one. */
export function httpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** What a `publish_commits` call put on GitHub, read off its one-line result. */
export interface PublishResult {
  files: number;
  repo: string;
  branch: string;
  sha: string;
  /** `new branch` when the call created it, `fast-forward` when it moved an existing one. */
  mode: 'new branch' | 'fast-forward';
  parent: string;
  /** The compare page, when the result's URL is http(s). */
  compare: string | null;
}

export const PUBLISH_TOOL = 'publish_commits';

// `felix/tools/github_publish.py`, `_PublishExecutor.execute`:
//   published {n} file(s) to {repo}:{branch} as {sha} ({mode}, parent {parent})
//   compare: {url}
const PUBLISHED =
  /^published (\d+) file\(s\) to ([^\s:]+):(\S+) as ([0-9a-f]{7,64}) \((new branch|fast-forward), parent ([0-9a-f]{7,64})\)(?:\ncompare: (\S+))?$/;

/** The publish a `publish_commits` result reports, or null for any other result. */
export function parsePublishResult(name: string, output: unknown): PublishResult | null {
  if (name !== PUBLISH_TOOL || typeof output !== 'string') return null;
  const m = PUBLISHED.exec(output.trim());
  if (!m) return null;
  const [, files, repo, branch, sha, mode, parent, compare] = m;
  return {
    files: Number(files),
    repo: repo ?? '',
    branch: branch ?? '',
    sha: sha ?? '',
    mode: mode as PublishResult['mode'],
    parent: parent ?? '',
    compare: compare ? httpUrl(compare) : null,
  };
}
