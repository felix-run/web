#!/usr/bin/env node
/**
 * Re-render the harness's diagrams for the docs, from a harness *checkout*.
 *
 * felix-run/felix keeps Mermaid sources for its hardest flows in
 * `docs/diagrams/*.mmd`, each naming the code it describes on its second line and
 * held to that code in the same commit (`docs/DIAGRAMS.md`). The docs draw those
 * sources rather than a second account of the same flows, which would drift.
 *
 * They cannot use the harness's own exports. Those are drawn for GitHub: a white
 * canvas, blue fills, the system face, and widths of 1,100–1,700px that put 15px
 * labels at 7–10px in the docs' 48rem column. So each source is rendered again
 * here with the docs' face and with a **sentinel** colour per theme slot, and every
 * sentinel in the output is rewritten to a docs theme variable (`--sl-color-*`).
 * The SVG is inlined into the page (`HarnessDiagram.astro`), so those variables
 * resolve in both themes and follow the switch without a reload.
 *
 * Any colour left in the output that the map does not name fails the run. Mermaid
 * derives colours of its own from the theme, and one that slipped through would
 * be a hue the docs never chose — on a site where hue means a run's state.
 *
 * Usage:
 *   node scripts/sync-harness-diagrams.mjs [path-to-felix-checkout]
 *
 * Defaults to ~/Projects/felix. Renders with mermaid-cli through npx (pinned
 * below), so it needs network on first run and nothing in CI: the output is
 * checked in, like the contract records `sync-harness-contract.mjs` writes.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO, 'apps/docs/src/diagrams');
const INDEX = join(OUT_DIR, 'diagrams.json');
const MERMAID_CLI = '@mermaid-js/mermaid-cli@11.17.0';
const GEIST = join(
  REPO,
  'apps/docs/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
);

/**
 * One sentinel per theme slot Mermaid paints with. The values are arbitrary and
 * only have to be unique; what matters is the CSS each one becomes.
 */
const SLOTS = {
  fill: ['#f00001', 'none'],
  text: ['#f00002', 'var(--sl-color-white)'],
  border: ['#f00003', 'var(--sl-color-gray-3)'],
  line: ['#f00004', 'var(--sl-color-gray-3)'],
  note: ['#f00005', 'var(--sl-color-gray-6)'],
  noteBorder: ['#f00006', 'var(--sl-color-hairline)'],
  labelBg: ['#f00007', 'var(--sl-color-black)'],
  cluster: ['#f00008', 'var(--sl-color-hairline)'],
  muted: ['#f00009', 'var(--sl-color-gray-2)'],
};
const s = (slot) => SLOTS[slot][0];

/**
 * The harness's role colours (`DIAGRAMS.md`), which its sources set in `classDef`.
 * Here every role is neutral: the docs give hue to the four run states and to
 * nothing else, and the harness's green "durable state" would read as *done*. The
 * roles stay told apart the way the harness also tells them apart — the focal
 * node's 3px outline (now in ink), the cylinder for state, the dashed border for
 * what Felix calls but does not control, and the 2px outline for where a call
 * can be refused.
 */
const ROLES = {
  '#2f81f7': 'var(--sl-color-white)', // focal
  '#6e7781': 'var(--sl-color-gray-3)', // primary
  '#7d8590': 'var(--sl-color-gray-3)', // external, and subgraph frames
  '#2ea043': 'var(--sl-color-gray-3)', // durable state
  '#d55e00': 'var(--sl-color-gray-2)', // risk
};

/**
 * Colours Mermaid writes whatever the theme says: the filled start dot of a state
 * diagram and the cross marker (black), a sequence actor's attribute defaults, which
 * its own stylesheet then overrides, and an alternate composite state's grey. Each is
 * given the slot it plays, so the audit below can still refuse anything new.
 */
const DEFAULTS = {
  '#000000': 'var(--sl-color-white)',
  '#000': 'var(--sl-color-white)',
  '#e0e0e0': 'none',
  '#eaeaea': 'none',
  '#666': 'var(--sl-color-gray-3)',
  '#999': 'var(--sl-color-hairline)',
};

