/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArtifactMarker } from '../src/types';

/**
 * An oversized tool result is spilled to the object store and replaced with a
 * preview plus a reference:
 *
 *   …[artifact:<32 hex> key=artifacts/<tenant>/<manifest>/<id>.txt chars=N spilled_at=T]
 *
 * Until something reads that marker, the transcript shows the preview and the
 * marker itself — the rest of the output is stored, addressed, and unreachable.
 * These cover the reading of it, and the one thing the parser must refuse: a
 * reference that is not what it looks like, which would otherwise be built into
 * a URL and sent.
 */

const ID = 'a'.repeat(32);
const marker = (opts: { id?: string; key?: string; chars?: number } = {}) =>
  `[artifact:${opts.id ?? ID} key=${opts.key ?? `artifacts/acme/quick/${opts.id ?? ID}.txt`} ` +
  `chars=${opts.chars ?? 40000} spilled_at=1756000000]`;

afterEach(cleanup);

/**
 * The component is imported dynamically so each test gets the mock it declared.
 * Without the reset the second import is served from cache — still closed over
 * the *first* test's `getArtifact` — and a test asserting a failure quietly
 * asserts the previous success instead.
 */
beforeEach(() => {
  vi.resetModules();
});

describe('parseArtifactMarker', () => {
  it('reads the reference the harness writes', () => {
    const parsed = parseArtifactMarker(`the first part\n\n…${marker()}`);
    expect(parsed).toMatchObject({
      artifactId: ID,
      manifestId: 'quick',
      chars: 40000,
      spilledAt: 1756000000,
      preview: 'the first part',
    });
  });

  it('says nothing about output that was never spilled', () => {
    expect(parseArtifactMarker('a perfectly ordinary result')).toBeNull();
    expect(parseArtifactMarker('')).toBeNull();
  });

  /**
   * The marker is written at the end. One quoted mid-text is a tool talking
   * about an artifact, not a tool whose output was replaced by one — and
   * fetching on the strength of it would be acting on tool output.
   */
  it('ignores a marker that is not where the harness puts it', () => {
    expect(parseArtifactMarker(`${marker()} and then more output`)).toBeNull();
  });

  it('refuses an id that is not an id', () => {
    expect(parseArtifactMarker(`x\n\n…${marker({ id: 'nope' })}`)).toBeNull();
  });

  /** The manifest is the one key segment a caller may name, so it is checked. */
  it('refuses a key that does not name a manifest', () => {
    expect(parseArtifactMarker(`x\n\n…${marker({ key: `artifacts/acme/${ID}.txt` })}`)).toBeNull();
    expect(
      parseArtifactMarker(`x\n\n…${marker({ key: `artifacts/acme/../${ID}.txt` })}`),
    ).toBeNull();
  });

  it('survives a marker written without the timestamp', () => {
    const parsed = parseArtifactMarker(
      `head\n\n…[artifact:${ID} key=artifacts/acme/quick/${ID}.txt chars=12]`,
    );
    expect(parsed?.chars).toBe(12);
    expect(parsed?.spilledAt).toBe(0);
  });

  /** JSON-shaped output carries the same marker through `JSON.stringify`. */
  it('reads a marker out of a serialised object', () => {
    const rendered = JSON.stringify({ content: `head\n\n…${marker()}` }, null, 2);
    expect(parseArtifactMarker(rendered)).toBeNull();
    expect(parseArtifactMarker(rendered.replace(/"\n?\}$/, ''))).not.toBeNull();
  });
});

describe('the tool card for a spilled output', () => {
  it('offers the rest of the output, and shows it once fetched', async () => {
    const getArtifact = vi.fn().mockResolvedValue({
      artifact_id: ID,
      manifest_id: 'quick',
      chars: 40000,
      content: 'the whole enormous thing',
    });
    vi.doMock('../src/api', () => ({ getArtifact }));
    const { Tool } = await import('../src/components/chat/tool');

    render(
      <Tool
        tool={{
          name: 'read_file',
          done: true,
          output: `the first part\n\n…${marker()}`,
        }}
        verbose
      />,
    );

    expect(screen.getByText(/the first part/)).toBeTruthy();
    // The marker itself is chrome, not output.
    expect(screen.queryByText(/\[artifact:/)).toBeNull();
    expect(screen.getByText(/40,000 chars/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /show full output/i }));
    await waitFor(() => expect(screen.getByText('the whole enormous thing')).toBeTruthy());
    expect(getArtifact).toHaveBeenCalledWith('quick', ID);
    vi.doUnmock('../src/api');
  });

  it('says why when the key cannot read artifacts', async () => {
    vi.doMock('../src/api', () => ({
      getArtifact: vi.fn().mockRejectedValue(new Error('artifact: 403 forbidden')),
    }));
    const { Tool } = await import('../src/components/chat/tool');

    render(
      <Tool tool={{ name: 'read_file', done: true, output: `head\n\n…${marker()}` }} verbose />,
    );
    fireEvent.click(screen.getByRole('button', { name: /show full output/i }));
    // `describeError` turns a 403 into the operator-facing sentence about scope.
    await waitFor(() => expect(screen.getByText(/broader scope/i)).toBeTruthy());
    vi.doUnmock('../src/api');
  });
});
