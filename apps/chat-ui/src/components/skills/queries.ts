import type {
  FeedbackStatus,
  SkillEval,
  SkillFeedback,
  SkillPage,
  SkillPolicyPatch,
  SkillSource,
} from '@felix/client';
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  acceptSkillFeedback,
  archiveLibrarySkill,
  getLibrarySkill,
  getSkillFile,
  getSkillPublishPolicy,
  getSkillVersion,
  listFeedbackInbox,
  listLibrarySkills,
  listSkillEvals,
  listSkillFeedback,
  listSkillReviewQueue,
  previewSkillVersion,
  publishSkillVersion,
  queueSkillEval,
  readSkillBundle,
  rejectSkillFeedback,
  rejectSkillVersion,
  resetSkillPublishPolicy,
  rollbackSkillVersion,
  submitSkillFeedback,
  updateSkillPublishPolicy,
} from '@/api';

/**
 * The skill library's reads and writes, as TanStack Query keys and hooks.
 *
 * The library is the first surface here on Query rather than `usePoll`, and
 * that is deliberate rather than a migration: these are reads an operator
 * *acts on* — publish, roll back, reject — and every action has to leave every
 * view of the library current at once. One key prefix (`skillKeys.all`) is
 * what a write invalidates, so the list, the queue, the skill page and the
 * inline chat card all refetch together rather than each guessing what changed.
 *
 * Almost nothing here polls. A library changes when someone acts on it; the
 * views refetch on mount and after every write. The exception is work the
 * worker is doing — an evaluation queued or running, an accepted improvement
 * not yet applied — which is polled every few seconds while it is in flight
 * and not a moment after.
 */

export type LibraryFilter = {
  status?: 'live' | 'draft' | 'archived';
  source?: SkillSource;
};

export const skillKeys = {
  all: ['skill-library'] as const,
  list: (filter: LibraryFilter) => [...skillKeys.all, 'list', filter] as const,
  queue: () => [...skillKeys.all, 'queue'] as const,
  policy: () => [...skillKeys.all, 'policy'] as const,
  skill: (name: string) => [...skillKeys.all, 'skill', name] as const,
  version: (name: string, version: string) => [...skillKeys.all, 'version', name, version] as const,
  bundle: (name: string, version: string) => [...skillKeys.all, 'bundle', name, version] as const,
  preview: (name: string, version: string) => [...skillKeys.all, 'preview', name, version] as const,
  file: (name: string, version: string, path: string) =>
    [...skillKeys.all, 'file', name, version, path] as const,
  evals: (name: string, version: string | null) =>
    [...skillKeys.all, 'evals', name, version ?? ''] as const,
  feedback: (name: string, status: FeedbackStatus | null) =>
    [...skillKeys.all, 'feedback', name, status ?? ''] as const,
  inbox: (status: FeedbackStatus) => [...skillKeys.all, 'inbox', status] as const,
};

/** How often in-flight worker jobs are re-read. */
export const JOB_POLL_MS = 3_000;

/**
 * A stored version's bytes never change — a save makes a new version — so its
 * bundle and files are never stale. They are also the one place the editor's
 * own save is seeded with the *unredacted* files it sent; refetching them would
 * swap in the harness's secret-redacted read and put `[REDACTED]` in the
 * working copy.
 */
const IMMUTABLE = new Set(['bundle', 'file']);

/** Every mutable view of the library is stale after a write — the one rule a mutation follows. */
export function invalidateLibrary(client: QueryClient) {
  return client.invalidateQueries({
    queryKey: skillKeys.all,
    predicate: (query) => !IMMUTABLE.has(String(query.queryKey[1])),
  });
}

/** Rows a filtered listing tries to fill before it stops following `next_cursor` by itself. */
export const LIBRARY_PAGE = 50;

/**
 * The library, page by page.
 *
 * `next_cursor` is followed until null — the route filters each page after
 * reading it, so a page can come back empty and still have a next one, and an
 * empty page is not the end of the list.
 */
export function useLibraryPages(filter: LibraryFilter) {
  return useInfiniteQuery({
    queryKey: skillKeys.list(filter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listLibrarySkills({ ...filter, limit: LIBRARY_PAGE, cursor: pageParam }),
    getNextPageParam: (last: SkillPage<unknown>) => last.next_cursor ?? undefined,
  });
}

/** Every draft waiting on a decision, across skills, oldest first. */
export function useReviewQueue(enabled = true) {
  return useInfiniteQuery({
    queryKey: skillKeys.queue(),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listSkillReviewQueue({ limit: 50, cursor: pageParam }),
    getNextPageParam: (last: SkillPage<unknown>) => last.next_cursor ?? undefined,
    enabled,
  });
}

export function usePublishPolicy() {
  return useQuery({
    queryKey: skillKeys.policy(),
    queryFn: getSkillPublishPolicy,
    staleTime: 60_000,
  });
}

export function useLibrarySkill(name: string | null) {
  return useQuery({
    queryKey: skillKeys.skill(name ?? ''),
    queryFn: () => getLibrarySkill(name ?? ''),
    enabled: !!name,
  });
}

export function useSkillVersion(name: string, version: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.version(name, version ?? ''),
    queryFn: () => getSkillVersion(name, version ?? ''),
    enabled: !!name && !!version,
  });
}