const CONFIG = {
  theme: 'base',
  // Mermaid draws outlines through a rough-path renderer with a random seed, so two
  // runs over the same source differed in every path. A fixed seed makes a sync
  // with no harness change a no-op, and a diff in this output a real change.
  look: 'classic',
  handDrawnSeed: 1,
  // Labels as SVG text, not HTML in a foreignObject: they then take the page's
  // fill like everything else, and a viewer that cannot render HTML in SVG still
  // reads them.
  htmlLabels: false,
  flowchart: { htmlLabels: false, curve: 'basis', padding: 12 },
  state: { htmlLabels: false },
  sequence: { mirrorActors: false },
  themeVariables: {
    darkMode: false,
    fontFamily: "'Geist Variable', ui-sans-serif, system-ui, sans-serif",
    fontSize: '14px',
    background: s('labelBg'),
    primaryColor: s('fill'),
    secondaryColor: s('fill'),
    tertiaryColor: s('fill'),
    mainBkg: s('fill'),
    primaryTextColor: s('text'),
    secondaryTextColor: s('text'),
    tertiaryTextColor: s('text'),
    textColor: s('text'),
    titleColor: s('text'),
    nodeTextColor: s('text'),
    primaryBorderColor: s('border'),
    secondaryBorderColor: s('border'),
    tertiaryBorderColor: s('border'),
    nodeBorder: s('border'),
    lineColor: s('line'),
    arrowheadColor: s('line'),
    edgeLabelBackground: s('labelBg'),
    clusterBkg: s('fill'),
    clusterBorder: s('cluster'),
    noteBkgColor: s('note'),
    noteBorderColor: s('noteBorder'),
    noteTextColor: s('text'),
    // Sequence diagrams.
    actorBkg: s('fill'),
    actorBorder: s('border'),
    actorTextColor: s('text'),
    // A lifeline carries the diagram's structure, so it takes the line colour (≥3:1), not a hairline.
    actorLineColor: s('line'),
    signalColor: s('line'),
    signalTextColor: s('text'),
    labelBoxBkgColor: s('fill'),
    labelBoxBorderColor: s('border'),
    labelTextColor: s('text'),
    loopTextColor: s('muted'),
    activationBkgColor: s('note'),
    activationBorderColor: s('border'),
    sequenceNumberColor: s('labelBg'),
    // State diagrams.
    stateBkg: s('fill'),
    stateLabelColor: s('text'),
    compositeBackground: s('fill'),
    compositeTitleBackground: s('fill'),
    altBackground: s('fill'),
    transitionColor: s('line'),
    transitionLabelColor: s('muted'),
    specialStateColor: s('text'),
    innerEndBackground: s('text'),
    labelColor: s('text'),
  },
};

/** The font Mermaid measures with must be the one the page draws with. */
const FONT_CSS = `/*felix-font*/@font-face{font-family:'Geist Variable';src:url('file://${GEIST}') format('woff2');font-weight:100 900}/*felix-font-end*/`;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function render(source, name, work) {
  const input = join(work, `${name}.mmd`);
  const output = join(work, `${name}.svg`);
  writeFileSync(input, source);
  sh('npx', [
    '-y',
    MERMAID_CLI,
    '-q',
    '-i',
    input,
    '-o',
    output,
    '-c',
    join(work, 'config.json'),
    '-C',
    join(work, 'font.css'),
    '-b',
    'transparent',
    '--svgId',
    `hd-${name}`,
  ]);
  return readFileSync(output, 'utf8');
}

/** Rewrite every colour to a theme variable; return what could not be placed. */
function retheme(svg) {
  const slotOf = new Map(Object.values(SLOTS).map(([hex, css]) => [hex, css]));
  const unknown = new Set();
  let out = svg
    .replace(/\/\*felix-font\*\/.*?\/\*felix-font-end\*\//gs, '')
    // Mermaid defines drop-shadow filters for its "neo" look. Nothing here uses
    // them, and the docs author no shadow, so they go rather than ship unused.
    .replace(/<filter\b[\s\S]*?<\/filter>/g, '')
    // Role colours reach node styles as rgb(); bring them to hex for the map.
    .replace(
      /rgb\((\d+),\s*(\d+),\s*(\d+)\)/g,
      (_, r, g, b) => `#${[r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`,
    )
    // A width Mermaid pins to the layout box; the component sets the size instead.
    .replace(/ style="max-width: [\d.]+px;[^"]*"/, '')
    .replace(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, (hex) => {
      const key = hex.toLowerCase();
      if (slotOf.has(key)) return slotOf.get(key);
      if (ROLES[key]) return ROLES[key];
      if (DEFAULTS[key]) return DEFAULTS[key];
      unknown.add(key);
      return hex;
    });
  // Named and functional colours Mermaid writes for markers and defaults.
  out = out.replace(
    /(fill|stroke|color|stop-color):\s*(black|white|rgb\([^)]*\)|hsl\([^)]*\))/g,
    (m, _prop, value) => {
      unknown.add(value);
      return m;
    },
  );
  return { svg: out, unknown };
}

