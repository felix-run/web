/**
 * The conversation, top to bottom.
 *
 * The renderer lays out only what is on screen, so unlike the Ink version this
 * does not cap the transcript at a fixed tail — the whole thing lives in a
 * `scrollbox`, which is scrollback the terminal itself never gave us once the
 * alternate screen was in use.
 *
 * One layout rule to keep in mind editing this file: `<box>` defaults to
 * `flexDirection="column"`. Ink's `<Box>` defaulted to `row`, and a box that
 * leans on the wrong default lays out silently wrong rather than failing.
 */

import type { ReasoningBlock, ToolCall, Turn } from '@felix/client';
import { interleaveTurn } from '@felix/client';
import { createTextAttributes } from '@opentui/core';
import { renderText, splitBlocks } from '../markdown.js';

const DIM = createTextAttributes({ dim: true });
const DIM_ITALIC = createTextAttributes({ dim: true, italic: true });

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
  return (
    // Sticky to the bottom, so a stream stays in view — and only sticky, so
    // scrolling up to read while the model is still writing is not fought.
    // `viewportCulling` is what makes the cap unnecessary: rows off screen take
    // no part in layout, which is the whole reason the Ink version kept only a
    // tail.
    <scrollbox
      flexGrow={1}
      stickyScroll
      stickyStart="bottom"
      scrollY
      viewportCulling
      contentOptions={{ flexDirection: 'column' }}
    >
      {turns.map((turn) =>
        turn.role === 'user' ? (
          <box key={turn.id} flexDirection="row" marginBottom={1}>
            <text fg="green">{'› '}</text>
            <text>{turn.content}</text>
          </box>
        ) : (
          <AssistantTurn key={turn.id} turn={turn} />
        ),
      )}
    </scrollbox>
  );
}
