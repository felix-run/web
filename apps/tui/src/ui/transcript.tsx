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
import type { ScrollBoxRenderable } from '@opentui/core';
import { useTimeline } from '@opentui/react';
import { type RefObject, useEffect, useState } from 'react';
import { syntaxStyle } from '../syntax.js';
import { oneLine } from '../text.js';
import { DIM, DIM_ITALIC, type Theme } from '../theme.js';

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

/**
 * The frames of the spinner, and how long one revolution takes.
 *
 * The only motion in the client. A tool card that has been on `⠿` for thirty
 * seconds and one whose process died look identical; a turning spinner is the
 * difference between "still working" and "nothing is happening", and it costs
 * one timeline shared by every card on screen.
 */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPIN_MS = 800;

/**
 * One timeline, however many cards are running.
 *
 * A timeline per card would be a timer per card and, worse, cards drifting out
 * of phase with each other — which reads as several unrelated things happening
 * rather than one run working.
 */
function useSpinner(active: boolean): string {
  const timeline = useTimeline({ duration: SPIN_MS, loop: true });
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const state = { t: 0 };
    timeline.add(state, {
      t: SPINNER.length,
      duration: SPIN_MS,
      ease: 'linear',
      loop: true,
      onUpdate: () => setFrame(Math.floor(state.t) % SPINNER.length),
    });
    return () => timeline.resetItems();
  }, [active, timeline]);

  return SPINNER[frame] ?? SPINNER[0] ?? '⠋';
}

function ToolCard({ tool }: { tool: ToolCall }) {
  const name = tool.name.replace(/^(client|approval) · /, '');
  const kind = tool.name.startsWith('approval · ')
    ? 'awaiting approval'
    : tool.name.startsWith('client · ')
      ? 'local'
      : '';
  const arg = summarize(tool.input);
  const spinner = useSpinner(!tool.done);
  return (
    <box>
      <text attributes={DIM}>
        {tool.done ? '⎿ ' : `${spinner} `}
        {name}
        {arg ? ` ${arg}` : ''}
        {kind ? ` · ${kind}` : ''}
        {!tool.done && tool.phase ? ` · ${tool.phase}` : ''}
      </text>
    </box>
  );
}

/** Room for a tool's arguments beside its name, on an eighty-column terminal. */
const TOOL_ARG_WIDTH = 68;

/** One line of the arguments, because a tool card is a line. */
function summarize(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return oneLine(input, TOOL_ARG_WIDTH);
  try {
    const obj = input as Record<string, unknown>;
    const first = obj.command ?? obj.path ?? obj.target ?? obj.query;
    if (typeof first === 'string') return oneLine(first, TOOL_ARG_WIDTH);
    return oneLine(JSON.stringify(obj), TOOL_ARG_WIDTH);
  } catch {
    return '';
  }
}

function Reasoning({ text }: { text: string }) {
  return <text attributes={DIM_ITALIC}>{oneLine(text, TOOL_ARG_WIDTH)}</text>;
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
  theme,
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
  theme: Theme;
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
            <text fg={theme.ready}>{'› '}</text>
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
