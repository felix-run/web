/**
 * Entry point: resolve where the harness is, then hand over to the renderer.
 *
 * `--help` and a non-TTY stdout are handled before anything renders — a
 * full-screen app piped into a file produces neither output nor an error, and
 * saying so is more useful than drawing to nowhere.
 *
 * The non-TTY message names the fix rather than only the fact. This fires most
 * often when nothing is wrong with the terminal at all: the command was run
 * somewhere that captures output — an editor's task pane, a coding agent's
 * shell, a CI step — and "needs a TTY" leaves a person to work out what to do
 * about that on their own.
 */
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './app.js';
import { createAttention } from './attention.js';
import { insecureOrigin, resolveConfig, USAGE } from './config.js';
import type { EpilogueSlot } from './epilogue.js';
import { createPromptHistory } from './history.js';
import { createThreadStore } from './threads.js';

const { config, firstMessage } = resolveConfig(process.argv.slice(2));

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const insecure = insecureOrigin(config);
if (insecure) {
  process.stderr.write(`felix: ${insecure}\n`);
  process.exit(1);
}

if (!process.stdout.isTTY) {
  process.stderr.write(
    'felix: this is a full-screen client, and output here is being captured rather than\n' +
      'drawn to a terminal — a pipe, a CI step, or an editor or agent shell that collects\n' +
      'what a command prints.\n\n' +
      'Run it in a terminal directly: `pnpm tui:dev` from the repo root.\n',
  );
  process.exit(1);
}

/**
 * Nothing is written to the terminal here: `App` asks for focus reporting once
 * the renderer has raw mode on, because before that the tty echoes the
 * terminal's reply onto the screen. Reading the reply is the renderer's job now
 * — this only needs somewhere to write the title and the bell.
 */
const attention = createAttention({
  stdout: process.stdout,
  enabled: !process.env.FELIX_NO_NOTIFY,
});

const epilogue: EpilogueSlot = {};

const renderer = await createCliRenderer({
  // ctrl+c is ambiguous while a run is live — `App` stops the run on the first
  // press and leaves on the second, which it cannot do if the renderer exits
  // first.
  exitOnCtrlC: false,
  // The only way a terminal reports shift+Enter, which is how a second line
  // gets written without handing the whole prompt to `$EDITOR`.
  useKittyKeyboard: {},
});

const root = createRoot(renderer);

/**
 * Leaving, in the one order that works.
 *
 * The title and the focus request have to be undone while the terminal is still
 * ours, and the epilogue has to be written after the screen is given back —
 * otherwise the alternate screen takes it with it, and the thread id it carries
 * is the only record of which thread was open.
 */
const exit = () => {
  attention.dispose();
  root.unmount();
  renderer.destroy();
  if (epilogue.text) process.stdout.write(`${epilogue.text}\n`);
  process.exit(0);
};

root.render(
  <App
    config={config}
    store={createThreadStore()}
    history={createPromptHistory()}
    attention={attention}
    epilogue={epilogue}
    root={process.cwd()}
    onExit={exit}
    {...(firstMessage ? { firstMessage } : {})}
  />,
);
