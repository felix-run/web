#!/usr/bin/env node
/**
 * Fetch the OpenAPI document for the harness version production runs.
 *
 * The harness's own `/docs` sits behind its credential, so the public reference
 * lives here, at `/reference/`. It has to describe what `api.felix.run` serves —
 * not a checkout, and not `apps/chat-ui/harness-openapi.json`, which records a
 * checkout for `check-api-drift` and is routinely ahead of the deployment. So:
 *
 *   GET  $FELIX_ORIGIN/health                         → {"version": "0.4.0"}
 *   GET  github.com/felix-run/felix/releases/download/v0.4.0/openapi.json
 *
 * Every release attaches that file (felix `release.yml`, `scripts/export-openapi.py`).
 * Writes `public/openapi.json` and `public/api-version.txt`, both gitignored; the
 * second is what the freshness check compares against `/health` after a deploy.
 *
 * Any failure fails the build: an empty reference is worse than a stale deploy.
 *
 *   FELIX_OPENAPI_SPEC=path   use a local file instead (offline, CI)
 *   FELIX_ORIGIN=url          the harness to ask (default https://api.felix.run)
 *   --soft                    warn instead of failing (used by `dev`)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argv, env, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const RELEASES = 'https://github.com/felix-run/felix/releases/download';
const origin = (env.FELIX_ORIGIN || 'https://api.felix.run').replace(/\/+$/, '');
const soft = argv.includes('--soft');

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch((err) => {
    throw new Error(`${url}: ${err.cause?.message ?? err.message}`);
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function load() {
  if (env.FELIX_OPENAPI_SPEC) {
    const spec = JSON.parse(readFileSync(resolve(env.FELIX_OPENAPI_SPEC), 'utf8'));
    return { spec, version: spec.info?.version, source: env.FELIX_OPENAPI_SPEC };
  }
  const { version } = await getJson(`${origin}/health`);
  if (!version) throw new Error(`${origin}/health reported no version`);
  const url = `${RELEASES}/v${version}/openapi.json`;
  const spec = await getJson(url).catch((err) => {
    throw new Error(`${err.message} — does the v${version} release carry openapi.json?`);
  });
  if (spec.info?.version !== version) {
    throw new Error(`${url} describes ${spec.info?.version}, but ${origin} runs ${version}`);
  }
  return { spec, version, source: url };
}

try {
  const { spec, version, source } = await load();
  const paths = Object.keys(spec.paths ?? {}).length;
  if (!String(spec.openapi).startsWith('3.') || paths === 0) {
    throw new Error(`${source} is not an OpenAPI 3 document with paths`);
  }
  mkdirSync(PUBLIC, { recursive: true });
  writeFileSync(join(PUBLIC, 'openapi.json'), JSON.stringify(spec));
  writeFileSync(join(PUBLIC, 'api-version.txt'), `${version}\n`);
  console.log(`api reference: v${version}, ${paths} paths, from ${source}`);
} catch (err) {
  console.error(`api reference: ${err.message}`);
  if (!soft) exit(1);
  console.warn('api reference: continuing without it; /reference/ will show an error');
}
