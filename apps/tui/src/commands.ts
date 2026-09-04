/**
 * The slash commands — this client's whole surface onto the harness.
 *
 * `@felix/client` reaches every chat verb the harness serves, and a slash
 * command is the only thing that exposes one here: a verb with no `case` below
 * is a verb this client does not have.
 *
 * Lifted out of `app.tsx` as a plain function over an explicit context rather
 * than a hook, because the thing that made it untestable was that it closed
 * over a dozen values from a component. Two of them are read through functions
 * (`threadId`, `threads`) rather than passed as values: the previous version
 * listed `threads` in a dependency array, so every thread refresh rebuilt the
 * callback, which rebuilt `submit`, which changed the dependency of the effect
 * that sends the first message from argv. A `sentFirst` ref made that benign; it
 * was still a loaded gun.
 *
 * `fs` is a seam for the same reason. `/export` refusing to clobber an existing
 * file is a rule about not destroying someone's only transcript, and it should
 * be assertable without touching a disk.
 */

import { resolve } from 'node:path';
import type { ChatEngine, FelixClient, ThreadMeta } from '@felix/client';
import { threadSuffix } from '@felix/client';
import type { ThinkingLevel } from '@felix/protocol';
import type { Config } from './config.js';
import { explainError } from './errors.js';
import { oneLine } from './text.js';
import type { ThreadStore } from './threads.js';

const THINKING: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Search hits shown at once. A notice is a few lines, not a panel. */
const SEARCH_LIMIT = 5;

export const HELP = [
  '/new /clear /continue /think <level> /manifest [name] /quit',
  '/rename <name> /fork /compact /export [file] /rewind [n]',
  '/search <text> /open <n|thread-id> /refresh',
].join('\n');

/** A hit, a title, a path — one line each, because a notice is one line each. */
const NOTICE_WIDTH = 60;

/** What a command may reach. Everything it needs, and nothing it does not. */
export interface CommandContext {
  client: FelixClient;
  engine: ChatEngine;
  store: ThreadStore;
  config: Config;
  root: string;
  manifest: string;
  setManifest(name: string): void;
  setNotice(text: string | null): void;
  /** Read through a function, so a refresh does not rebuild the caller. */
  threadId(): string;
  threads(): ThreadMeta[];
  /** Thread ids from the last `/search`, so `/open 2` means something. */
  hits: { current: string[] };
  selectThread(id: string): void;
  refreshThreads(): Promise<void>;
  hydrate(id: string): Promise<void>;
  newThread(): void;
  exit(): void;
  /** The disk, as a seam — see the header. */
  fs: {
    exists(path: string): boolean;
    write(path: string, body: string, opts: { encoding: 'utf8'; mode: number }): void;
  };
}

