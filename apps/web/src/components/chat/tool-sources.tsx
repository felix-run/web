import type { PublishResult, SearchHit } from '@felix/client';
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@felix/ui/trace';
import { ArrowUpRightIcon, FileTextIcon, GitCommitHorizontalIcon, GlobeIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A search tool's result drawn as its sources (`parseSearchHits` in `@felix/client`) — the
 * links an agent read, which a numbered text block hid. Raw stays one click away, as it does
 * for a table, because this is a reading of the output and not the output itself.
 *
 * Titles, URLs and snippets are written by whoever ranked for the query, so they are drawn as
 * text, and only an http(s) URL becomes a link — opened in a new tab with no referrer, and only
 * when a person clicks it. A document's source that is not a URL stays a label.
 */
export function ToolSources({ hits, raw }: { hits: SearchHit[]; raw: string }) {
  const [view, setView] = useState<'sources' | 'raw'>('sources');
  return (
    <div data-slot="tool-sources">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">Output</span>
        <span>
          {hits.length.toLocaleString()} {hits.length === 1 ? 'source' : 'sources'}
        </span>
        <div role="group" aria-label="Output view" className="ml-auto flex gap-0.5">
          {(['sources', 'raw'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded px-1.5 py-0.5 capitalize',
                view === v ? 'bg-muted text-foreground' : 'hover:text-foreground',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === 'raw' ? (
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-background p-2.5 text-xs leading-relaxed text-foreground">
          {raw}
        </pre>
      ) : (
        <ol className="max-h-80 space-y-2 overflow-y-auto rounded-lg bg-background p-2.5">
          {hits.map((hit, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a hit's rank is its identity
            <li key={i} className="min-w-0">
              <Trace>
                <SourceLine hit={hit} />
              </Trace>
              {hit.snippet && (
                <p className="mt-0.5 ml-6 line-clamp-2 text-xs wrap-anywhere text-muted-foreground">
                  {hit.snippet}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SourceLine({ hit }: { hit: SearchHit }) {
  const where = hit.url ? hostOf(hit.url) : hit.location;
  const line = (
    <TraceLine className="text-xs">
      <TraceIcon>{hit.url ? <GlobeIcon /> : <FileTextIcon />}</TraceIcon>
      <TraceTitle className={cn('text-foreground', hit.url && 'underline underline-offset-2')}>
        {hit.title}
      </TraceTitle>
      {where && <TraceDescription className="text-muted-foreground">{where}</TraceDescription>}
    </TraceLine>
  );
  if (!hit.url) return line;
  return (
    <a href={hit.url} target="_blank" rel="noopener noreferrer" title={hit.url}>
      {line}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * What a `publish_commits` call put on GitHub, outside the card's fold: the result is one line
 * of text a person had to open the card to read, and *where it landed* is the thing asked of a
 * publish. The compare link is the harness's, shown only when it is http(s).
 */
export function PublishLine({ result }: { result: PublishResult }) {
  return (
    <div
      data-slot="publish-line"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-3.5 py-2"
    >
      <Trace className="w-auto min-w-0 flex-1">
        <TraceLine className="text-xs">
          <TraceIcon>
            <GitCommitHorizontalIcon />
          </TraceIcon>
          <TraceTitle className="text-foreground">
            Published {result.files} {result.files === 1 ? 'file' : 'files'} to{' '}
            <span className="font-mono">
              {result.repo}:{result.branch}
            </span>
          </TraceTitle>
          <TraceDescription className="font-mono text-muted-foreground">
            {result.sha.slice(0, 7)} · {result.mode}
          </TraceDescription>
        </TraceLine>
      </Trace>
      {result.compare && (
        <a
          href={result.compare}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-0.5 rounded text-xs text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Compare
          <ArrowUpRightIcon aria-hidden className="size-3" />
          <span className="sr-only"> on GitHub (opens in a new tab)</span>
        </a>
      )}
    </div>
  );
}
