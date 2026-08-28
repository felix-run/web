/**
 * Where the harness is, and how to prove who is asking.
 *
 * The browser client cannot talk to the harness directly — no CORS, no static
 * assets — so it goes through a proxy Worker that holds the credential. Nothing
 * here needs that: this process reaches `FELIX_ORIGIN` itself and sends its own
 * `Authorization: Bearer`, which is why the shared-key gate has no counterpart
 * in this app.
 *
 * Precedence, narrowest first: a flag beats the environment, and the
 * environment beats the config file. The file exists so the common case is
 * `felix` with no arguments.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

export function resolveConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => Partial<Config> = readConfigFile,
): { config: Config; firstMessage?: string } {
  const { flags, rest } = parseArgs(argv);
  const file = readFile(configPath(env));
  const str = (name: string) =>
    typeof flags[name] === 'string' ? (flags[name] as string) : undefined;

  const origin = str('origin') ?? env.FELIX_ORIGIN?.trim() ?? file.origin ?? DEFAULT_ORIGIN;
  // `FELIX_AUTH_API_KEYS` is the harness's own spelling of the same secret, and
  // it is what people carry across from a compose file. Accepted for the same
  // reason the dev proxy accepts it.
  const apiKey =
    str('key') ?? env.FELIX_API_KEY?.trim() ?? env.FELIX_AUTH_API_KEYS?.trim() ?? file.apiKey;

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

The key is read from the environment or the config file by preference: an
argument to --key is visible in ps(1) to every user on this machine.

Config file: ~/.config/felix/config.json — {"origin":…,"apiKey":…,"manifest":…}
`;