/**
 * A version's whole bundle. Stored versions never change — a save makes a new
 * one — so a bundle once read is fresh for as long as it is cached.
 */
export function useSkillBundleFiles(name: string, version: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.bundle(name, version ?? ''),
    queryFn: () => readSkillBundle(name, version ?? ''),
    enabled: !!name && !!version,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** One file of a stored version — the SKILL.md a diff needs, without the rest of the bundle. */
export function useSkillFile(name: string, version: string | null | undefined, path = 'SKILL.md') {
  return useQuery({
    queryKey: skillKeys.file(name, version ?? '', path),
    queryFn: () => getSkillFile(name, version ?? '', path),
    enabled: !!name && !!version,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSkillPreview(name: string, version: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.preview(name, version ?? ''),
    queryFn: () => previewSkillVersion(name, version ?? ''),
    enabled: !!name && !!version,
  });
}

/** Publish, roll back and reject: each a state change on one version, then a refetch of all. */
/** A move to live, pinned to the live version the operator was shown (`null`: nothing was). */
export interface MakeLive {
  name: string;
  version: string;
  expectedLive: string | null;
}

export function useVersionActions() {
  const client = useQueryClient();
  const after = { onSettled: () => invalidateLibrary(client) };
  const publish = useMutation({
    mutationFn: (v: MakeLive) =>
      publishSkillVersion(v.name, v.version, { expectedLive: v.expectedLive }),
    ...after,
  });
  const rollback = useMutation({
    mutationFn: (v: MakeLive) =>
      rollbackSkillVersion(v.name, v.version, { expectedLive: v.expectedLive }),
    ...after,
  });
  const reject = useMutation({
    mutationFn: (v: { name: string; version: string; note: string }) =>
      rejectSkillVersion(v.name, v.version, v.note),
    ...after,
  });
  return { publish, rollback, reject };
}

/** Archive a skill: out of every catalog, its versions kept. */
export function useArchiveSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => archiveLibrarySkill(name),
    onSettled: () => invalidateLibrary(client),
  });
}

/** The skill as it stands now, from the harness and never the cache — what a confirm must show. */
export function useFreshSkill() {
  const client = useQueryClient();
  return (name: string) =>
    client.fetchQuery({
      queryKey: skillKeys.skill(name),
      queryFn: () => getLibrarySkill(name),
      staleTime: 0,
    });
}

const inFlightEval = (e: SkillEval) => e.status === 'queued' || e.status === 'running';

/** A version's evaluations, newest first, re-read every few seconds while one is in flight. */
export function useSkillEvals(name: string, version: string | null, { poll = true } = {}) {
  return useQuery({
    queryKey: skillKeys.evals(name, version),
    queryFn: () => listSkillEvals(name, version ? { version } : {}),
    enabled: !!name,
    // One poll per page: the harness rate-limits each caller, and a second view
    // of the same in-flight row would double the requests for nothing.
    refetchInterval: (query) =>
      poll && query.state.data?.items.some(inFlightEval) ? JOB_POLL_MS : false,
  });
}

export function useQueueEval() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; version: string }) => queueSkillEval(v.name, v.version),
    onSettled: () => invalidateLibrary(client),
  });
}

/** An accepted improvement the worker has not finished: still worth re-reading. */
const inFlightFeedback = (f: SkillFeedback) => f.status === 'accepted' && f.improve;

export function useSkillFeedback(name: string, status: FeedbackStatus | null) {
  return useQuery({
    queryKey: skillKeys.feedback(name, status),
    queryFn: () => listSkillFeedback(name, status ? { status } : {}),
    enabled: !!name,
    refetchInterval: (query) =>
      query.state.data?.items.some(inFlightFeedback) ? JOB_POLL_MS : false,
  });
}

/** Feedback across every skill in one status, oldest first. */
export function useFeedbackInbox(status: FeedbackStatus = 'pending') {
  return useInfiniteQuery({
    queryKey: skillKeys.inbox(status),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listFeedbackInbox({ status, cursor: pageParam }),
    getNextPageParam: (last: SkillPage<unknown>) => last.next_cursor ?? undefined,
  });
}

export function useFeedbackActions() {
  const client = useQueryClient();
  const after = { onSettled: () => invalidateLibrary(client) };
  const submit = useMutation({
    mutationFn: (v: {
      name: string;
      body: string;
      suggested_patch?: string;
      target_version?: string;
    }) => submitSkillFeedback(v.name, v),
    ...after,
  });
  const accept = useMutation({
    mutationFn: (v: { id: string; improve: boolean; note?: string }) =>
      acceptSkillFeedback(v.id, { improve: v.improve, note: v.note }),
    ...after,
  });
  const reject = useMutation({
    mutationFn: (v: { id: string; note: string }) => rejectSkillFeedback(v.id, v.note),
    ...after,
  });
  return { submit, accept, reject };
}

export function usePolicyActions() {
  const client = useQueryClient();
  const after = { onSettled: () => invalidateLibrary(client) };
  const update = useMutation({
    mutationFn: (patch: SkillPolicyPatch) => updateSkillPublishPolicy(patch),
    ...after,
  });
  const reset = useMutation({ mutationFn: () => resetSkillPublishPolicy(), ...after });
  return { update, reset };
}
