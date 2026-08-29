/**
 * Where the harness is, and how to prove who is asking.
 *
 * The browser client cannot talk to the harness directly — no CORS, no static
 * assets — so it goes through a proxy Worker that holds the credential. Nothing
 * here needs that: this process reaches `FELIX_ORIGIN` itself and sends its own
 * `Authorization: Bearer`, which is why the shared-key gate has no counterpart
 * in this app.
 *
 * Precedence is narrowest first, in the sense of how many runs a source
 * affects: a flag (this one) beats the environment (this shell), which beats
 * the checkout's `.dev.vars` (this clone), which beats `~/.config` (this
 * machine). The point of the last two is that the common case — `pnpm tui:dev`
 * in a checkout, or `felix` anywhere else — needs no arguments at all.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  origin: string;
  apiKey?: string;
  manifest: string;
  /** Skip the confirmation prompt before a client tool writes. */
  yes: boolean;
  /** Resume this thread instead of starting a new one. */
  thread?: string;
  /** Send the key to a plaintext non-loopback origin anyway. */
  insecure: boolean;
}

export const DEFAULT_ORIGIN = 'http://localhost:8080';
export const DEFAULT_MANIFEST = 'quick';

/** `~/.config/felix/config.json`, or `$XDG_CONFIG_HOME/felix/config.json`. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, 'felix', 'config.json');
}

/**
 * The harness key a checkout already has.
 *
 * `apps/chat-ui/.dev.vars` is this repo's one local secrets file — `wrangler
 * dev` reads it, and so does the Vite dev proxy, deliberately, so that local
 * development has one such file rather than two. This client ignoring it made
 * that three: `pnpm tui:dev` 401'd on every call until the key was exported by
 * hand, for no reason a person could see.
 *
 * Located from **this module**, not from the working directory. The TUI runs
 * wherever the user happens to be, and walking up from `cwd` looking for a file
 * full of credentials would read whatever an unrelated parent directory
 * happened to contain. Walking up from the source means it finds the checkout
 * it is part of, or nothing.
 */