function main() {
  const harness = resolve(argv[2] ?? join(homedir(), 'Projects/felix'));
  const sources = join(harness, 'docs/diagrams');
  if (!existsSync(sources)) {
    console.error(`no docs/diagrams in ${harness}`);
    exit(2);
  }
  if (!existsSync(GEIST)) {
    console.error(`Geist not installed at ${GEIST}; run pnpm install`);
    exit(2);
  }
  const commit = sh('git', ['-C', harness, 'rev-parse', 'HEAD']).trim();
  const questions = new Map(
    [
      ...readFileSync(join(harness, 'docs/DIAGRAMS.md'), 'utf8').matchAll(
        /^\| \[`([\w-]+)`\][^|]*\| (.+?) \|$/gm,
      ),
    ].map((m) => [m[1], m[2]]),
  );
  const index = JSON.parse(readFileSync(INDEX, 'utf8'));
  const work = mkdtempSync(join(tmpdir(), 'felix-diagrams-'));
  writeFileSync(join(work, 'config.json'), JSON.stringify(CONFIG));
  writeFileSync(join(work, 'font.css'), FONT_CSS);
  let failed = false;
  try {
    for (const entry of index.diagrams) {
      const path = join(sources, `${entry.name}.mmd`);
      if (!existsSync(path)) {
        console.error(`✗ ${entry.name}: not in ${sources}`);
        failed = true;
        continue;
      }
      let source = readFileSync(path, 'utf8');
      // A chart drawn left to right for a wide screen can be restacked for the
      // column. The harness's source is untouched; only this rendering turns.
      if (entry.direction) {
        source = source
          .replace(/^(flowchart|graph) (LR|RL|TB|TD|BT)\b/m, `$1 ${entry.direction}`)
          // A subgraph's own direction turns with it, or a row inside it stays wide.
          .replace(/^(\s+direction) (LR|RL)\b/gm, `$1 ${entry.direction}`);
      }
      const { svg, unknown } = retheme(render(source, entry.name, work));
      if (unknown.size > 0) {
        console.error(`✗ ${entry.name}: colours with no theme slot: ${[...unknown].join(' ')}`);
        failed = true;
        continue;
      }
      const viewBox =
        svg
          .match(/viewBox="([\d.\s-]+)"/)?.[1]
          .split(/\s+/)
          .map(Number) ?? [];
      writeFileSync(join(OUT_DIR, `${entry.name}.svg`), `${svg.trim()}\n`);
      entry.width = Math.round(viewBox[2] ?? 0);
      entry.height = Math.round(viewBox[3] ?? 0);
      entry.digest = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
      // What the caption says: the question DIAGRAMS.md says this diagram answers,
      // and the code its own second line names as the source of truth.
      entry.title = source.match(/^title:\s*(.+)$/m)?.[1].trim() ?? entry.name;
      entry.question = questions.get(entry.name) ?? '';
      if (!entry.question) {
        console.error(`✗ ${entry.name}: no row in docs/DIAGRAMS.md says what it answers`);
        failed = true;
      }
      entry.source = (source.match(/^%% Source of truth:\s*([\s\S]*?)\n(?!%%)/m)?.[1] ?? '')
        .replace(/\n%%\s*/g, ' ')
        .trim();
      console.log(`✓ ${entry.name}  ${entry.width}×${entry.height}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (failed) exit(1);
  index.harnessCommit = commit;
  writeFileSync(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`rendered from felix-run/felix@${commit.slice(0, 8)}`);
}

main();
