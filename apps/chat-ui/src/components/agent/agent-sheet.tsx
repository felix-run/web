import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { BotIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { getAgentCard, getResolvedManifest } from '@/api';
import { ErrorNotice } from '@/components/error-notice';
import {
  Fact,
  Facts,
  NameList,
  PageHeader,
  PageSection,
  Panel,
  PanelBody,
  plural,
} from '@/components/harness/panel';
import { SectionBody } from '@/components/inspector/primitives';
import type { AgentCard, AgentCardSkill, ResolvedManifest } from '@/types';

/**
 * Agent spec panel — "what is this agent". Shows the resolved manifest spec for
 * the *selected* agent and, below it, the orchestrator's A2A discovery card (the
 * peer-facing document for the default manifest). Read-only; reflects what the
 * harness compiled.
 *
 * The parts are ranked by the question an operator opens this page with — what
 * can it do, what can it reach, and what stops it — before how it is configured
 * to think. Governance used to sit fifth, below the loop pattern and the
 * temperature, at the same weight as both.
 */
export function AgentSheet({ manifest, picker }: { manifest: string; picker?: ReactNode }) {
  const [resolved, setResolved] = useState<ResolvedManifest | null>(null);
  const [card, setCard] = useState<AgentCard | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cardError, setCardError] = useState<unknown>(null);
  // The spec's own retry. The card beside it had one and the spec did not, so a
  // 429 on the page's main read left a box with nowhere to go but a reload.
  const [specTry, setSpecTry] = useState(0);

  useEffect(() => {
    // No `open` guard: a route mounts this only while it is the address, so being
    // rendered *is* being open. Left in place, `open` silently resolved to
    // `window.open` — always truthy, and a condition that reads as a gate while
    // gating nothing.
    setResolved(null);
    setError(null);
    let live = true;
    void specTry;
    getResolvedManifest(manifest)
      .then((r) => live && setResolved(r))
      .catch((e) => live && setError(e));
    // The card used to be fetched with `.catch(() => {})`, which inverted the
    // failure: a card that failed to load was silent, while a card that loaded
    // successfully crashed the app on the next render. It reports both now.
    return () => {
      live = false;
    };
  }, [manifest, specTry]);

  // Its own effect, so a failed card can be asked for again without re-reading
  // the spec — the one error on this page that offered no way to retry.
  const [cardTry, setCardTry] = useState(0);
  useEffect(() => {
    let live = true;
    setCardError(null);
    getAgentCard()
      .then((c) => live && setCard(c))
      .catch((e) => live && setCardError(e));
    return () => {
      live = false;
    };
  }, [cardTry]);

  const spec = (resolved?.manifest as ManifestLike | undefined)?.spec;
  const meta = (resolved?.manifest as ManifestLike | undefined)?.metadata;
  const reach = spec ? connections(spec) : [];
  const { bounded, defaulted } = governanceLimits(spec?.limits);
  const governed =
    asArray(spec?.approvals).length +
    asArray(spec?.guardrails?.judges).length +
    asArray(spec?.policies).length +
    bounded.length;
  const tools = asArray(spec?.tools).map(String);
  const skills = asArray(spec?.skills).map((sk) => (sk as { name?: string })?.name ?? String(sk));
  const provenance = resolved ? resolvedFrom(resolved) : null;

  return (
    <Panel>
      {/* The value is the manifest id, in mono because the harness named it —
          and it is the whole answer to "which agent is this", which the subline
          below the old title restated in a sentence. */}
      {/* The picker *is* the value: which agent this is, and the way to look at
          another. Labelled by the heading, which already says "Agent". */}
      <PageHeader
        icon={<BotIcon />}
        title="Agent"
        headingId="agent-page-heading"
        value={picker ? undefined : manifest}
        valueMono
        controls={picker}
      />

      <PanelBody>
        {/* The same loading and failure grammar as every section page, rather
            than a bare "Loading…" line only this page drew. */}
        <SectionBody
          loading={!resolved && error == null}
          error={error}
          doing="load the agent spec"
          onRetry={() => setSpecTry((n) => n + 1)}
          emptyText=""
        >
          {resolved && spec && (
            <>
              {(provenance || meta?.version || meta?.description) && (
                <div className="mb-5 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    {/* Only what the harness answered. This drew `resolved.source`,
                        a field the route has never sent, so every visit opened on
                        an empty pill. */}
                    {provenance && (
                      <Badge variant="secondary" className="font-mono">
                        {provenance}
                      </Badge>
                    )}
                    {meta?.version && (
                      <span className="text-muted-foreground">spec {meta.version}</span>
                    )}
                  </div>
                  {meta?.description && (
                    <p className="text-sm text-muted-foreground">{meta.description}</p>
                  )}
                </div>
              )}

              {/* One line when there are neither, as Reaches has it: a router that
                  only dispatches spent two rows of dashes here, first on the page. */}
              <PageSection
                title="Tools & skills"
                meta={tools.length === 0 && skills.length === 0 ? 'none declared' : undefined}
              >
                {(tools.length > 0 || skills.length > 0) && (
                  <Facts>
                    <Fact label="Tools" absent="none">
                      {tools.length > 0 ? <Chips items={tools} /> : null}
                    </Fact>
                    <Fact label="Skills" absent="none">
                      {skills.length > 0 ? <Chips items={skills} /> : null}
                    </Fact>
                  </Facts>
                )}
              </PageSection>

              {/*
                  Only the connections that exist, and one line when none do. On a
                  typical manifest every one of these was `—`, which spent a panel
                  saying "no" row by row.

                  It also said "no" when the answer was yes. The resolved manifest
                  is serialised by field name, so MCP servers arrive as `mcp` and
                  peers as top-level `peers` — this read `mcp_servers` and
                  `a2a.peers`, the YAML spellings, and told an agent publishing
                  through GitHub MCP that it reached nothing outside the harness.
                  Six more kinds of tool (shell, HTTP, search, document search,
                  client, sub-agent) were never read at all.
                */}
              <PageSection
                title="Reaches"
                meta={reach.length === 0 ? 'nothing outside the harness' : undefined}
              >
                {reach.length > 0 ? (
                  <Facts>
                    {reach.map(({ label, names }) => (
                      <Fact key={label} label={label}>
                        <Chips items={names} />
                      </Fact>
                    ))}
                  </Facts>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No MCP servers, peers, sub-agents, containers, queues, sandboxes, or shell,
                    browser, HTTP, search, document or client tools.
                  </p>
                )}
              </PageSection>

              {/* Always drawn: every run is bounded by limits, declared or not. */}
              <PageSection
                title="Governance"
                // The limits the manifest left unset are named once, at the
                // heading, rather than as rows. They are *not* unlimited: the
                // harness fills every unset limit from its own defaults
                // (`effective_limits`), and this read "no limit on tool calls,
                // wall clock, …" for a run capped at all six. No number, because
                // no route reports the defaults and a copied one would drift.
                meta={
                  defaulted.length === 0
                    ? undefined
                    : defaulted.length === LIMIT_KEYS.length
                      ? 'every limit at the harness default'
                      : `harness default for ${defaulted.join(', ')}`
                }
              >
                {governed > 0 && (
                  <Facts>
                    {asArray(spec.approvals).map((a, i) => {
                      const ap = a as { id?: string; tools?: string[] };
                      return (
                        // static read-only manifest list, never reordered
                        <Fact
                          key={`appr-${i}`}
                          label={
                            <>
                              Approval <span className="font-mono">{ap.id ?? i}</span>
                            </>
                          }
                        >
                          {asArray(ap.tools).length > 0 ? (
                            <Chips items={asArray(ap.tools).map(String)} />
                          ) : null}
                        </Fact>
                      );
                    })}
                    {asArray(spec.guardrails?.judges).map((j, i) => {
                      const judge = j as { name?: string; threshold?: number };
                      return (
                        // static read-only manifest list, never reordered
                        <Fact
                          key={`judge-${i}`}
                          label={
                            <>
                              Judge <span className="font-mono">{judge.name ?? i}</span>
                            </>
                          }
                        >
                          {`passes at ≥ ${judge.threshold ?? '—'}`}
                        </Fact>
                      );
                    })}
                    {asArray(spec.policies).map((p, i) => {
                      const pol = p as { id?: string };
                      return (
                        // static read-only manifest list, never reordered
                        <Fact key={`pol-${i}`} label="Policy" mono>
                          {pol.id ?? String(i)}
                        </Fact>
                      );
                    })}
                    {/* Only the limits that bound something get a row; the rest
                        are named once, in the heading's value. */}
                    {bounded.map(({ key, label, value, mono }) => (
                      <Fact key={`lim-${key}`} label={label} mono={mono}>
                        {value}
                      </Fact>
                    ))}
                  </Facts>
                )}
              </PageSection>

              <PageSection title="Model">
                <Facts>
                  {/* `id` is optional in the schema: unset, the harness routes to its
                      configured default, which a bare dash did not say. */}
                  <Fact label="Model" mono absent="harness default">
                    {modelField(spec.model, 'id')}
                  </Fact>
                  <Fact label="Temperature" mono>
                    {modelField(spec.model, 'temperature')}
                  </Fact>
                  <Fact label="Reply limit" mono absent="not set">
                    {modelField(spec.model, 'max_tokens')}
                  </Fact>
                  {asArray(spec.model?.fallbacks).length > 0 && (
                    <Fact label="Falls back to">
                      <Chips items={asArray(spec.model?.fallbacks).map(String)} />
                    </Fact>
                  )}
                  {spec.model?.cache ? <Fact label="Prompt cache">on</Fact> : null}
                  {spec.model?.thinking_budget ? (
                    <Fact label="Thinking budget" mono>
                      {`${String(spec.model.thinking_budget)} tok`}
                    </Fact>
                  ) : null}
                </Facts>
              </PageSection>

              <PageSection title="Loop">
                <Facts>
                  <Fact label="Pattern" mono>
                    {spec.pattern}
                  </Fact>
                  <Fact label="Runs">{runsAs(spec.execution?.mode)}</Fact>
                  <Fact label="History">{historyAs(spec.session?.strategy)}</Fact>
                </Facts>
              </PageSection>

              <PageSection title="Memory">
                <Facts>
                  <Fact label="Conversation state" mono absent="none">
                    {spec.memory?.checkpointer}
                  </Fact>
                  <Fact label="Long-term store" mono absent="none">
                    {spec.memory?.store}
                  </Fact>
                </Facts>
              </PageSection>

              <PageSection title="Inbound auth">
                <Facts>
                  <Fact label="Anonymous callers">
                    {spec.auth?.inbound?.allow_anonymous ? 'allowed' : 'denied'}
                  </Fact>
                  {asArray(spec.auth?.inbound?.required_scopes).length > 0 && (
                    <Fact label="Required scopes">
                      <Chips items={asArray(spec.auth?.inbound?.required_scopes).map(String)} />
                    </Fact>
                  )}
                </Facts>
              </PageSection>
            </>
          )}
        </SectionBody>

        {/* Outside the spec's body on purpose: the card is a second request, and
            a spec that failed to load is no reason to hide one that did. */}
        {(card || cardError != null) && (
          <PageSection
            title="A2A discovery card"
            // Said once: when the sentence below names the default agent, a note
            // here saying the same thing is the second of two.
            meta={
              card && !card.error && (!card.name || card.name === manifest)
                ? 'published for the default agent'
                : undefined
            }
          >
            {/* The card is the *default* agent's, which need not be the one this
                  page describes — say so where the two names would otherwise sit
                  side by side and read as a contradiction. */}
            {card && !card.error && card.name && card.name !== manifest && (
              <p className="mb-2 text-sm text-muted-foreground">
                Peers discover <span className="font-mono">{card.name}</span>, the default agent,
                not <span className="font-mono">{manifest}</span>.
              </p>
            )}
            {card && !card.error && (
              <Facts>
                <Fact label="Name" mono>
                  {card.name}
                </Fact>
                <Fact label="Version" mono>
                  {card.version}
                </Fact>
                <Fact label="URL" mono>
                  {card.url}
                </Fact>
                <Fact label="Capabilities">
                  {capabilityChips(card.capabilities).length > 0 ? (
                    <Chips items={capabilityChips(card.capabilities)} />
                  ) : null}
                </Fact>
                <Fact label="Skills">
                  {skillChips(card.skills).length > 0 ? (
                    <Chips items={skillChips(card.skills)} />
                  ) : null}
                </Fact>
                {card.transparencyNotice && <Fact label="Transparency">disclosed to peers</Fact>}
              </Facts>
            )}
            {/*
                  The route answers 200 with `{error, name}` when the default manifest is
                  missing, and 404 when the agent has `spec.a2a.publish` unset. Neither is
                  a fault in this panel, and both are worth saying out loud: an operator
                  looking for the discovery card wants to know it is deliberately absent.
                */}
            {card?.error && (
              <p className="text-sm text-muted-foreground">
                Not published: <span className="font-mono">{card.error}</span>
              </p>
            )}
            {cardError != null && (
              <ErrorNotice
                error={cardError}
                doing="load the discovery card"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-start text-xs"
                    onClick={() => setCardTry((n) => n + 1)}
                  >
                    Try again
                  </Button>
                }
              />
            )}
          </PageSection>
        )}
      </PanelBody>
    </Panel>
  );
}