export function devVarsPath(from = fileURLToPath(import.meta.url)): string | null {
  let dir = dirname(from);
  // apps/tui/src → apps/tui → apps → <root>, with room for a build layout.
  for (let up = 0; up < 6; up++) {
    const candidate = join(dir, 'apps', 'chat-ui', '.dev.vars');
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // keep climbing
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * `KEY=value` lines, the format wrangler and the dev proxy already agree on.
 *
 * Only the three names this client understands are read; everything else in
 * that file belongs to the harness or the Worker and is none of its business.
 */
export function readDevVars(path: string | null = devVarsPath()): Partial<Config> {
  if (!path) return {};
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const values = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (value) values.set(key, value);
  }
  // `FELIX_AUTH_API_KEYS` is the harness's own spelling of the same secret, and
  // what `make up` writes — the dev proxy accepts it for that reason, so this
  // does too.
  const apiKey = values.get('FELIX_API_KEY') ?? values.get('FELIX_AUTH_API_KEYS');
  const origin = values.get('FELIX_ORIGIN');
  return { ...(apiKey ? { apiKey } : {}), ...(origin ? { origin } : {}) };
}

/** Missing or unreadable is not an error: the file is a convenience, not a requirement. */
export function readConfigFile(path: string): Partial<Config> {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const pick = (key: string) =>
      typeof parsed[key] === 'string' ? (parsed[key] as string) : undefined;
    return {
      ...(pick('origin') ? { origin: pick('origin') as string } : {}),
      ...(pick('apiKey') ? { apiKey: pick('apiKey') as string } : {}),
      ...(pick('manifest') ? { manifest: pick('manifest') as string } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Flags that never take a value.
 *
 * Without this, `felix --yes explain the worker` reads "explain" as the value of
 * `--yes` and sends "the worker" — a message quietly missing its first word,
 * which is worse than an error.
 */
const SWITCHES = new Set(['yes', 'help', 'h', 'insecure']);

export interface ParsedArgs {
  flags: Record<string, string | true>;
  /** Anything left over: the first message, sent as soon as the app starts. */
  rest: string[];
}

/** `--origin http://…`, `--origin=http://…`, `--yes`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s);
    if (!name) continue;
    if (inline !== undefined) {
      flags[name] = inline;
      continue;
    }
    const next = argv[i + 1];
    if (!SWITCHES.has(name) && next && !next.startsWith('--')) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return { flags, rest };
}

/** The file readers, injectable so a test never depends on the machine it runs on. */
export interface ConfigSources {
  /** `~/.config/felix/config.json`. */
  userConfig?: (path: string) => Partial<Config>;
  /** The checkout's `apps/chat-ui/.dev.vars`, if this is running from one. */
  devVars?: () => Partial<Config>;
}

export function resolveConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  sources: ConfigSources = {},
): { config: Config; firstMessage?: string } {
  const { flags, rest } = parseArgs(argv);
  const file = (sources.userConfig ?? readConfigFile)(configPath(env));
  const dev = (sources.devVars ?? (() => readDevVars()))();
  const str = (name: string) =>
    typeof flags[name] === 'string' ? (flags[name] as string) : undefined;

  const origin =
    str('origin') ?? env.FELIX_ORIGIN?.trim() ?? dev.origin ?? file.origin ?? DEFAULT_ORIGIN;
  // `FELIX_AUTH_API_KEYS` is the harness's own spelling of the same secret, and
  // it is what people carry across from a compose file. Accepted for the same
  // reason the dev proxy accepts it.
  const apiKey =
    str('key') ??
    env.FELIX_API_KEY?.trim() ??
    env.FELIX_AUTH_API_KEYS?.trim() ??
    dev.apiKey ??
    file.apiKey;

  return {
    config: {
      origin: origin.replace(/\/+$/, ''),
      ...(apiKey ? { apiKey } : {}),
      manifest: str('manifest') ?? env.FELIX_MANIFEST?.trim() ?? file.manifest ?? DEFAULT_MANIFEST,
      yes: flags.yes === true || flags.yes === 'true',
      insecure: flags.insecure === true || flags.insecure === 'true',
      ...(str('thread') ? { thread: str('thread') } : {}),
    },
    ...(rest.length ? { firstMessage: rest.join(' ') } : {}),
  };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Refuse to send a bearer token in cleartext to somewhere off this machine.
 *
 * The harness takes the same position about itself — it will not start with
 * `FELIX_AUTH_MODE=none` on a bind that is reachable off-host — and the mirror
 * of that here is not putting the key on the wire unencrypted. Loopback is fine
 * (that is the whole local development story), and `--insecure` exists for an
 * operator who knows their link is private.
 *
 * Returns the reason to refuse, or null.
 */
export function insecureOrigin(config: Config): string | null {
  if (!config.apiKey || config.insecure) return null;
  let url: URL;
  try {
    url = new URL(config.origin);
  } catch {
    return `${config.origin} is not a URL.`;
  }
  if (url.protocol === 'https:' || LOOPBACK.has(url.hostname)) return null;
  return `${config.origin} is plaintext http and not loopback, so the API key would cross the network in the clear. Use https, or pass --insecure if the link is private.`;
}

/** Bearer, the way the harness's `api_key` mode expects it. */
export function authHeaders(config: Config): Record<string, string> {
  return config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {};
}

export const USAGE = `felix — Felix in the terminal

usage: felix [options] [message]

  --origin <url>      harness origin (default ${DEFAULT_ORIGIN}, or FELIX_ORIGIN)
  --key <key>         API key (or FELIX_API_KEY)
  --manifest <name>   agent manifest (default ${DEFAULT_MANIFEST})
  --thread <id>       resume a thread instead of starting a new one
  --yes               do not ask before a client tool writes a file
  --insecure          allow the key over plaintext http to a remote origin
  --help              this

The key is read from the environment or a file by preference: an argument to
--key is visible in ps(1) to every user on this machine.

Sources, in order: flag, environment, the checkout's apps/chat-ui/.dev.vars
(when running from one), then ~/.config/felix/config.json —
{"origin":…,"apiKey":…,"manifest":…}
`;
