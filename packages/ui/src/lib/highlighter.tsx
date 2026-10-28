import type * as React from 'react';
import { createHighlighterCore, type GrammarState, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/**
 * The Code Block's highlighter, from shadcn's registry: Shiki's core with its JavaScript regex
 * engine (no WASM), two themes, and a table of languages that each load the first time
 * they are asked for. A language not on the table renders as plain text rather than rejecting,
 * which is the difference from asking Shiki's full bundle for a name it lacks. `ansi` is Shiki's
 * own terminal-escape grammar.
 */
const languages = {
  bash: () => import('shiki/langs/shellscript.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  mdx: () => import('shiki/langs/mdx.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
};

const aliases: Record<string, keyof typeof languages> = {
  'c#': 'csharp',
  'c++': 'cpp',
  cs: 'csharp',
  dockerfile: 'docker',
  golang: 'go',
  js: 'javascript',
  kt: 'kotlin',
  makefile: 'make',
  rb: 'ruby',
  rs: 'rust',
  md: 'markdown',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
};

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

/** The table's name for `language`, `ansi`, or null when it would render as plain text. */
export function highlightLanguage(language: string): keyof typeof languages | 'ansi' | null {
  const name = language.toLowerCase();
  if (name === 'ansi') return name;
  if (name in languages) return name as keyof typeof languages;
  return aliases[name] ?? null;
}

export type LineHighlighter = {
  /** One React node per line, and the grammar state after the last; pass it back to continue. */
  highlight(code: string, state?: GrammarState): { lines: React.ReactNode[]; state?: GrammarState };
};

/** Loads a language and returns a highlighter for it, or null for a language not on the table. */
export async function loadHighlighter(language: string): Promise<LineHighlighter | null> {
  const lang = highlightLanguage(language);
  if (!lang) return null;

  const shiki = await getHighlighter();
  if (lang !== 'ansi' && !shiki.getLoadedLanguages().includes(lang)) {
    await shiki.loadLanguage(languages[lang]);
  }

  return {
    highlight(code, state) {
      const tokenize = (text: string) =>
        shiki.codeToTokens(text, {
          lang,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
          grammarState: state,
        }).tokens;

      // ANSI has no grammar state, so each line is tokenized on its own and gets the same
      // colours whether it arrives in one piece or streams.
      const tokens =
        lang === 'ansi' ? code.split('\n').flatMap((line) => tokenize(line)) : tokenize(code);

      return {
        lines: tokens.map((line) =>
          line.map((token, index) => (
            <span
              key={index}
              style={token.htmlStyle as React.CSSProperties}
              className="text-(--shiki-light) dark:text-(--shiki-dark)"
            >
              {token.content}
            </span>
          )),
        ),
        state: shiki.getLastGrammarState(tokens),
      };
    },
  };
}

/** One React node per line, or null for a language not on the table. */
export async function highlightCode(code: string, language: string) {
  const loaded = await loadHighlighter(language);
  return loaded ? loaded.highlight(code).lines : null;
}
