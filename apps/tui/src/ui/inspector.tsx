/**
 * The harness's operator surface, in the terminal.
 *
 * An absolutely-positioned overlay, the same technique the thread picker uses
 * and for the same reason: opening it must not reflow the conversation
 * underneath, and a permanent column would cost a third of an eighty-column
 * terminal whether or not anyone is looking at it.
 *
 * **There is no `useKeyboard` in this file, and that is a rule.** `useKeyboard`
 * is a global subscription and a handler registered by a child runs *before*
 * its parent's, so a listener here would see keys while an approval banner is
 * up — the exact hazard the one-prompt rule exists to prevent. Every key this
 * overlay answers is routed by `src/keys.ts` and handed down as a prop.
 */

import type { PendingApproval } from '@felix/client';
import type { ColorInput, ScrollBoxRenderable, TabSelectRenderable } from '@opentui/core';
import { type RefObject, useEffect, useRef } from 'react';
import { compact, num, relTime } from '../format.js';
import { SECTIONS, type Section, TAB_WIDTH } from '../inspector.js';
import { oneLine } from '../text.js';
import { DIM, type Theme } from '../theme.js';
import { Table } from './table.js';

export type Row = Array<{ text: string; color?: ColorInput }>;

export interface PanelState {
  loading: boolean;
  error: string | null;
  /** Rows already narrowed to what the panel draws. */
  rows: Row[];
  head: string[];
  /** Shown when there is no error and no rows — a different fact from a failure. */
  empty: string;
}

export function Inspector({
  section,
  panel,
  width,
  rows,
  theme,
  panelRef,
  searching,
  query,
  onQuery,
}: {
  section: Section;
  panel: PanelState;
  width: number;
  rows: number;
  theme: Theme;
  panelRef: RefObject<ScrollBoxRenderable | null>;
  searching: boolean;
  query: string;
  onQuery: (value: string) => void;
}) {
  // `<tab-select>` takes no `selectedIndex` option — selection is internal and
  // moved through the renderable. App owns which section is open, so the strip
  // is told rather than asked, and `onChange` is deliberately not wired: two
  // sources of truth for one cursor is how they drift.
  const stripRef = useRef<TabSelectRenderable | null>(null);
  const index = SECTIONS.findIndex((s) => s.key === section.key);
  useEffect(() => {
    stripRef.current?.setSelectedIndex(index < 0 ? 0 : index);
  }, [index]);

  return (
    <box
      position="absolute"
      left={2}
      top={1}
      width={Math.min(Math.max(40, width - 4), 92)}
      zIndex={10}
      flexDirection="column"
      backgroundColor={theme.surface}
      border
      borderStyle="rounded"
      borderColor={theme.ready}
      title="inspector"
      bottomTitle={oneLine(section.description, 60)}
      paddingLeft={1}
      paddingRight={1}
    >
      {/*
        Every colour is passed. The renderable's defaults are hardcoded
        true-colour literals (#FFFFFF on #1a1a1a, selected #FFFF00 on #334455)
        painted straight over the user's palette, which is what `theme.ts`
        exists to stop. The fill stays neutral and the underline carries
        selection, because a filled tab needs a contrast pair this theme
        deliberately does not have.
      */}
      <tab-select
        options={SECTIONS.map((s) => ({ name: s.name, description: s.description, value: s.key }))}
        tabWidth={TAB_WIDTH}
        showDescription={false}
        showUnderline
        showScrollArrows
        wrapSelection
        backgroundColor={theme.surface}
        focusedBackgroundColor={theme.surface}
        selectedBackgroundColor={theme.surface}
        textColor={theme.faint}
        focusedTextColor={theme.faint}
        selectedTextColor={theme.ready}
        selectedDescriptionColor={theme.faint}
        ref={stripRef}
      />

      {/*
        The one mode in here, and it earns one: there is no other way to get
        typed text into a panel. `escape` is claimed by the app's global handler
        and prevented, so the input never sees the key that leaves it — which is
        the only way to cancel out of a field that would otherwise consume it.
      */}
      {section.key === 'memory' ? (
        searching ? (
          <input
            focused
            value={query}
            placeholder="what the agent might remember…"
            onInput={onQuery}
            backgroundColor={theme.surface}
          />
        ) : (
          <text attributes={DIM}>{query ? `search: ${query} · / to edit` : '/ to search'}</text>
        )
      ) : null}

      <scrollbox
        ref={panelRef}
        scrollY
        viewportCulling
        style={{ height: rows }}
        contentOptions={{ flexDirection: 'column' }}
      >
        <PanelBody panel={panel} theme={theme} />
      </scrollbox>
    </box>
  );
}

