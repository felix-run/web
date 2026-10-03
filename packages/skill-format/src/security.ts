/**
 * A heuristic security scan: pass, advisory or fail, plus a score —
 * `felix/skills/security.py`, rule for rule.
 *
 * Any critical or high finding fails the scan; a medium one makes it advisory.
 * The cost is bounded the way the harness bounds it: a file over
 * `MAX_FILE_CHARS` is reported for its size and not pattern-matched, and no
 * pattern has an unbounded wildcard, so a long line cannot backtrack.
 *
 * The harness's verdict is the one a publish is decided on. This one is what
 * the editor shows before a save, and it can only be as current as this copy.
 */

import { isBinaryAssetPath } from './binary';
import type { SkillBundle } from './format';
import { parsePluginManifest } from './plugin';

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type ScanStatus = 'pass' | 'advisory' | 'fail';

export interface SecurityIssue {
  severity: Severity;
  path: string;
  message: string;
  ruleId?: string;
}

export interface SecurityScanResult {
  status: ScanStatus;
  issues: SecurityIssue[];
  score: number;
}

interface Rule {
  ruleId: string;
  re: RegExp;
  message: string;
  severity: Severity;
}

const CREDENTIAL_RULES: Rule[] = [
  { ruleId: 'cred-aws', re: /AKIA[0-9A-Z]{16}/, message: 'Possible AWS access key' },
  { ruleId: 'cred-stripe', re: /sk_live_[a-zA-Z0-9]+/, message: 'Possible Stripe live secret' },
  {
    ruleId: 'cred-ghp',
    re: /ghp_[a-zA-Z0-9]{36}/,
    message: 'Possible GitHub personal access token',
  },
  { ruleId: 'cred-slack', re: /xox[baprs]-[a-zA-Z0-9-]+/, message: 'Possible Slack token' },
  {
    ruleId: 'cred-pem',
    re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    message: 'Private key material detected',
  },
  { ruleId: 'cred-openai', re: /sk-[a-zA-Z0-9]{20,}/, message: 'Possible OpenAI-style API key' },
].map((r) => ({ ...r, severity: 'critical' as const }));

