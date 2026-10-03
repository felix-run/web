import type { SkillPage, SkillSource } from '@felix/client';
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  archiveLibrarySkill,
  getLibrarySkill,
  getSkillFile,
  getSkillPublishPolicy,
  getSkillVersion,
  listLibrarySkills,
  listSkillReviewQueue,
  previewSkillVersion,
  publishSkillVersion,
  readSkillBundle,
  rejectSkillVersion,
  rollbackSkillVersion,
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
 * Nothing here polls. A library changes when someone acts on it; the views
 * refetch on mount and after every write, and say how old they are otherwise.
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
};

/** Every view of the library is stale after a write — the one rule a mutation follows. */
export function invalidateLibrary(client: QueryClient) {
  return client.invalidateQueries({ queryKey: skillKeys.all });
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
export function useVersionActions() {
  const client = useQueryClient();
  const after = { onSettled: () => invalidateLibrary(client) };
  const publish = useMutation({
    mutationFn: (v: { name: string; version: string }) => publishSkillVersion(v.name, v.version),
    ...after,
  });
  const rollback = useMutation({
    mutationFn: (v: { name: string; version: string }) => rollbackSkillVersion(v.name, v.version),
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
