/**
 * Thread persistence, the terminal's equivalent of chat-ui's localStorage.
 *
 * The harness owns which threads exist and what they are named; it does not
 * record which manifest a thread used, and a thread that never reached it —
 * offline, or against another deployment — exists only here. So this is a cache
 * *and* the only copy of some things, which is exactly the split `mergeSessions`
 * is written for.
 *
 * One JSON file per thread under the XDG state directory, plus an index. Same
 * shape as the browser's two keys, for the same reason: the index is read to
 * draw a list, the transcripts are not.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ThreadMeta, Turn } from '@felix/client';

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_STATE_HOME?.trim() || join(homedir(), '.local', 'state');
  return join(base, 'felix');
}

export interface ThreadStore {
  list(): ThreadMeta[];
  loadTurns(threadId: string): Turn[];
  saveTurns(threadId: string, turns: Turn[]): void;
  index(meta: ThreadMeta): void;
  remove(threadId: string): void;
}

/**
 * Every write is best-effort. A read-only home directory is a reason to lose
 * history, never a reason to fail to answer a question.
 */
export function createThreadStore(dir = stateDir()): ThreadStore {
  const indexPath = join(dir, 'threads.json');
  const turnsPath = (id: string) => join(dir, 'threads', `${encodeURIComponent(id)}.json`);

  const readJson = <T>(path: string, fallback: T): T => {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch {
      return fallback;
    }
  };
  const writeJson = (path: string, value: unknown) => {
    try {
      // 0700/0600: a transcript is the conversation, and conversations carry
      // whatever the agent read out of the working directory. The default umask
      // would leave them world-readable on a shared machine.
      mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(path, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    } catch {
      // no history is better than no client
    }
  };

  return {
    list: () => readJson<ThreadMeta[]>(indexPath, []).sort((a, b) => b.updatedAt - a.updatedAt),
    loadTurns: (threadId) => readJson<Turn[]>(turnsPath(threadId), []),
    saveTurns: (threadId, turns) => {
      if (turns.length) writeJson(turnsPath(threadId), turns);
    },
    index: (meta) => {
      const next = readJson<ThreadMeta[]>(indexPath, []).filter((t) => t.id !== meta.id);
      next.push(meta);
      writeJson(indexPath, next);
    },
    remove: (threadId) => {
      writeJson(
        indexPath,
        readJson<ThreadMeta[]>(indexPath, []).filter((t) => t.id !== threadId),
      );
      try {
        rmSync(turnsPath(threadId));
      } catch {
        // already gone
      }
    },
  };
}

/** Present only so a stale state directory can be inspected from a test. */
export function listStateFiles(dir = stateDir()): string[] {
  try {
    return readdirSync(join(dir, 'threads'));
  } catch {
    return [];
  }
}
