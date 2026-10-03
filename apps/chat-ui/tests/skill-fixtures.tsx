import { TooltipProvider } from '@felix/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

/**
 * Shared by the skill library suites: a fake harness at the `fetch` seam and a
 * mount with the providers the library needs.
 *
 * The fake answers by method and path and *records* every request, so a test
 * asserts what was sent — the body of a save, the verb of a publish — rather
 * than only what was drawn. Unknown routes answer 404, which is what a route
 * the harness lacks does.
 */

export interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

export type Route = (req: Recorded) => { status?: number; body: unknown } | undefined;

export function fakeHarness(route: Route) {
  const requests: Recorded[] = [];
  const fn = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://x');
    const req: Recorded = {
      method: init.method ?? 'GET',
      path: `${url.pathname.replace(/^\/api/, '')}${url.search}`,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(req);
    const answer = route(req) ?? { status: 404, body: { error: 'not_found', message: 'no route' } };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return { requests, fn };
}

export function mountWithProviders(ui: ReactNode, at = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <TooltipProvider>{ui}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export const SKILL_MD = (name: string, body = '# Steps\n\n1. Do the thing.\n') =>
  `---\nname: ${name}\ndescription: Does a thing when asked to.\n---\n${body}`;

export function versionRow(over: Record<string, unknown> = {}) {
  return {
    name: 'roll-dice',
    version: '0.1.0',
    parent_version: null,
    status: 'draft',
    source: 'agent',
    author: 'quick',
    origin_manifest_id: 'quick',
    session_id: null,
    reason: '',
    description: 'Does a thing when asked to.',
    quality_score: 70,
    security_status: 'pass',
    decided_by: null,
    decision_note: null,
    created_at: Date.now() - 60_000,
    decided_at: null,
    published_at: null,
    ...over,
  };
}

export function fileBody(path: string, content: string) {
  return {
    path,
    encoding: 'utf-8',
    content_type: 'text/markdown; charset=utf-8',
    content,
    sha256: 'f'.repeat(64),
    size: content.length,
  };
}
