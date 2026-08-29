/**
 * Entry point: resolve where the harness is, then hand over to Ink.
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
import { render } from 'ink';
import { App } from './app.js';
import { insecureOrigin, resolveConfig, USAGE } from './config.js';
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

const { waitUntilExit } = render(
  <App
    config={config}
    store={createThreadStore()}
    history={createPromptHistory()}
    root={process.cwd()}
    {...(firstMessage ? { firstMessage } : {})}
  />,
);

await waitUntilExit();