const SCRIPT_RULES: Rule[] = [
  { ruleId: 'script-eval', re: /\beval\s*\(/, message: 'eval() usage', severity: 'high' },
  {
    ruleId: 'script-child-process',
    re: /child_process/,
    message: 'child_process usage',
    severity: 'medium',
  },
  { ruleId: 'script-exec', re: /\bexec\s*\(/, message: 'exec() usage', severity: 'medium' },
  {
    ruleId: 'script-rm-rf',
    re: /rm\s+-rf\s+\//,
    message: 'Destructive rm -rf / pattern',
    severity: 'critical',
  },
  {
    ruleId: 'script-pipe-bash',
    re: /curl\s+[^\n]{0,500}\|\s*(ba)?sh/,
    message: 'Remote script piped to shell',
    severity: 'critical',
  },
  {
    ruleId: 'script-wget-sh',
    re: /wget\s+[^\n]{0,500}\|\s*(ba)?sh/,
    message: 'Remote script piped to shell',
    severity: 'critical',
  },
  {
    ruleId: 'script-base64-exec',
    re: /base64\s+(-d|--decode)[^\n]{0,500}\|/,
    message: 'Base64-decoded payload execution',
    severity: 'high',
  },
];

const PROMPT_INJECTION_RULES: Rule[] = [
  {
    ruleId: 'pi-ignore',
    re: /ignore (all )?(previous|prior) instructions/i,
    message: 'Possible prompt-injection: ignore previous instructions',
  },
  {
    ruleId: 'pi-disregard',
    re: /disregard (your|the) (system|safety)/i,
    message: 'Possible prompt-injection: disregard system/safety',
  },
  {
    ruleId: 'pi-roleplay',
    re: /you are now (in )?(DAN|developer mode|unrestricted)/i,
    message: 'Possible prompt-injection: role override',
  },
  {
    ruleId: 'pi-exfil',
    re: /send (all |the )?(secrets?|credentials?|api keys?) (to|via)/i,
    message: 'Possible data-exfiltration instruction',
  },
].map((r) => ({ ...r, severity: 'high' as const }));

const OBFUSCATION_RULES: Rule[] = [
  {
    ruleId: 'obf-long-hex',
    re: /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){20,}/i,
    message: 'Long hex-escaped sequence (possible obfuscation)',
  },
  {
    ruleId: 'obf-fromcharcode',
    re: /String\.fromCharCode\s*\(\s*\d+(\s*,\s*\d+){10,}/,
    message: 'String.fromCharCode obfuscation pattern',
  },
].map((r) => ({ ...r, severity: 'high' as const }));

const SCRIPT_EXT_RE = /\.(sh|bash|py|js|mjs|cjs|ts)$/;
const URL_RE = /https?:\/\/[^\s)"']+/g;
const LOCAL_URL_RE = /localhost|127\.0\.0\.1|0\.0\.0\.0/;
const EXECUTABLE_URL_RE = /\.(zip|exe|dmg|pkg|sh|bat)(\?|$)/i;
const RAW_CONTENT_HOST_RE = /raw\.githubusercontent\.com|gist\.githubusercontent\.com/i;
export const MAX_FILE_CHARS = 512_000;
const PENALTY: Record<Severity, number> = { critical: 40, high: 25, medium: 10, low: 3 };

function matches(rules: Rule[], path: string, content: string): SecurityIssue[] {
  return rules
    .filter((r) => r.re.test(content))
    .map((r) => ({ severity: r.severity, path, message: r.message, ruleId: r.ruleId }));
}

function urlIssues(path: string, content: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  for (const url of content.match(URL_RE) ?? []) {
    if (LOCAL_URL_RE.test(url)) continue;
    if (EXECUTABLE_URL_RE.test(url)) {
      issues.push({
        severity: 'medium',
        path,
        message: `External executable URL: ${url.slice(0, 80)}`,
        ruleId: 'url-executable',
      });
    }
    if (RAW_CONTENT_HOST_RE.test(url) && content.includes('|')) {
      issues.push({
        severity: 'medium',
        path,
        message: 'Fetches remote content that may be piped to a shell',
        ruleId: 'url-remote-pipe-risk',
      });
    }
  }
  return issues;
}

function fileIssues(path: string, content: string): SecurityIssue[] {
  if ([...content].length > MAX_FILE_CHARS) {
    return [
      {
        severity: 'medium',
        path,
        message: 'File exceeds 512KB — unusually large for a skill',
        ruleId: 'size-large',
      },
    ];
  }
  const issues = matches(CREDENTIAL_RULES, path, content);
  if (path.startsWith('scripts/') || SCRIPT_EXT_RE.test(path)) {
    issues.push(...matches(SCRIPT_RULES, path, content));
  }
  issues.push(...matches(PROMPT_INJECTION_RULES, path, content));
  issues.push(...matches(OBFUSCATION_RULES, path, content));
  issues.push(...urlIssues(path, content));
  return issues;
}

/** The heuristic baseline scan — no external dependency. */
export function scanSkillSecurity(files: SkillBundle): SecurityScanResult {
  const issues: SecurityIssue[] = [];
  for (const [path, content] of Object.entries(files)) {
    // Base64 asset text is not source; pattern-matching it only finds false positives.
    if (!isBinaryAssetPath(path)) issues.push(...fileIssues(path, content));
  }
  // A declared egress allowlist is surfaced, never blocking: whether a skill
  // should reach a host is a reviewer's judgement, not a mechanical fail.
  const pluginRaw = files['plugin.json'];
  const hosts = (pluginRaw ? parsePluginManifest(pluginRaw)?.network?.allowedHosts : null) ?? [];
  if (hosts.length > 0) {
    issues.push({
      severity: 'low',
      path: 'plugin.json',
      message: `Declares outbound network access to: ${hosts.join(', ')}`,
      ruleId: 'network-egress-declared',
    });
  }
  const severities = new Set(issues.map((i) => i.severity));
  const status: ScanStatus =
    severities.has('critical') || severities.has('high')
      ? 'fail'
      : severities.has('medium')
        ? 'advisory'
        : 'pass';
  const score = 100 - issues.reduce((s, i) => s + PENALTY[i.severity], 0);
  return { status, issues, score: Math.max(0, Math.min(100, score)) };
}
