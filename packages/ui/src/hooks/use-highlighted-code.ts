import * as React from 'react';

import type { LineHighlighter } from '../lib/highlighter';

type Done = {
  highlighter: LineHighlighter | null;
  text: string;
  lines: React.ReactNode[];
  state?: Parameters<LineHighlighter['highlight']>[1];
};

/**
 * `code` as one React node per line, for `CodeBlockLine`s. Plain lines until the language has
 * loaded, and for a language the highlighter does not list. While the code streams, only the
 * lines added since the last render are tokenized, starting from the grammar state of the last
 * complete one; the line still being written is re-tokenized each render.
 */
export function useHighlightedCode(value: string, language: string): React.ReactNode[] {
  // A trailing newline would render as an extra empty line.
  const code = value.endsWith('\n') ? value.slice(0, -1) : value;
  const [loaded, setLoaded] = React.useState<{
    language: string;
    highlighter: LineHighlighter | null;
  } | null>(null);
  const highlighter = loaded?.language === language ? loaded.highlighter : null;

  React.useEffect(() => {
    let cancelled = false;
    // Imported here, not at the top: Shiki's core and its regex engine are ~50 kB gzipped, and a
    // static import put them in the first load of every page that can draw a code block.
    import('../lib/highlighter')
      .then((m) => m.loadHighlighter(language))
      .then((next) => {
        if (!cancelled) setLoaded({ language, highlighter: next });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [language]);

  const [done, setDone] = React.useState<Done>({ highlighter: null, text: '', lines: [] });

  let next = done;
  if (next.highlighter !== highlighter || !code.startsWith(next.text)) {
    next = { highlighter, text: '', lines: [] };
  }

  const end = code.lastIndexOf('\n') + 1;
  if (highlighter && end > next.text.length) {
    const result = highlighter.highlight(code.slice(next.text.length, end - 1), next.state);
    next = {
      highlighter,
      text: code.slice(0, end),
      lines: [...next.lines, ...result.lines],
      state: result.state,
    };
  }

  // Adjusting state while rendering, React's pattern for state derived from a changing prop.
  if (next !== done) setDone(next);

  const tail = code.slice(end);

  return React.useMemo(() => {
    if (!highlighter) return code.split('\n');
    return [...next.lines, highlighter.highlight(tail, next.state).lines[0]];
  }, [code, highlighter, next, tail]);
}
