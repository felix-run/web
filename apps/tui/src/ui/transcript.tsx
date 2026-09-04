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
import {
  BoxRenderable,
  type CodeRenderable,
  type ColorInput,
  type MarkdownOptions,
  type Renderable,
  type RenderContext,
  type ScrollBoxRenderable,
} from '@opentui/core';
import { useTimeline } from '@opentui/react';
import { type ReactNode, type RefObject, useEffect, useMemo, useState } from 'react';
import { handlesByTool, type Spill, sizeLabel } from '../artifacts.js';
import { syntaxStyle } from '../syntax.js';
import { oneLine } from '../text.js';
import { DIM, DIM_ITALIC, type Theme } from '../theme.js';

/**
 * Fenced code, in a frame with its language on it.
 *
 * `<markdown>` renders a fence through `CodeRenderable`, which highlights it
 * but draws it at the same indent and on the same ground as the prose around
 * it — so a block of code and a paragraph about code look alike at a glance,
 * which is the one distinction a reply most needs to make.
 *
 * `renderNode` is the documented hook for overriding a single token type.
 * `defaultRender()` gives back the renderable the markdown would have used, and
 * a `Renderable` carries the render context it was built with, which is the
 * only way to construct the box that wraps it — nothing else in
 * `RenderNodeContext` exposes one.
 */
function frameCodeBlocks(borderColor: ColorInput): MarkdownOptions['renderNode'] {
  return (token, context) => {
    if (token.type !== 'code') return undefined;
    const inner = context.defaultRender();
    if (!inner) return null;

    const ctx = (inner as unknown as { ctx?: RenderContext })?.ctx;
    // Without a context there is nothing to build a box with, and an
    // unframed block is much better than a thrown render.
    if (!ctx) return inner;

    // The renderer keeps the fence's trailing newline, which shows up as a
    // blank row inside the frame — invisible without a border, obvious with one.
    // The fence's trailing newline is the renderer's, not the author's, and
    // shows up as an extra row that a border makes obvious.
    //
    // A row still remains after this, because the code buffer measures itself
    // one line taller than its content. Pinning the box height would close it
    // and is **wrong**: the buffer wraps, so a long line in a narrow terminal
    // needs more rows than it has lines, and a pinned height silently drops the
    // ones past the fold. An empty row is a cosmetic cost; clipped code is not.
    const code = inner as CodeRenderable;
    if (typeof code.content === 'string') {
      code.content = code.content.replace(/\n+$/, '');
    }

    const language = typeof token.lang === 'string' ? token.lang.trim().split(/\s+/)[0] : '';
    const box = new BoxRenderable(ctx, {
      border: true,
      borderStyle: 'rounded',
      borderColor,
      ...(language ? { title: ` ${language} `, titleAlignment: 'left' as const } : {}),
      flexDirection: 'column',
      width: '100%',
      height: 'auto',
      paddingLeft: 1,
      paddingRight: 1,
      marginTop: 1,
      marginBottom: 1,
    });
    box.add(inner as Renderable);
    return box;
  };
}

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
function Prose({ text, streaming, theme }: { text: string; streaming: boolean; theme: Theme }) {
  // Rebuilt only when the border colour does, because `renderNode` changing
  // identity makes the markdown renderable rebuild every block it owns.
  const renderNode = useMemo(() => frameCodeBlocks(theme.faint), [theme.faint]);
  if (!text) return null;
  return (
    <markdown
      content={text}
      syntaxStyle={syntaxStyle()}
      streaming={streaming}
      renderNode={renderNode}
    />
  );
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

/**
 * What a tool call did, in at most two dim lines.
 *
 * The second line is the *result*, which this client did not draw at all until
 * now — every tool ran and returned into silence, so a spilled-output marker was
 * not a raw marker on screen, it was invisible. One line, because the card is a
 * trace of the run rather than a transcript of it: the full body is a keystroke
 * away when it is worth reading.
 */
function ToolCard({ tool, spill }: { tool: ToolCall; spill?: Spill }) {
  const name = tool.name.replace(/^(client|approval) · /, '');
  const kind = tool.name.startsWith('approval · ')
    ? 'awaiting approval'
    : tool.name.startsWith('client · ')
      ? 'local'
      : '';
  const arg = summarize(tool.input);
  const spinner = useSpinner(!tool.done);
  // A spill's preview is the part the harness kept inline; everything else is
  // the output as it stands.
  const body = spill ? spill.ref.preview : typeof tool.output === 'string' ? tool.output : '';
  const result = oneLine(body, RESULT_WIDTH);
  return (
    <box>
      <text attributes={DIM}>
        {tool.done ? '⎿ ' : `${spinner} `}
        {name}
        {arg ? ` ${arg}` : ''}
        {kind ? ` · ${kind}` : ''}
        {!tool.done && tool.phase ? ` · ${tool.phase}` : ''}
      </text>
      {tool.done && (result || spill) ? (
        <text attributes={DIM}>
          {'  '}
          {result || '(no output)'}
          {spill ? ` · ${sizeLabel(spill.ref.chars)} more [a${spill.handle}]` : ''}
        </text>
      ) : null}
    </box>
  );
}

/** Room for a tool's arguments beside its name, on an eighty-column terminal. */
const TOOL_ARG_WIDTH = 68;

/**
 * The result line is indented two columns under the call, so it is a little
 * narrower than the argument line above it.
 */
const RESULT_WIDTH = 66;

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

function AssistantTurn({
  turn,
  live,
  theme,
  handles,
}: {
  turn: Turn;
  live: boolean;
  theme: Theme;
  /** Handle numbers are assigned across the whole transcript, not per turn. */
  handles: Map<ToolCall, Spill>;
}) {
  const segments = interleaveTurn(turn.content, turn.tools, turn.reasoning as ReasoningBlock[]);
  // Only the tail of a live turn is still being written. An earlier segment was
  // closed by the tool call that follows it and is as final as any past turn.
  const tail = segments.length - 1;
  return (
    <box flexDirection="column" marginBottom={1}>
      {segments.map((segment, i) => {
        if (segment.kind === 'tool')
          return (
            <ToolCard
              key={`t${segment.index}`}
              tool={segment.tool}
              {...(handles.get(segment.tool) ? { spill: handles.get(segment.tool) } : {})}
            />
          );
        if (segment.kind === 'reasoning') return <Reasoning key={`r${i}`} text={segment.text} />;
        return (
          <Prose key={`p${i}`} text={segment.text} streaming={live && i === tail} theme={theme} />
        );
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
  greeting,
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
  /**
   * Drawn in place of the conversation while there is none. Inside the
   * scrollbox rather than above it, so it sits where the first message will —
   * against the composer — instead of at the top of an empty column.
   */
  greeting?: ReactNode;
}) {
  // Assigned across the whole transcript so `/artifact 2` means the same thing
  // to the command as it does to the card that drew `[a2]`.
  const handles = useMemo(() => handlesByTool(turns), [turns]);

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
      // Grown from the bottom, not the top. A conversation shorter than the
      // screen used to float at the top with a void between it and the
      // composer — fifteen empty rows on a thirty-row terminal, which reads as
      // a client that has lost something rather than one waiting for you.
      contentOptions={{ flexDirection: 'column', justifyContent: 'flex-end' }}
    >
      {turns.length === 0 ? greeting : null}
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
            theme={theme}
            handles={handles}
          />
        ),
      )}
    </scrollbox>
  );
}
