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
  render(<AgentSheet open onOpenChange={() => {}} manifest="quick" />);
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
    expect(screen.getByText(/Nothing outside the harness/)).toBeTruthy();
    expect(screen.queryByText('Queues')).toBeNull();
  });

  it('lists only the connections that exist', async () => {
    await sheet({ mcp_servers: [{ id: 'a' }, { id: 'b' }] });
    expect(screen.getByText('MCP servers')).toBeTruthy();
    expect(screen.queryByText('Sandboxes')).toBeNull();
    expect(screen.queryByText(/Nothing outside the harness/)).toBeNull();
  });
});