/**
 * Loading, failed, empty and full are four states and only one of them is
 * "nothing to show". A failed read that renders as an empty list says the
 * harness is idle, which is a different and wrong claim.
 */
function PanelBody({ panel, theme }: { panel: PanelState; theme: Theme }) {
  if (panel.error) {
    return (
      <box flexDirection="column">
        <text fg={theme.failed}>{oneLine(panel.error, 86)}</text>
        <text attributes={DIM}>r to try again</text>
      </box>
    );
  }
  if (!panel.rows.length) {
    return <text attributes={DIM}>{panel.loading ? 'reading…' : panel.empty}</text>;
  }
  return <Table head={panel.head} rows={panel.rows} theme={theme} />;
}

// --- The seven sections, each turning one read into rows ---------------------

export const EMPTY: Record<string, string> = {
  activity: 'nothing recorded on this tenant yet',
  approvals: 'nothing waiting — gated tools appear here',
  plans: 'the agent has not written a plan',
  tools: 'no tool calls in the window',
  usage: 'no tokens billed yet',
  memory: 'nothing remembered yet',
  skills: 'no skills reported yet — the agent lists them when it uses them',
};

export function activityRows(
  events: Array<{
    ts: number;
    event_type: string;
    status: string;
    payload: Record<string, unknown>;
  }>,
  theme: Theme,
): { head: string[]; rows: Row[] } {
  return {
    head: ['when', 'event', 'status', 'what'],
    rows: events.map((e) => [
      { text: relTime(e.ts) },
      { text: e.event_type },
      { text: e.status, color: e.status === 'ok' ? undefined : theme.failed },
      { text: oneLine(String(e.payload?.tool ?? e.payload?.text ?? ''), 40) },
    ]),
  };
}

export function approvalRows(
  pending: PendingApproval[],
  theme: Theme,
): { head: string[]; rows: Row[] } {
  return {
    head: ['tool', 'rule', 'what'],
    rows: pending.map((a) => [
      { text: a.toolName, color: theme.blocked },
      { text: a.ruleId ?? '' },
      { text: oneLine(String((a.args as { path?: string })?.path ?? ''), 44) },
    ]),
  };
}

export function planRows(
  plans: Array<{ title: string; steps: Array<{ status: string }>; updated_at: number }>,
): { head: string[]; rows: Row[] } {
  return {
    head: ['plan', 'steps', 'done', 'updated'],
    rows: plans.map((p) => [
      { text: oneLine(p.title, 34) },
      { text: num(p.steps.length, 5) },
      { text: num(p.steps.filter((s) => s.status === 'done').length, 4) },
      { text: relTime(p.updated_at) },
    ]),
  };
}

export function toolRows(
  tools: Array<{ tool: string; calls: number; errors: number; avg_latency_ms: number }>,
  theme: Theme,
): { head: string[]; rows: Row[] } {
  return {
    head: ['tool', 'calls', 'errors', 'avg ms'],
    rows: tools.map((t) => [
      { text: oneLine(t.tool, 30) },
      { text: num(t.calls, 5) },
      { text: num(t.errors, 6), color: t.errors ? theme.failed : undefined },
      { text: num(Math.round(t.avg_latency_ms), 6) },
    ]),
  };
}

export function usageRows(
  events: Array<{ ts: number; model_id: string; tokens_input: number; tokens_output: number }>,
): { head: string[]; rows: Row[] } {
  return {
    head: ['when', 'model', 'in', 'out'],
    rows: events.map((u) => [
      { text: relTime(u.ts) },
      { text: oneLine(u.model_id, 28) },
      { text: num(compact(u.tokens_input), 6) },
      { text: num(compact(u.tokens_output), 6) },
    ]),
  };
}

export function memoryRows(
  items: Array<{ kind: string; content: string; channels?: string[]; created_at?: number }>,
): { head: string[]; rows: Row[] } {
  return {
    // `channels` is which retriever found a hit, and it is the reason a result
    // looks wrong — invisible everywhere else, so it is rendered rather than dropped.
    head: ['kind', 'remembered', 'via'],
    rows: items.map((m) => [
      { text: oneLine(m.kind, 12) },
      { text: oneLine(m.content, 48) },
      { text: (m.channels ?? []).join('+') || relTime(m.created_at) },
    ]),
  };
}

export function skillRows(skills: { declared: string[]; active: string[] } | null): {
  head: string[];
  rows: Row[];
} {
  if (!skills) return { head: ['skill', 'state'], rows: [] };
  const all = [...new Set([...skills.declared, ...skills.active])].sort();
  return {
    head: ['skill', 'state'],
    rows: all.map((s) => [
      { text: oneLine(s, 40) },
      { text: skills.active.includes(s) ? 'active' : 'declared' },
    ]),
  };
}