export function runCommand(ctx: CommandContext, line: string): void {
  // Bound to the context under the names the switch already used, so the body
  // below is the one that shipped rather than a re-typing of it.
  const threadIdRef = {
    get current() {
      return ctx.threadId();
    },
  };
  const threads = ctx.threads();
  const hitsRef = ctx.hits;
  const existsSync = ctx.fs.exists;
  const writeFileSync = ctx.fs.write;
  const {
    client,
    config,
    engine,
    exit,
    hydrate,
    manifest,
    newThread,
    refreshThreads,
    root,
    selectThread,
    setManifest,
    setNotice,
    store,
  } = ctx;

  const [name, ...rest] = line.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  switch (name) {
    case 'new':
      newThread();
      return;
    case 'clear':
      engine.reset();
      void client.deleteThreadHistory(threadIdRef.current);
      return;
    case 'continue':
      void client
        .continueChat({ threadId: threadIdRef.current, manifest })
        .catch((err) => engine.setError(explainError(err, 'continue the run', config)));
      return;
    case 'think': {
      const level = THINKING.find((l) => l === arg);
      if (!level) {
        setNotice(`thinking levels: ${THINKING.join(' ')}`);
        return;
      }
      void client
        .setThinkingLevel({
          threadId: threadIdRef.current,
          thinkingLevel: level,
        })
        .then(() => setNotice(`thinking: ${level}`))
        .catch((err) => engine.setError(explainError(err, 'set the thinking level', config)));
      return;
    }
    case 'manifest':
      if (!arg) {
        void client
          .listManifests()
          .then((names) => setNotice(`manifests: ${names.join(' ')}`))
          .catch(() => setNotice('could not list manifests'));
        return;
      }
      setManifest(arg);
      setNotice(`manifest: ${arg}`);
      return;
    case 'rename': {
      if (!arg) {
        setNotice('usage: /rename <name>');
        return;
      }
      const id = threadIdRef.current;
      void client
        .renameSession(id, arg)
        .then(() => {
          // The harness owns the name; the local index is what draws the
          // rail when it cannot be reached, so both are told.
          store.index({ id, manifest, title: arg, updatedAt: Date.now() });
          setNotice(`renamed: ${arg}`);
          return refreshThreads();
        })
        .catch((err) => engine.setError(explainError(err, 'rename this thread', config)));
      return;
    }
    case 'fork': {
      // Unlike a rewind, the original is untouched: this is for taking the
      // conversation a second way while keeping the first.
      const newId = crypto.randomUUID();
      const title = threads.find((t) => t.id === threadIdRef.current)?.title ?? 'Conversation';
      void client
        .forkSession({ threadId: threadIdRef.current, newThreadId: newId })
        .then(async () => {
          store.index({
            id: newId,
            manifest,
            title: `${title} (copy)`,
            updatedAt: Date.now(),
          });
          await refreshThreads();
          selectThread(newId);
          setNotice('forked — the original is untouched');
        })
        .catch((err) => engine.setError(explainError(err, 'fork this thread', config)));
      return;
    }
    case 'compact':
      void client
        .compactSession(threadIdRef.current, manifest)
        .then(() => setNotice('context compacted'))
        .catch((err) => engine.setError(explainError(err, 'compact this thread', config)));
      return;
    case 'export': {
      const target = resolve(root, arg || `felix-${threadIdRef.current}.jsonl`);
      // Refusing beats clobbering: the argument is a path typed once, and
      // the transcript it would overwrite may be the only copy.
      if (existsSync(target)) {
        setNotice(`${target} already exists`);
        return;
      }
      void client
        .exportSession(threadIdRef.current)
        .then((jsonl) => {
          writeFileSync(target, jsonl, { encoding: 'utf8', mode: 0o600 });
          setNotice(`exported: ${target}`);
        })
        .catch((err) => engine.setError(explainError(err, 'export this thread', config)));
      return;
    }
    case 'rewind': {
      // Server event ids arrive with a snapshot and are never minted
      // locally, so a thread streamed in this process has none until it is
      // hydrated. Do that first rather than reporting an empty transcript.
      const back = Math.max(1, Number.parseInt(arg, 10) || 1);
      void hydrate(threadIdRef.current)
        .then(() => {
          const rebuilt = engine.state.turns;
          const target = rebuilt[rebuilt.length - 1 - back];
          if (!target?.eventId) {
            setNotice(`nothing ${back} turn(s) back to rewind to`);
            return;
          }
          return client
            .rewindChat({
              threadId: threadIdRef.current,
              eventId: target.eventId,
              summarize: false,
              manifest,
            })
            .then(() => hydrate(threadIdRef.current))
            .then(() => setNotice(`rewound — ${back} turn(s) off the active branch`));
        })
        .catch((err) => engine.setError(explainError(err, 'rewind this thread', config)));
      return;
    }
    case 'search': {
      if (!arg) {
        setNotice('usage: /search <text>');
        return;
      }
      void client
        .searchSessions(arg, SEARCH_LIMIT)
        .then((rows) => {
          // Hits carry the wire id `{tenant}:{suffix}`; a client sends and
          // stores the suffix, and the harness rejects anything else.
          const hits = rows.map((row) => ({
            id: threadSuffix(row.thread_id),
            snippet: row.content,
          }));
          hitsRef.current = hits.map((hit) => hit.id);
          setNotice(
            hits.length
              ? [
                  'hits — /open <n> to switch',
                  ...hits.map(
                    (hit, i) =>
                      `${i + 1}) ${threads.find((t) => t.id === hit.id)?.title ?? hit.id} · ${oneLine(hit.snippet, NOTICE_WIDTH)}`,
                  ),
                ].join('\n')
              : `nothing matched ${arg}`,
          );
        })
        .catch((err) => engine.setError(explainError(err, 'search your threads', config)));
      return;
    }
    case 'open': {
      const index = Number.parseInt(arg, 10);
      const id = Number.isInteger(index) ? hitsRef.current[index - 1] : arg;
      if (!id) {
        setNotice('usage: /open <n from the last /search, or a thread id>');
        return;
      }
      selectThread(id);
      return;
    }
    case 'refresh':
      // This process is not the only client writing to the harness — a
      // thread started in another window exists, and until this runs the
      // rail has no way to have heard of it.
      void refreshThreads().then(() => setNotice('threads refreshed'));
      return;
    case 'quit':
      exit();
      return;
    default:
      setNotice(HELP);
  }
}
