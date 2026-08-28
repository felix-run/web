/**
 * Entry point: resolve where the harness is, then hand over to Ink.
 *
 * `--help` and a non-TTY stdout are handled before anything renders — a
 * full-screen app piped into a file produces neither output nor an error, and
 * saying so is more useful than drawing to nowhere.
 */
import { render } from 'ink';
import { App } from './app.js';
import { insecureOrigin, resolveConfig, USAGE } from './config.js';
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
  process.stderr.write('felix: this is a full-screen terminal client and needs a TTY.\n');
  process.exit(1);
}

const { waitUntilExit } = render(
  <App
    config={config}
    store={createThreadStore()}
    root={process.cwd()}
    {...(firstMessage ? { firstMessage } : {})}
  />,
);

await waitUntilExit();
