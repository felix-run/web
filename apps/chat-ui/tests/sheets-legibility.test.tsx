/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PRODUCT.md sets one bar for this surface that is easy to state and easy to
 * lose: **"Labels say what the thing is, not what the API field is called."**
 *
 * These pin the parts of it that regress silently — a wire key creeping back
 * into a label or a value, and six absences earning a bordered panel at the
 * same visual weight as Governance.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

const manifest = (over: Record<string, unknown> = {}) => ({
  source: 'tenant',
  version: 3,
  manifest: {
    metadata: { name: 'quick', description: 'A fast agent' },
    spec: {
      pattern: 'react',
      model: { id: 'claude-sonnet-5', temperature: 0.2, max_tokens: 4096 },
      tools: ['read_file'],
      memory: { checkpointer: 'postgres', store: 'pgvector' },
      ...over,
    },
  },
});

async function sheet(over: Record<string, unknown> = {}) {
  vi.doMock('../src/api', () => ({
    getResolvedManifest: vi.fn().mockResolvedValue(manifest(over)),
    getAgentCard: vi.fn().mockRejectedValue(new Error('no card')),
  }));
  const { AgentSheet } = await import('../src/components/agent/agent-sheet');
  render(<AgentSheet manifest="quick" />);
  await waitFor(() => expect(screen.getByText('Pattern')).toBeTruthy());
}

describe('the agent spec names things, not fields', () => {
  it.each([
    ['max_tokens', 'Reply limit'],
    ['checkpointer', 'Conversation state'],
    ['store', 'Long-term store'],
  ])('renders %s as "%s"', async (wireKey, label) => {
    await sheet();
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText(wireKey)).toBeNull();
  });

  it('glosses a session strategy rather than printing full_replay', async () => {
    await sheet({ session: { strategy: 'full_replay' } });
    expect(screen.getByText('every turn replayed')).toBeTruthy();
    expect(screen.queryByText('full_replay')).toBeNull();
  });

  it('passes an unknown strategy straight through rather than hiding it', async () => {
    // A harness that gains one should render it; silence is worse than jargon.
    await sheet({ session: { strategy: 'sliding' } });
    expect(screen.getByText('sliding')).toBeTruthy();
  });
});

describe('Connectivity is not a panel of absences', () => {
  it('says so in one line when nothing is connected', async () => {
    // Six rows of "—" spent a bordered panel, at Governance's weight, saying no.
    await sheet();
    expect(screen.getByText(/nothing outside the harness/i)).toBeTruthy();
    expect(screen.queryByText('Queues')).toBeNull();
  });

  it('lists only the connections that exist, by name', async () => {
    await sheet({ mcp_servers: [{ name: 'github' }, { name: 'linear' }] });
    expect(screen.getByText('MCP servers')).toBeTruthy();
    expect(screen.getByText('github')).toBeTruthy();
    expect(screen.getByText('linear')).toBeTruthy();
    expect(screen.queryByText('Sandboxes')).toBeNull();
    expect(screen.queryByText(/nothing outside the harness/i)).toBeNull();
  });

  /**
   * The spelling the route actually sends. `/manifests/{name}/resolved` dumps by
   * field name, so MCP servers arrive as `mcp` and peers as top-level `peers`;
   * reading only the YAML spellings told an agent that publishes through GitHub
   * MCP it reached nothing outside the harness.
   */
  it('reads the resolved spelling: mcp, top-level peers, and the tool kinds', async () => {
    await sheet({
      mcp: [{ name: 'github', url: 'https://example.invalid/mcp' }],
      peers: [{ name: 'reviewer', url: 'https://example.invalid/a2a' }],
      shell_tools: [{ name: 'run_gates' }],
      http_tools: [{ name: 'fetch_docs' }],
    });
    expect(screen.getByText('MCP servers')).toBeTruthy();
    expect(screen.getByText('github')).toBeTruthy();
    expect(screen.getByText('A2A peers')).toBeTruthy();
    expect(screen.getByText('Shell tools')).toBeTruthy();
    expect(screen.getByText('run_gates')).toBeTruthy();
    expect(screen.getByText('HTTP tools')).toBeTruthy();
    expect(screen.queryByText(/nothing outside the harness/i)).toBeNull();
  });
});

describe('governance limits read as limits', () => {
  it('names each limit and says "no limit" rather than null', async () => {
    await sheet({ limits: { max_tool_calls: 200, max_peer_hops: null, precount: false } });
    expect(screen.getByText('Tool calls')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
    expect(screen.getByText('Peer hops')).toBeTruthy();
    expect(screen.getByText('no limit')).toBeTruthy();
    expect(screen.queryByText('max_peer_hops')).toBeNull();
    expect(screen.queryByText('null')).toBeNull();
  });
});

describe('the provenance badge draws only what the route answered', () => {
  it('shows the version, and no empty pill when source is absent', async () => {
    vi.doMock('../src/api', () => ({
      getResolvedManifest: vi.fn().mockResolvedValue({ ...manifest(), source: undefined }),
      getAgentCard: vi.fn().mockRejectedValue(new Error('no card')),
    }));
    const { AgentSheet } = await import('../src/components/agent/agent-sheet');
    render(<AgentSheet manifest="quick" />);
    await waitFor(() => expect(screen.getByText('Pattern')).toBeTruthy());
    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });
});

describe('every part of the page is a heading', () => {
  it('gives each part an h3, so heading navigation reaches it', async () => {
    await sheet();
    const h3s = [...document.querySelectorAll('h3')].map((h) => h.textContent);
    expect(h3s).toEqual(
      expect.arrayContaining(['Tools & skills', 'Reaches', 'Model', 'Loop', 'Memory']),
    );
  });
});
