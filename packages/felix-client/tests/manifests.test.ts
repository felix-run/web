import { describe, expect, it } from 'vitest';
import { createFelixClient } from '../src/transport';

/**
 * `GET /v1/models` as the agent picker reads it.
 *
 * The route has always sent a `felix` block per manifest, and `listManifests`
 * kept only `id` — so the picker offered eleven bare names when the harness had
 * already said which provider model each one runs on. `listManifestEntries`
 * keeps that; `listManifests` stays names-only for the callers that want no
 * more (the terminal's `/manifest`).
 */

function serve(body: unknown) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return {
    urls,
    client: createFelixClient({ baseUrl: 'http://localhost:8080', headers: () => ({}), fetch }),
  };
}

// Shapes as `felix/usage/catalog.py:catalog_from_manifest` builds them.
const MODELS = {
  object: 'list',
  data: [
    {
      id: 'cowork',
      object: 'model',
      felix: { providerModel: 'claude-sonnet-4-5', contextWindow: 200000 },
    },
    // `providerModel: null` is the harness saying "same as the name".
    { id: 'claude-opus-4', object: 'model', felix: { providerModel: null, contextWindow: 0 } },
    // An older harness, or anything else OpenAI-shaped: no `felix` block at all.
    { id: 'plain', object: 'model' },
  ],
};

describe('starters', () => {
  it("keeps the manifest's own starters, drops malformed ones, and tells none from unknown", async () => {
    const { client } = serve({
      object: 'list',
      data: [
        {
          id: 'cowork',
          felix: {
            starters: [
              { title: 'List files', prompt: 'List the top-level files.' },
              { title: '', prompt: 'no title' },
              { title: 'no prompt' },
              'not an object',
            ],
          },
        },
        // A harness that lists starters, for a manifest that declares none.
        { id: 'router', felix: { starters: [] } },
        // A harness older than the key.
        { id: 'quick', felix: {} },
      ],
    });
    expect(await client.listManifestEntries()).toEqual([
      { id: 'cowork', starters: [{ title: 'List files', prompt: 'List the top-level files.' }] },
      { id: 'router', starters: [] },
      { id: 'quick' },
    ]);
  });
});

describe('commands', () => {
  it("keeps the manifest's typeable commands and tells none from unknown", async () => {
    const { client } = serve({
      object: 'list',
      data: [
        {
          id: 'cowork',
          felix: {
            commands: [
              { name: 'review', description: 'Review a file', argumentHint: '<file>' },
              { name: 'fix', description: null, argumentHint: null },
              { name: 'two words' },
              { name: '/etc' },
              { description: 'no name' },
              'not an object',
            ],
          },
        },
        { id: 'router', felix: { commands: [] } },
        { id: 'quick', felix: {} },
      ],
    });
    expect(await client.listManifestEntries()).toEqual([
      {
        id: 'cowork',
        commands: [
          { name: 'review', description: 'Review a file', argumentHint: '<file>' },
          { name: 'fix' },
        ],
      },
      { id: 'router', commands: [] },
      { id: 'quick' },
    ]);
  });
});

describe('output styles', () => {
  it("keeps the agent's styles and a default it declares, and tells none from unknown", async () => {
    const { client } = serve({
      object: 'list',
      data: [
        {
          id: 'cowork',
          felix: {
            outputStyles: [
              { name: 'terse', description: 'Short answers' },
              { name: 'teacher', description: null },
              { name: 'two words' },
              { description: 'no name' },
            ],
            defaultOutputStyle: 'terse',
          },
        },
        // A default naming no style it lists is not offered as one.
        { id: 'quick', felix: { outputStyles: [{ name: 'plain' }], defaultOutputStyle: 'gone' } },
        { id: 'router', felix: { outputStyles: [], defaultOutputStyle: null } },
        { id: 'old', felix: {} },
      ],
    });
    expect(await client.listManifestEntries()).toEqual([
      {
        id: 'cowork',
        outputStyles: [{ name: 'terse', description: 'Short answers' }, { name: 'teacher' }],
        defaultOutputStyle: 'terse',
      },
      { id: 'quick', outputStyles: [{ name: 'plain' }] },
      { id: 'router', outputStyles: [] },
      { id: 'old' },
    ]);
  });

  it('sets one through POST /chat/style, checked against the agent, and clears it with null', async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
      sent.push({ url: String(input), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const client = createFelixClient({ baseUrl: '/api', headers: () => ({}), fetch });
    await client.setOutputStyle({ threadId: 't1', manifest: 'cowork', style: 'terse' });
    await client.setOutputStyle({ threadId: 't1', manifest: 'cowork', style: null });
    expect(sent).toEqual([
      { url: '/api/chat/style', body: { thread_id: 't1', manifest: 'cowork', style: 'terse' } },
      { url: '/api/chat/style', body: { thread_id: 't1', manifest: 'cowork', style: null } },
    ]);
  });
});

describe('listManifestEntries', () => {
  it('keeps the provider model where it differs from the name, in the harness order', async () => {
    const { client, urls } = serve(MODELS);
    expect(await client.listManifestEntries()).toEqual([
      { id: 'cowork', providerModel: 'claude-sonnet-4-5', contextWindow: 200000 },
      { id: 'claude-opus-4' },
      { id: 'plain' },
    ]);
    expect(urls).toEqual(['http://localhost:8080/v1/models']);
  });

  it('leaves listManifests returning names only, for the callers that want no more', async () => {
    const { client } = serve(MODELS);
    expect(await client.listManifests()).toEqual(['cowork', 'claude-opus-4', 'plain']);
  });

  it('still lists names when called detached from the client', async () => {
    // chat-ui binds these, but a caller that destructures must not lose `this`.
    const { client } = serve(MODELS);
    const { listManifests } = client;
    expect(await listManifests()).toEqual(['cowork', 'claude-opus-4', 'plain']);
  });
});

describe('greeting', () => {
  it('keeps a well-formed greeting and drops anything else', async () => {
    const { client } = serve({
      object: 'list',
      data: [
        { id: 'a', felix: { greeting: { headline: 'Hi', subtitle: 'One line.' } } },
        { id: 'b', felix: { greeting: { headline: 'Hi', subtitle: null } } },
        { id: 'c', felix: { greeting: null } },
        { id: 'd', felix: { greeting: { subtitle: 'no headline' } } },
        { id: 'e', felix: {} },
      ],
    });
    expect(await client.listManifestEntries()).toEqual([
      { id: 'a', greeting: { headline: 'Hi', subtitle: 'One line.' } },
      { id: 'b', greeting: { headline: 'Hi' } },
      { id: 'c' },
      { id: 'd' },
      { id: 'e' },
    ]);
  });
});
