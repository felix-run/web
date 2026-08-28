/**
 * Just enough markdown for a terminal.
 *
 * Assistant messages are markdown, and chat-ui renders them with a real
 * renderer. Pulling one in here would buy a lot of machinery for a surface that
 * is 80 columns of monospace: what actually helps is that fenced code reads as
 * code, inline code and emphasis are visible, and list markers line up. Anything
 * more — tables, nested blockquotes, links as anything but their text — is left
 * as the literal source, which is honest and never wrong.
 *
 * Streaming matters more than completeness. A fence that has opened and not yet
 * closed is the normal state of a reply mid-flight, so the last block stays open
 * rather than being dropped or escaped.
 */

export type Block = { kind: 'text'; text: string } | { kind: 'code'; text: string; lang?: string };

/** Split on fences, keeping an unterminated final fence as code. */
export function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split('\n');
  let buffer: string[] = [];
  let code: { lang?: string; lines: string[] } | null = null;

  const flushText = () => {
    if (buffer.length) blocks.push({ kind: 'text', text: buffer.join('\n') });
    buffer = [];
  };

  for (const line of lines) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      if (code) {
        blocks.push({
          kind: 'code',
          text: code.lines.join('\n'),
          ...(code.lang ? { lang: code.lang } : {}),
        });
        code = null;
      } else {
        flushText();
        const lang = fence[1]?.trim();
        code = lang ? { lang, lines: [] } : { lines: [] };
      }
      continue;
    }
    if (code) code.lines.push(line);
    else buffer.push(line);
  }

  if (code) {
    blocks.push({
      kind: 'code',
      text: code.lines.join('\n'),
      ...(code.lang ? { lang: code.lang } : {}),
    });
  }
  flushText();
  return blocks;
}

/**
 * Prose, cleaned up for a fixed-width column.
 *
 * Markers become glyphs that align, headings lose their hashes and keep their
 * weight through the caller's styling, and inline markup is unwrapped: `**x**`
 * and `` `x` `` are noise once nothing is going to bold them.
 */
export function renderText(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) return heading[2] ?? '';
      const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
      if (bullet) return `${bullet[1] ?? ''}• ${inline(bullet[2] ?? '')}`;
      const numbered = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
      if (numbered) return `${numbered[1] ?? ''}${numbered[2]}. ${inline(numbered[3] ?? '')}`;
      const quote = /^\s*>\s?(.*)$/.exec(line);
      if (quote) return `│ ${inline(quote[1] ?? '')}`;
      return inline(line);
    })
    .join('\n');
}

/** Strip the markers that only exist to drive a renderer that is not here. */
function inline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}
