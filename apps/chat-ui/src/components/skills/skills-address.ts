import { useSearchParams } from 'react-router';
import { plural } from '@/components/harness/panel';
import { type LibraryFilter, useReviewQueue } from './queries';
import { isSkillTab, type SkillAddress } from './skill-tabs';

/**
 * The skills page's address, read and written in one place. Everything the
 * library shows is in the search string — which skill, which tab, which
 * versions, which filter — so a review link pasted into a chat opens on the
 * same diff. The harness agent picker's `?agent=` rides along untouched.
 */
export function useSkillsAddress() {
  const [params, setParams] = useSearchParams();
  const skill = params.get('skill');
  const status = params.get('status');
  const source = params.get('source');
  const filter: LibraryFilter = {
    status: status === 'live' || status === 'draft' || status === 'archived' ? status : undefined,
    source: source === 'agent' || source === 'operator' ? source : undefined,
  };
  const tab = params.get('tab');
  const address: SkillAddress = {
    tab: isSkillTab(tab) ? tab : 'versions',
    version: params.get('v'),
    against: params.get('against'),
  };

  const withParams = (edit: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    edit(next);
    return next;
  };
  const href = (next: URLSearchParams) => {
    const s = next.toString();
    return s ? `?${s}` : '?';
  };

  return {
    skill,
    filter,
    address,
    /** A skill's page, keeping the agent and the filter; a version opens Versions on it. */
    linkTo: (name: string, version?: string) =>
      href(
        withParams((n) => {
          n.set('skill', name);
          n.delete('against');
          if (version) {
            n.set('v', version);
            n.set('tab', 'versions');
          } else {
            n.delete('v');
            n.delete('tab');
          }
        }),
      ),
    backTo: href(
      withParams((n) => {
        for (const k of ['skill', 'tab', 'v', 'against']) n.delete(k);
      }),
    ),
    setFilter: (f: LibraryFilter) =>
      setParams(
        withParams((n) => {
          if (f.status) n.set('status', f.status);
          else n.delete('status');
          if (f.source) n.set('source', f.source);
          else n.delete('source');
        }),
        { replace: true },
      ),
    /** A tab or a comparison: a view change, so it replaces rather than stacking history. */
    setAddress: (a: Partial<SkillAddress>) =>
      setParams(
        withParams((n) => {
          if (a.tab) n.set('tab', a.tab);
          if (a.version !== undefined) {
            if (a.version) n.set('v', a.version);
            else n.delete('v');
          }
          if (a.against !== undefined) {
            if (a.against) n.set('against', a.against);
            else n.delete('against');
          }
        }),
        { replace: true },
      ),
  };
}

/** The pending-draft count for a header, `50+` when the queue's first page was full. */
export function usePendingDraftCount(): { count: number | null; text: string | undefined } {
  const queue = useReviewQueue();
  const first = queue.data?.pages[0];
  if (!first) return { count: null, text: undefined };
  const n = (queue.data?.pages ?? []).reduce((sum, p) => sum + p.items.length, 0);
  const more = !!queue.data?.pages.at(-1)?.next_cursor;
  if (n === 0) return { count: 0, text: undefined };
  return { count: n, text: `${plural(n, 'draft', 'drafts', more ? n : undefined)} waiting` };
}
