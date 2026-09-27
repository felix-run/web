/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
  it('names each limit, and says which are unset at the heading rather than as rows', async () => {
    await sheet({
      limits: { max_tool_calls: 200, max_peer_hops: null, max_cost_usd: null, precount: false },
    });
    expect(screen.getByText('Tool calls')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
    // The limits nobody set are the ones an operator acts on: named once, up top.
    expect(screen.getByText('no limit on peer hops, spend')).toBeTruthy();
    expect(screen.queryByText('Peer hops')).toBeNull();
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

describe('Skills before the agent has been asked', () => {
  it('shows what the manifest declares, says what is unknown, and links rather than writes', async () => {
    const { SkillsSection } = await import('../src/components/harness/skills');
    const { PanelModeProvider } = await import('../src/components/inspector/primitives');
    render(
      <MemoryRouter>
        <PanelModeProvider>
          <SkillsSection
            open
            onToggle={() => {}}
            skills={null}
            specSkills={['calculator-help']}
            agent="cowork"
            thread={{
              text: '72d69cb1-1ea6-4d6f-949b-fcfd326bccdf',
              isId: true,
              to: '/t/72d69cb1-1ea6-4d6f-949b-fcfd326bccdf',
            }}
          />
        </PanelModeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('1 declared')).toBeTruthy();
    expect(screen.getByText('calculator-help')).toBeTruthy();
    expect(screen.getByText(/unknown until the agent calls/)).toBeTruthy();
    // A link to the conversation, not a button that posts into it from here.
    const link = screen.getByRole('link', { name: /untitled thread/ });
    expect(link.getAttribute('href')).toBe('/t/72d69cb1-1ea6-4d6f-949b-fcfd326bccdf');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('72d69cb1-1ea6-4d6f-949b-fcfd326bccdf')).toBeNull();
  });

  it("does not show a thread's active list for an agent that is not the chat's", async () => {
    const { SkillsSection } = await import('../src/components/harness/skills');
    const { PanelModeProvider } = await import('../src/components/inspector/primitives');
    render(
      <MemoryRouter>
        <PanelModeProvider>
          <SkillsSection
            open
            onToggle={() => {}}
            skills={null}
            specSkills={['deep-research']}
            agent="deep"
            isChatAgent={false}
          />
        </PanelModeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText(/only known for the agent Chat is talking to/)).toBeTruthy();
    expect(screen.getByText('deep-research')).toBeTruthy();
  });
});

describe('Skills when the spec cannot be read', () => {
  it('says so and offers a retry, rather than looking like a manifest that declares nothing', async () => {
    const { SkillsSection } = await import('../src/components/harness/skills');
    const { PanelModeProvider } = await import('../src/components/inspector/primitives');
    const retry = vi.fn();
    render(
      <MemoryRouter>
        <PanelModeProvider>
          <SkillsSection
            open
            onToggle={() => {}}
            skills={null}
            agent="contributor"
            isChatAgent={false}
            specError={new Error('manifests /contributor: 429 {"error":"rate_limited"}')}
            onRetrySpec={retry}
          />
        </PanelModeProvider>
      </MemoryRouter>,
    );
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('a failed poll keeps what it last knew', () => {
  it('draws the last good rows under one line, not an error box in their place', async () => {
    const { SectionBody } = await import('../src/components/inspector/primitives');
    render(
      <SectionBody
        loading={false}
        error={new Error('memory: 429')}
        doing="read stored memory"
        empty={false}
        emptyText="none"
        lastOkAt={Date.now() - 120_000}
        onRetry={() => {}}
      >
        <p>a fact</p>
      </SectionBody>,
    );
    expect(screen.getByText('a fact')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Showing what it said/);
  });

  it('ages a header value whose latest read failed', async () => {
    const { withAge } = await import('../src/components/inspector/primitives');
    expect(withAge('0 documents', Date.now() - 120_000)).toMatch(/^0 documents · as of /);
    expect(withAge('0 documents', undefined)).toBe('0 documents');
  });
});

describe('Skills tells loading from none, and names only a real thread', () => {
  it('says it is reading while the spec is in flight', async () => {
    const { SkillsSection } = await import('../src/components/harness/skills');
    const { PanelModeProvider } = await import('../src/components/inspector/primitives');
    render(
      <MemoryRouter>
        <PanelModeProvider>
          <SkillsSection open onToggle={() => {}} skills={null} agent="cowork" />
        </PanelModeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Reading the manifest…')).toBeTruthy();
  });

  it('reads "None" for a manifest that declares no skills', async () => {
    const { SkillsSection } = await import('../src/components/harness/skills');
    const { PanelModeProvider } = await import('../src/components/inspector/primitives');
    render(
      <MemoryRouter>
        <PanelModeProvider>
          <SkillsSection open onToggle={() => {}} skills={null} specSkills={[]} agent="cowork" />
        </PanelModeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('0 declared')).toBeTruthy();
    expect(screen.getByText('None')).toBeTruthy();
    expect(screen.queryByText('Reading the manifest…')).toBeNull();
  });

  it('offers Chat, not a made-up thread, when the thread is not one the index knows', async () => {
    const { SkillsSection } = await import('../src/components/harness/skills');
    const { PanelModeProvider } = await import('../src/components/inspector/primitives');
    render(
      <MemoryRouter>
        <PanelModeProvider>
          <SkillsSection
            open
            onToggle={() => {}}
            skills={null}
            specSkills={['a']}
            agent="cowork"
            chatTo="/t/fresh"
          />
        </PanelModeProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText(/untitled thread/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Ask it in Chat' }).getAttribute('href')).toBe(
      '/t/fresh',
    );
  });
});
