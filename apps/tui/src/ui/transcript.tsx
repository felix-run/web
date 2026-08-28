/**
 * The conversation, top to bottom.
 *
 * Ink redraws the whole tree on every frame, so a long transcript is a real
 * cost during a stream — a delta arrives, and every turn above it is laid out
 * again. Only the tail is rendered for that reason; the rest has scrolled out
 * of a terminal's own scrollback anyway, where the user can still reach it.
 */

import type { ReasoningBlock, ToolCall, Turn } from '@felix/client';
import { interleaveTurn } from '@felix/client';
import { Box, Text } from 'ink';
import { renderText, splitBlocks } from '../markdown.js';

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
          <Box key={i} flexDirection="column" paddingLeft={2} marginY={1}>
            {block.lang ? <Text dimColor>{block.lang}</Text> : null}
            <Text color="cyan">{block.text}</Text>
          </Box>
        ) : (
          <Text key={i}>{renderText(block.text)}</Text>
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
    <Box>
      <Text dimColor>
        {tool.done ? '⎿ ' : '⠿ '}
        {name}
        {arg ? ` ${arg}` : ''}
        {kind ? ` · ${kind}` : ''}
        {!tool.done && tool.phase ? ` · ${tool.phase}` : ''}
      </Text>
    </Box>
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
  return (
    <Text dimColor italic>
      {oneLine(text)}
    </Text>
  );
}

function AssistantTurn({ turn }: { turn: Turn }) {
  const segments = interleaveTurn(turn.content, turn.tools, turn.reasoning as ReasoningBlock[]);
  return (
    <Box flexDirection="column" marginBottom={1}>
      {segments.map((segment, i) => {
        if (segment.kind === 'tool')
          return <ToolCard key={`t${segment.index}`} tool={segment.tool} />;
        if (segment.kind === 'reasoning') return <Reasoning key={`r${i}`} text={segment.text} />;
        return <Prose key={`p${i}`} text={segment.text} />;
      })}
      {turn.usage ? (
        <Text dimColor>
          {'  '}
          {turn.usage.input} in / {turn.usage.output} out
        </Text>
      ) : null}
    </Box>
  );
}

export function Transcript({ turns }: { turns: Turn[] }) {
  const shown = turns.slice(-WINDOW);
  return (
    <Box flexDirection="column">
      {turns.length > shown.length ? (
        <Text dimColor>… {turns.length - shown.length} earlier turns</Text>
      ) : null}
      {shown.map((turn) =>
        turn.role === 'user' ? (
          <Box key={turn.id} marginBottom={1}>
            <Text color="green">› </Text>
            <Text>{turn.content}</Text>
          </Box>
        ) : (
          <AssistantTurn key={turn.id} turn={turn} />
        ),
      )}
    </Box>
  );
}