// --- helpers ---

interface ManifestLike {
  metadata?: { name?: string; version?: string; description?: string };
  spec?: {
    pattern?: string;
    model?: Record<string, unknown>;
    tools?: unknown[];
    skills?: unknown[];
    memory?: { checkpointer?: string; store?: string };
    session?: { strategy?: string };
    guardrails?: { judges?: unknown[]; providers?: string[] };
    approvals?: unknown[];
    policies?: unknown[];
    limits?: Record<string, unknown>;
    auth?: {
      inbound?: { allow_anonymous?: boolean; required_scopes?: string[]; schemes?: string[] };
    };
    execution?: { mode?: string };
  } & Connectable;
}

/**
 * The connection fields, as the resolved manifest carries them.
 *
 * `GET /manifests/{name}/resolved` serialises with `model_dump(mode="json")`,
 * which writes field *names*, not aliases: MCP servers are `mcp` there, though a
 * YAML manifest may spell them `mcp_servers`, and peers are top-level. Both
 * spellings are read, because a stored-version read returns the manifest as it
 * was written and so may carry the alias.
 */
interface Connectable {
  mcp?: unknown[];
  mcp_servers?: unknown[];
  peers?: unknown[];
  a2a?: { peers?: unknown[] };
  sub_agents?: unknown[];
  containers?: unknown[];
  queues?: unknown[];
  sandboxes?: unknown[];
  shell_tools?: unknown[];
  browser_tools?: unknown[];
  http_tools?: unknown[];
  search_tools?: unknown[];
  document_tools?: unknown[];
  client_tools?: unknown[];
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Capability chips from the card's `capabilities` object: the two transport flags
 * the harness always sets, then whatever the manifest declared on top of them.
 */
function capabilityChips(caps: AgentCard['capabilities']): string[] {
  if (!caps) return [];
  const chips: string[] = [];
  if (caps.streaming) chips.push('streaming');
  if (caps.mcp) chips.push('mcp');
  for (const cap of asArray(caps.declared)) {
    const id = (cap as { id?: unknown })?.id;
    if (typeof id === 'string' && id) chips.push(id);
  }
  return chips;
}

function skillChips(skills: AgentCard['skills']): string[] {
  return asArray(skills)
    .map((s) => {
      const skill = s as AgentCardSkill;
      return skill?.name ?? skill?.id;
    })
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

function modelField(
  model: Record<string, unknown> | undefined,
  key: string,
): string | number | undefined {
  const v = model?.[key];
  return typeof v === 'string' || typeof v === 'number' ? v : undefined;
}

/** The connections this manifest actually has, by name, so absences do not fill a panel. */
function connections(spec: Connectable): Array<{ label: string; names: string[] }> {
  const all: Array<[string, unknown]> = [
    ['MCP servers', spec.mcp ?? spec.mcp_servers],
    ['A2A peers', spec.peers ?? spec.a2a?.peers],
    ['Sub-agents', spec.sub_agents],
    ['Containers', spec.containers],
    ['Queues', spec.queues],
    ['Sandboxes', spec.sandboxes],
    ['Shell tools', spec.shell_tools],
    ['Browser tools', spec.browser_tools],
    ['HTTP tools', spec.http_tools],
    ['Search tools', spec.search_tools],
    ['Document tools', spec.document_tools],
    ['Client tools', spec.client_tools],
  ];
  return all
    .map(([label, v]) => ({
      label,
      names: asArray(v).map((ref, i) =>
        typeof ref === 'string' ? ref : ((ref as { name?: string })?.name ?? `#${i + 1}`),
      ),
    }))
    .filter(({ names }) => names.length > 0);
}

/**
 * Where the resolved manifest came from, as far as the route says.
 *
 * The route answers `version` (a stored tenant version, or `null` for a file or
 * a bundled manifest) and `variant` (`canary` when this thread hashed onto the
 * rollout). `source` is read when present — the type allows it — but no harness
 * sends it today, which is why this is not simply that field.
 */
function resolvedFrom(r: ResolvedManifest): string | null {
  const parts = [
    r.source ?? null,
    r.version != null ? `v${r.version}` : null,
    r.variant === 'canary' ? 'canary' : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The run budgets the harness fills from its defaults when a manifest leaves them unset. */
const LIMIT_KEYS = [
  'max_tool_calls',
  'max_wall_clock_seconds',
  'max_peer_hops',
  'max_input_tokens',
  'max_output_tokens',
  'max_cost_usd',
] as const;

/**
 * The declared limits as rows, and the unset budgets by name.
 *
 * Every budget in `LIMIT_KEYS` is read whether or not the manifest mentions it,
 * since an absent key is defaulted exactly as a `null` one is. `precount` is a
 * switch rather than a bound, so it is a row only when on — off is the default
 * and bounds nothing. Unknown keys pass through when set.
 */
function governanceLimits(limits: Record<string, unknown> | undefined): {
  bounded: Array<{ key: string; label: string; value: string; mono: boolean }>;
  defaulted: string[];
} {
  const declared = limits ?? {};
  const isSet = (v: unknown) => v !== null && v !== undefined;
  const budgets = (LIMIT_KEYS as readonly string[]).map((key) => ({
    key,
    set: isSet(declared[key]),
    ...limitAs(key, declared[key]),
  }));
  const others = Object.entries(declared)
    .filter(([key, v]) => !(LIMIT_KEYS as readonly string[]).includes(key) && isSet(v))
    .filter(([key, v]) => !(key === 'precount' && v === false))
    .map(([key, v]) => ({ key, set: true, ...limitAs(key, v) }));
  return {
    bounded: [...budgets.filter((b) => b.set), ...others],
    defaulted: budgets.filter((b) => !b.set).map((b) => b.label.toLowerCase()),
  };
}

/**
 * A governance limit, as a label and a reading rather than a schema key.
 *
 * `max_peer_hops null` in a Governance panel is the field name and the JSON
 * value, and it reads as "the peer-hop limit is broken" when it means there is
 * none. Unknown keys pass through as they came: a harness that gains a limit
 * should render it, not hide it.
 */
export function limitAs(
  key: string,
  value: unknown,
): { label: string; value: string; mono: boolean } {
  const labels: Record<string, string> = {
    max_tool_calls: 'Tool calls',
    max_wall_clock_seconds: 'Wall clock',
    max_peer_hops: 'Peer hops',
    max_input_tokens: 'Input tokens',
    max_output_tokens: 'Output tokens',
    max_cost_usd: 'Spend',
    precount: 'Count tokens first',
  };
  const label = labels[key] ?? key;
  if (value === null || value === undefined) {
    return { label, value: 'harness default', mono: false };
  }
  if (typeof value === 'boolean') return { label, value: value ? 'yes' : 'no', mono: false };
  if (typeof value === 'number') {
    if (key === 'max_wall_clock_seconds') return { label, value: `${value}s`, mono: true };
    if (key === 'max_cost_usd') return { label, value: `$${value}`, mono: true };
    return { label, value: value.toLocaleString(), mono: true };
  }
  return { label, value: String(value), mono: true };
}

/**
 * Values are wire spellings too.
 *
 * PRODUCT.md asks that labels say what the thing is rather than what the API
 * field is called, and `full_replay` in the value column fails that as squarely
 * as `max_tokens` did in the label column. Unknown strategies fall through
 * unchanged: a harness that gains one should render it, not hide it.
 */
function historyAs(strategy: string | undefined): string {
  // The harness's own spellings (`session/strategies.py`): a name, and for most a
  // `:N` count. This matched `summarize` and `window`, which it has never
  // accepted, so every non-default strategy reached the page as its wire text.
  const raw = (strategy ?? 'full_replay').trim();
  const [name, arg] = raw.split(':', 2);
  const n = arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined;
  if (raw === 'full_replay') return 'every turn replayed';
  if (name === 'windowed' && n) return `last ${plural(n, 'turn')} only`;
  // `summarizing:N` is compaction with a turn floor; the harness upgrades it.
  if (name === 'summarizing' && n)
    return `compacted near the window, last ${plural(n, 'turn')} kept`;
  if (name === 'compacting' && arg === undefined) return 'compacted near the window';
  if (name === 'compacting' && n)
    return `compacted near the window, last ${plural(n, 'turn')} kept`;
  if (name === 'semantic' && n) return `the ${plural(n, 'most relevant turn')}`;
  return raw;
}

function runsAs(mode: string | undefined): string {
  switch (mode ?? 'transient') {
    case 'transient':
      return 'in the request';
    case 'durable':
      return 'in the background';
    default:
      return mode ?? 'transient';
  }
}

/** The shared list, under the name this file already uses at every call site. */
function Chips({ items }: { items: string[] }) {
  return <NameList names={items} />;
}
