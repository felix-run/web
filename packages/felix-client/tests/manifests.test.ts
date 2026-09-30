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
