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
import { createTextAttributes, type ScrollBoxRenderable } from '@opentui/core';
import type { RefObject } from 'react';
import { syntaxStyle } from '../syntax.js';

const DIM = createTextAttributes({ dim: true });
const DIM_ITALIC = createTextAttributes({ dim: true, italic: true });

/**
 * A run of the reply's prose, rendered as the markdown it is.
 *
 * This used to be a hand-rolled fence splitter feeding two `<text>` elements,
 * which meant `**bold**` and `` `code` `` arrived as bare words, a table stayed
 * as pipes, and every fenced block was one flat colour whatever language it was
 * in. `<markdown>` is the renderer's own, and brings tables, blockquotes, nested
 * lists, links and tree-sitter-highlighted fences with it.
 *
 * `streaming` is the part worth understanding. Set, the trailing block is
 * treated as unstable and re-parsed on every delta — which is the normal state
 * of a reply mid-flight, where the last thing on screen is half a sentence or an
 * unclosed fence. Cleared, the parse is finalized. Passing it the wrong way
 * round either leaves a finished message's last paragraph permanently
 * provisional, or hard-parses a fence that has not been closed yet.
 */
function Prose({ text, streaming }: { text: string; streaming: boolean }) {
  if (!text) return null;
  return <markdown content={text} syntaxStyle={syntaxStyle()} streaming={streaming} />;
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

function AssistantTurn({ turn, live }: { turn: Turn; live: boolean }) {
  const segments = interleaveTurn(turn.content, turn.tools, turn.reasoning as ReasoningBlock[]);
  // Only the tail of a live turn is still being written. An earlier segment was
  // closed by the tool call that follows it and is as final as any past turn.
  const tail = segments.length - 1;
  return (
    <box flexDirection="column" marginBottom={1}>
      {segments.map((segment, i) => {
        if (segment.kind === 'tool')
          return <ToolCard key={`t${segment.index}`} tool={segment.tool} />;
        if (segment.kind === 'reasoning') return <Reasoning key={`r${i}`} text={segment.text} />;
        return <Prose key={`p${i}`} text={segment.text} streaming={live && i === tail} />;
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

export function Transcript({
  turns,
  streaming = false,
  scrollRef,
}: {
  turns: Turn[];
  streaming?: boolean;
  /**
   * Handed to `App` so the page keys can drive the box without taking focus
   * from the composer. The alternative — focusing the scrollbox so its own
   * `handleKeyPress` runs — would mean a mode you have to leave before you can
   * type, for two keys that conflict with nothing.
   */
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
}) {
  return (
    // Sticky to the bottom, so a stream stays in view — and only sticky, so
    // scrolling up to read while the model is still writing is not fought. The
    // box re-engages sticky by itself once you land back at the bottom, which is
    // why paging down is all it takes to return to a live run.
    // `viewportCulling` is what makes the cap unnecessary: rows off screen take
    // no part in layout, which is the whole reason the Ink version kept only a
    // tail.
    <scrollbox
      ref={scrollRef}
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
          <AssistantTurn
            key={turn.id}
            turn={turn}
            live={streaming && turn.id === turns[turns.length - 1]?.id}
          />
        ),
      )}
    </scrollbox>
  );
}
