/**
 * `apps/tui/src/ui/transcript.tsx`, ported to OpenTUI.
 *
 * THE trap of this port: Ink's `<Box>` defaults to `flexDirection="row"`,
 * OpenTUI's `<box>` defaults to **column**. Every Ink box that leaned on the
 * default — here, the `› ` marker beside the user's text — lays out silently
 * wrong rather than failing. It is greppable (`<Box>` with no flexDirection)
 * and it is the single largest source of diff in a mechanical port.
 *
 * Kept line-for-line against the Ink original wherever the renderer allowed it,
 * because the point of the spike is to measure the port, not to redesign the
 * component. Three mappings cover almost all of it:
 *
 *   <Box>            → <box>          (same flexbox props, same names)
 *   <Text>           → <text>         (fg=… instead of color=…)
 *   <Text dimColor>  → attributes={createTextAttributes({ dim: true })}
 *
 * Nested `<Text>` inside `<Text>` is the one real difference: Ink allows it,
 * OpenTUI splits the roles — `text` is the block, `span` is the run inside it.
 *
 * `WINDOW` is deliberately still here, and it is the thing to delete next: it
 * exists because Ink re-lays-out every turn on every delta. OpenTUI has a
 * native `scrollbox`, so the real port drops the cap and gains scrollback the
 * terminal never had. Left in place so this file stays a like-for-like
 * comparison.
 */

import type { ReasoningBlock, ToolCall, Turn } from '@felix/client';
import { interleaveTurn } from '@felix/client';
import { createTextAttributes } from '@opentui/core';
import { renderText, splitBlocks } from '../src/markdown.js';

const DIM = createTextAttributes({ dim: true });
const DIM_ITALIC = createTextAttributes({ dim: true, italic: true });

/** Turns kept on screen. Older ones stay in the terminal's scrollback. */
const WINDOW = 30;

/**
 * Blocks are keyed by position because that is what they are: the whole message
 * is re-split on every delta, so a block has no identity beyond where it sits.
 */
function Prose({ text }: { text: string }) {
  return (
    <>
      {splitBlocks(text).map((block, i) =>
        block.kind === 'code' ? (
          <box key={i} flexDirection="column" paddingLeft={2} marginTop={1} marginBottom={1}>
            {block.lang ? <text attributes={DIM}>{block.lang}</text> : null}
            <text fg="cyan">{block.text}</text>
          </box>
        ) : (
          <text key={i}>{renderText(block.text)}</text>
        ),
      )}
    </>
  );
}

function ToolCard({ tool }: { tool: ToolCall }) {
  const name = tool.name.replace(/^(client|approval) · /, '');
  const kind = tool.name.startsWith('approval · ')
    ? 'awaiting approval'
    : tool.name.startsWith('client · ')
      ? 'local'
      : '';
  const arg = summarize(tool.input);
  return (
    <box>
      <text attributes={DIM}>
        {tool.done ? '⎿ ' : '⠿ '}
        {name}
        {arg ? ` ${arg}` : ''}
        {kind ? ` · ${kind}` : ''}
        {!tool.done && tool.phase ? ` · ${tool.phase}` : ''}
      </text>
    </box>
  );
}

/** One line of the arguments, because a tool card is a line. */
function summarize(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return oneLine(input);
  try {
    const obj = input as Record<string, unknown>;
    const first = obj.command ?? obj.path ?? obj.target ?? obj.query;
    if (typeof first === 'string') return oneLine(first);
    return oneLine(JSON.stringify(obj));
  } catch {
    return '';
  }
}

const oneLine = (s: string) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > 68 ? `${flat.slice(0, 67)}…` : flat;
};

function Reasoning({ text }: { text: string }) {
  return <text attributes={DIM_ITALIC}>{oneLine(text)}</text>;
}

function AssistantTurn({ turn }: { turn: Turn }) {
  const segments = interleaveTurn(turn.content, turn.tools, turn.reasoning as ReasoningBlock[]);
  return (
    <box flexDirection="column" marginBottom={1}>
      {segments.map((segment, i) => {
        if (segment.kind === 'tool')
          return <ToolCard key={`t${segment.index}`} tool={segment.tool} />;
        if (segment.kind === 'reasoning') return <Reasoning key={`r${i}`} text={segment.text} />;
        return <Prose key={`p${i}`} text={segment.text} />;
      })}
      {turn.usage ? (
        <text attributes={DIM}>
          {'  '}
          {turn.usage.input} in / {turn.usage.output} out
        </text>
      ) : null}
    </box>
  );
}

export function Transcript({ turns }: { turns: Turn[] }) {
  const shown = turns.slice(-WINDOW);
  return (
    <box flexDirection="column">
      {turns.length > shown.length ? (
        <text attributes={DIM}>… {turns.length - shown.length} earlier turns</text>
      ) : null}
      {shown.map((turn) =>
        turn.role === 'user' ? (
          <box key={turn.id} flexDirection="row" marginBottom={1}>
            <text fg="green">{'› '}</text>
            <text>{turn.content}</text>
          </box>
        ) : (
          <AssistantTurn key={turn.id} turn={turn} />
        ),
      )}
    </box>
  );
}
