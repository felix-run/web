import { Badge } from '@felix/ui/badge';
import { ScrollArea } from '@felix/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@felix/ui/sheet';
import { BotIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAgentCard, getResolvedManifest } from '@/api';
import { ErrorNotice } from '@/components/error-notice';
import type { AgentCard, AgentCardSkill, ResolvedManifest } from '@/types';

/**
 * Agent spec panel — "what is this agent". Shows the resolved manifest spec for
 * the *selected* agent (pattern, model, tools, skills, memory, governance) and,
 * below it, the orchestrator's A2A discovery card (the peer-facing document for
 * the default manifest). Read-only; reflects what the harness compiled.
 */
export function AgentSheet({
  open,
  onOpenChange,
  manifest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifest: string;
}) {
  const [resolved, setResolved] = useState<ResolvedManifest | null>(null);
  const [card, setCard] = useState<AgentCard | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cardError, setCardError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setResolved(null);
    setCard(null);
    setError(null);
    setCardError(null);
    let live = true;
    getResolvedManifest(manifest)
      .then((r) => live && setResolved(r))
      .catch((e) => live && setError(e));
    // The card used to be fetched with `.catch(() => {})`, which inverted the
    // failure: a card that failed to load was silent, while a card that loaded
    // successfully crashed the app on the next render. It reports both now.
    getAgentCard()
      .then((c) => live && setCard(c))
      .catch((e) => live && setCardError(e));
    return () => {
      live = false;
    };
  }, [open, manifest]);

  const spec = (resolved?.manifest as ManifestLike | undefined)?.spec;
  const meta = (resolved?.manifest as ManifestLike | undefined)?.metadata;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <BotIcon className="size-4" /> Agent spec
            <span className="font-mono text-xs text-muted-foreground">{manifest}</span>
          </SheetTitle>
          <SheetDescription>
            The resolved manifest the harness compiled for the selected agent.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          {/* The spec rows are rows, not captions. This container set `text-xs` so the
              whole panel — every label, value and description — inherited the 11px
              caption step and nothing ranked. Section headings and badges stay at xs. */}
          <div className="space-y-4 p-4 text-sm">
            {error != null && <ErrorNotice error={error} doing="load the agent spec" />}
            {!resolved && !error && <p className="text-muted-foreground">Loading…</p>}

            {resolved && spec && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="font-mono">
                    {resolved.source}
                    {resolved.version != null ? ` v${resolved.version}` : ''}
                  </Badge>
                  {meta?.version && (
                    <span className="text-muted-foreground">spec {meta.version}</span>
                  )}
                </div>
                {meta?.description && <p className="text-muted-foreground">{meta.description}</p>}

                <Section title="Loop">
                  <Row label="pattern" value={spec.pattern} />
                  <Row label="execution" value={spec.execution?.mode ?? 'transient'} />
                  <Row label="session" value={spec.session?.strategy ?? 'full_replay'} />
                </Section>

                <Section title="Model">
                  <Row label="id" value={modelField(spec.model, 'id')} />
                  <Row label="temperature" value={modelField(spec.model, 'temperature')} />
                  <Row label="max_tokens" value={modelField(spec.model, 'max_tokens')} />
                  {asArray(spec.model?.fallbacks).length > 0 && (
                    <Chips label="fallbacks" items={asArray(spec.model?.fallbacks).map(String)} />
                  )}
                  {spec.model?.cache ? <Row label="cache" value="on" /> : null}
                  {spec.model?.thinking_budget ? (
                    <Row label="thinking" value={`${String(spec.model.thinking_budget)} tok`} />
                  ) : null}
                </Section>

                <Section title="Tools & skills">
                  <Chips label="tools" items={asArray(spec.tools).map(String)} />
                  <Chips
                    label="skills"
                    items={asArray(spec.skills).map(
                      (s) => (s as { name?: string })?.name ?? String(s),
                    )}
                  />
                </Section>

                <Section title="Memory">
                  <Row label="checkpointer" value={spec.memory?.checkpointer ?? 'none'} />
                  <Row label="store" value={spec.memory?.store ?? 'none'} />
                </Section>

                {(asArray(spec.guardrails?.judges).length > 0 ||
                  asArray(spec.approvals).length > 0 ||
                  asArray(spec.policies).length > 0 ||
                  spec.limits) && (
                  <Section title="Governance">
                    {asArray(spec.guardrails?.judges).map((j, i) => {
                      const judge = j as { name?: string; threshold?: number };
                      return (
                        <Row
                          // static read-only manifest list, never reordered
                          key={`judge-${i}`}
                          label={`judge: ${judge.name ?? i}`}
                          value={`≥ ${judge.threshold ?? '—'}`}
                        />
                      );
                    })}
                    {asArray(spec.approvals).map((a, i) => {
                      const ap = a as { id?: string; tools?: string[] };
                      return (
                        <Row
                          // static read-only manifest list, never reordered
                          key={`appr-${i}`}
                          label={`approval: ${ap.id ?? i}`}
                          value={asArray(ap.tools).join(', ')}
                        />
                      );
                    })}
                    {asArray(spec.policies).map((p, i) => {
                      const pol = p as { id?: string };
                      // static read-only manifest list, never reordered
                      return <Row key={`pol-${i}`} label="policy" value={pol.id ?? String(i)} />;
                    })}
                    {spec.limits &&
                      Object.entries(spec.limits).map(([k, v]) => (
                        <Row key={`lim-${k}`} label={k} value={String(v)} />
                      ))}
                  </Section>
                )}

                <Section title="Connectivity">
                  <Row label="mcp servers" value={asArray(spec.mcp_servers).length || '—'} />
                  <Row label="a2a peers" value={asArray(spec.a2a?.peers).length || '—'} />
                  <Row label="containers" value={asArray(spec.containers).length || '—'} />
                  <Row label="queues" value={asArray(spec.queues).length || '—'} />
                  <Row label="sandboxes" value={asArray(spec.sandboxes).length || '—'} />
                  <Row label="browser tools" value={asArray(spec.browser_tools).length || '—'} />
                </Section>

                <Section title="Inbound auth">
                  <Row
                    label="anonymous"
                    value={spec.auth?.inbound?.allow_anonymous ? 'allowed' : 'denied'}
                  />
                  {asArray(spec.auth?.inbound?.required_scopes).length > 0 && (
                    <Chips
                      label="scopes"
                      items={asArray(spec.auth?.inbound?.required_scopes).map(String)}
                    />
                  )}
                </Section>
              </>
            )}

            {card && !card.error && (
              <Section title="A2A discovery card (default agent)">
                <Row label="name" value={card.name} />
                <Row label="version" value={card.version} />
                <Row label="url" value={card.url} />
                <Chips label="capabilities" items={capabilityChips(card.capabilities)} />
                <Chips label="skills" items={skillChips(card.skills)} />
                {card.transparencyNotice && <Row label="transparency" value="disclosed to peers" />}
              </Section>
            )}

            {/*
              The route answers 200 with `{error, name}` when the default manifest is
              missing, and 404 when the agent has `spec.a2a.publish` unset. Neither is
              a fault in this panel, and both are worth saying out loud: an operator
              looking for the discovery card wants to know it is deliberately absent.
            */}
            {card?.error && (
              <Section title="A2A discovery card (default agent)">
                <Row label="unavailable" value={card.error} />
              </Section>
            )}
            {cardError != null && <ErrorNotice error={cardError} doing="load the discovery card" />}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
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
    mcp_servers?: unknown[];
    a2a?: { peers?: unknown[] };
    containers?: unknown[];
    queues?: unknown[];
    sandboxes?: unknown[];
    browser_tools?: unknown[];
  };
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded-md border bg-card/40 p-2.5">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number | undefined }) {
  if (value === undefined || value === '' || value === '—') {
    return (
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-muted-foreground">—</span>
      </div>
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all text-right font-mono">{value}</span>
    </div>
  );
}

function Chips({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex flex-wrap justify-end gap-1">
        {items.length === 0 ? (
          <span className="font-mono text-muted-foreground">—</span>
        ) : (
          items.map((it) => (
            <Badge key={it} variant="secondary" className="py-0 font-mono text-xs">
              {it}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}
