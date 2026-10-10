import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaseRefusedError } from '../src/errors';
import { createFelixClient, WorkspaceChangedError, WorkspaceRouteError } from '../src/transport';

/**
 * The thread's workspace on the harness (`/chat/workspace/*`, felix-run/felix#578)
 * and the catalog field that says whether an agent works in it. What is pinned is
 * what each call sends, how each answer is read — above all that a refused
 * conditional write is its own error, carrying the hash the file has now — and
 * that an older harness, which has none of it, reads as "nothing" rather than
 * as a failure.
 */

let posted: Array<{ url: string; body: unknown }>;
function stub(handler: (url: string) => Response) {
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return handler(url);
    }),
  );
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const client = () => createFelixClient({ baseUrl: '/api' });

beforeEach(() => vi.unstubAllGlobals());

describe('GET /chat/workspace/tree', () => {
  it('reads the tree, keeping only well-formed entries', async () => {
    stub(() =>
      json({
        root_kind: 'scoped',
        scope: 'thread',
        manifest: 'contributor',
        entries: [
          { path: 'src', type: 'dir' },
          { path: 'src/a.py', type: 'file', bytes: 12 },
          { path: 7, type: 'file' },
        ],
        truncated: false,
      }),
    );
    const tree = await client().workspaceTree({ threadId: 't1', manifest: 'contributor' });
    expect(posted[0]?.url).toBe('/api/chat/workspace/tree?thread_id=t1&manifest=contributor');
    expect(tree).toEqual({
      rootKind: 'scoped',
      scope: 'thread',
      manifest: 'contributor',
      entries: [
        { path: 'src', type: 'dir' },
        { path: 'src/a.py', type: 'file', bytes: 12 },
      ],
      truncated: false,
    });
  });

  it('is null from a harness without the route, and an error for an unknown manifest', async () => {
    stub(() => json({ detail: 'Not Found' }, 404));
    await expect(client().workspaceTree({ threadId: 't1' })).resolves.toBeNull();
    stub(() => json({ detail: 'unknown_manifest' }, 404));
    await expect(client().workspaceTree({ threadId: 't1', manifest: 'x' })).rejects.toMatchObject({
      code: 'unknown_manifest',
    });
  });
});

describe('GET /chat/workspace/file', () => {
  it('decodes text and base64 alike into bytes, with the hash', async () => {
    stub(() =>
      json({ path: 'a.txt', bytes: 2, sha256: 'ab'.repeat(32), encoding: 'utf-8', content: 'hé' }),
    );
    const text = await client().workspaceRead({ threadId: 't1', path: 'a.txt' });
    expect(new TextDecoder().decode(text.bytes)).toBe('hé');
    expect(text.sha256).toBe('ab'.repeat(32));

    stub(() =>
      json({
        path: 'b.bin',
        bytes: 3,
        sha256: 'cd'.repeat(32),
        encoding: 'base64',
        content: 'AAEC',
      }),
    );
    const bin = await client().workspaceRead({ threadId: 't1', path: 'b.bin' });
    expect([...bin.bytes]).toEqual([0, 1, 2]);
  });

  it('throws the refusal by its code', async () => {
    stub(() => json({ detail: 'too_large' }, 413));
    const err = await client()
      .workspaceRead({ threadId: 't1', path: 'big.log' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WorkspaceRouteError);
    expect(err).toMatchObject({ status: 413, code: 'too_large' });
  });
});

describe('POST /chat/workspace/write', () => {
  it('sends the hash it was read at, and reads what the harness did with the note', async () => {
    stub(() =>
      json({ status: 'recorded', path: 'a', bytes: 5, sha256: 'ee'.repeat(32), event_id: 'e1' }),
    );
    await expect(
      client().workspaceWrite({
        threadId: 't1',
        path: 'a',
        content: 'hello',
        expectedSha256: 'ab'.repeat(32),
      }),
    ).resolves.toEqual({ status: 'recorded', bytes: 5, sha256: 'ee'.repeat(32), eventId: 'e1' });
    expect(posted[0]?.body).toEqual({
      thread_id: 't1',
      path: 'a',
      content: 'hello',
      expected_sha256: 'ab'.repeat(32),
    });
  });

  it('refuses a changed file as its own error, with the hash the file has now', async () => {
    stub(() => json({ detail: 'workspace_changed', sha256: 'ff'.repeat(32), bytes: 9 }, 409));
    const err = await client()
      .workspaceWrite({ threadId: 't1', path: 'a', content: 'x', expectedSha256: 'ab'.repeat(32) })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WorkspaceChangedError);
    expect(err).toMatchObject({ sha256: 'ff'.repeat(32), bytes: 9 });
  });

  it('is refused like any driving request when another client holds the thread', async () => {
    stub(() => json({ detail: 'lease_held' }, 409));
    await expect(
      client().workspaceWrite({ threadId: 't1', path: 'a', content: 'x' }),
    ).rejects.toBeInstanceOf(LeaseRefusedError);
  });
});

describe("the catalog's workspace field", () => {
  it('says which workspace an agent works in, and nothing for an older harness', async () => {
    stub(() =>
      json({
        data: [
          { id: 'contributor', felix: { workspace: { tools: 'server', scope: 'thread' } } },
          { id: 'cowork', felix: { workspace: { tools: 'client', scope: 'tenant' } } },
          { id: 'old', felix: {} },
          { id: 'odd', felix: { workspace: { tools: 'sideways' } } },
        ],
      }),
    );
    const entries = await client().listManifestEntries();
    expect(entries.map((e) => [e.id, e.workspace])).toEqual([
      ['contributor', { tools: 'server', scope: 'thread' }],
      ['cowork', { tools: 'client', scope: 'tenant' }],
      ['old', undefined],
      ['odd', undefined],
    ]);
  });
});
