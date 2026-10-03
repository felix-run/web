/**
 * `plugin.json` at a bundle's root, and its per-skill egress allowlist — the
 * harness's `felix/skills/plugin.py`, checked by hand rather than through a
 * schema library, so the editor carries no validator runtime for one file.
 */

/**
 * One optional leftmost-wildcard label, then two or more dot-separated labels.
 * Accepts `api.stripe.com` and `*.example.com`; rejects catch-alls (`*`, `*.*`)
 * and TLD-wide wildcards (`*.com`), which would let a skill self-grant
 * effectively unrestricted egress.
 */
const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export const HOST_MESSAGE =
  'must be a concrete host or specific wildcard (e.g. api.example.com or *.example.com); ' +
  'catch-all and TLD-wide patterns are not allowed';

export function isAllowedHostPattern(host: unknown): boolean {
  if (typeof host !== 'string') return false;
  const h = host.trim().toLowerCase();
  if (h.length === 0 || h.length > 253) return false;
  return HOST_PATTERN.test(h);
}

export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  skills: string[];
  agents?: string[];
  rules?: string[];
  mcp?: { servers?: { name: string; command?: string; url?: string }[] };
  network?: { allowedHosts?: string[] };
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || v === null || isStr(v);
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Why `value` is not a plugin manifest the harness would accept, or null. */
export function pluginManifestProblem(value: unknown): string | null {
  if (!isObj(value)) return 'plugin.json must be a JSON object';
  const { name, version, description, skills, agents, rules, mcp, network } = value;
  if (!isStr(name) || name.length < 1 || name.length > 128) {
    return 'name must be 1-128 characters';
  }
  if (!optStr(version) || !optStr(description)) return 'version and description must be strings';
  if (skills !== undefined && !strList(skills)) return 'skills must be a list of strings';
  if (rules !== undefined && rules !== null && !strList(rules)) {
    return 'rules must be a list of strings';
  }
  if (agents !== undefined && agents !== null) {
    if (!strList(agents)) return 'agents must be a list of strings';
    if (agents.some((a) => a.length < 1 || a.length > 64)) {
      return 'agent names must be 1-64 characters';
    }
  }
  if (mcp !== undefined && mcp !== null) {
    if (!isObj(mcp)) return 'mcp must be an object';
    const servers = mcp.servers;
    if (servers !== undefined && servers !== null) {
      if (!Array.isArray(servers)) return 'mcp.servers must be a list';
      for (const s of servers) {
        if (!isObj(s) || !isStr(s.name) || !optStr(s.command) || !optStr(s.url)) {
          return 'each mcp server needs a name';
        }
        if (isStr(s.url) && !/^[a-z][a-z0-9+.-]*:\S+/i.test(s.url)) return 'Invalid url';
      }
    }
  }
  if (network !== undefined && network !== null) {
    if (!isObj(network)) return 'network must be an object';
    const hosts = network.allowedHosts;
    if (hosts !== undefined && hosts !== null) {
      if (!strList(hosts)) return 'network.allowedHosts must be a list of strings';
      if (hosts.length > 50) return 'network.allowedHosts may hold at most 50 hosts';
      const bad = hosts.find((h) => !isAllowedHostPattern(h));
      if (bad !== undefined) return `'${bad}' ${HOST_MESSAGE}`;
    }
  }
  return null;
}

/** The parsed manifest, or null when `raw` is not JSON or does not validate. */
export function parsePluginManifest(raw: string): PluginManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (pluginManifestProblem(parsed) !== null) return null;
  const v = parsed as PluginManifest & { skills?: string[] };
  return { ...v, skills: v.skills ?? ['SKILL.md'] };
}
