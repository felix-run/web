/**
 * Felix in the terminal.
 *
 * Everything the conversation *is* — frames, transcript, tool cards, approvals,
 * durable runs, reattach — belongs to `@felix/client`. This file is the part a
 * terminal has to answer for itself: where the harness is, what the keyboard
 * does, how a write gets confirmed, and where the transcript is kept between
 * runs.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type ChatEngine,
  createChatEngine,
  createFelixClient,
  eventsToTurns,
  mergeSessions,
  snapshotToEvents,
  type ThreadMeta,
  threadSuffix,
  titleFromText,
} from '@felix/client';
import type { ThinkingLevel } from '@felix/protocol';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Attention } from './attention.js';
import { authHeaders, type Config } from './config.js';
import { editorCommand, openEditor } from './editor.js';
import { type EpilogueSlot, formatEpilogue } from './epilogue.js';
import { explainError } from './errors.js';
import type { PromptHistory } from './history.js';
import type { ThreadStore } from './threads.js';
import { Composer } from './ui/composer.js';
import { ApprovalPrompt, UiPrompt, WritePrompt } from './ui/prompts.js';
import { StatusLine, ThreadRail } from './ui/rails.js';
import { Transcript } from './ui/transcript.js';
import { createWorkspace } from './workspace.js';

/** Matches chat-ui: often enough to catch a gated tool, cheap enough to leave on. */
const APPROVAL_POLL_MS = 2500;

/**
 * How long a write prompt may stand.
 *
 * Under `DEFAULT_CLIENT_TOOL_TIMEOUT_MS` (30s) on purpose: the executor's
 * deadline resolves the engine's promise but cannot stop the write, so this has
 * to be the one that fires first.
 */
const WRITE_PROMPT_MS = 25_000;

const THINKING: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Search hits shown at once. A notice is a few lines, not a panel. */
const SEARCH_LIMIT = 5;

const HELP = [
  '/new /clear /continue /think <level> /manifest [name] /quit',
  '/rename <name> /fork /compact /export [file] /rewind [n]',
  '/search <text> /open <n|thread-id> /refresh',
].join('\n');

/** A hit, a title, a path — one line each, because a notice is one line each. */
const oneLine = (text: string, width = 60) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > width ? `${flat.slice(0, width - 1)}\u2026` : flat;
};

export interface AppProps {
  config: Config;
  store: ThreadStore;
  history: PromptHistory;
  attention: Attention;
  epilogue: EpilogueSlot;
  root: string;
  firstMessage?: string;
}

export function App({ config, store, history, attention, epilogue, root, firstMessage }: AppProps) {
  const { exit, suspendTerminal } = useApp();
  const { stdout } = useStdout();

  const [threadId, setThreadId] = useState(() => config.thread ?? crypto.randomUUID());
  const [threads, setThreads] = useState<ThreadMeta[]>(() => store.list());
  const [manifest, setManifest] = useState(config.manifest);
  const [railFocused, setRailFocused] = useState(false);
  const [railCursor, setRailCursor] = useState(0);
  /**
   * Narrows the rail as you type, while it has focus. Titles only, and local:
   * `/search` is the harness's full-text search over message *bodies*, which is
   * a round trip and a different question. This one answers "which of these".
   */
  const [railFilter, setRailFilter] = useState('');
  const [uiResolving, setUiResolving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [quitArmed, setQuitArmed] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => history.entries());

  /** Thread ids from the last `/search`, so `/open 2` means something. */
  const hitsRef = useRef<string[]>([]);

  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const leaseTokenRef = useRef<string | null>(null);

  /**
   * A client tool wants to write. The executor awaits this promise, so the
   * prompt *is* the run.
   *
   * It must therefore never outlive the call that raised it. The tool's own
   * deadline resolves the promise the engine is waiting on but cannot cancel the
   * work — so a prompt left on screen would still write, minutes after the model
   * was told the tool timed out and moved on. This one answers itself first, and
   * is cancelled outright whenever the run is stopped.
   */
  const [writePrompt, setWritePrompt] = useState<string | null>(null);
  const writeResolver = useRef<((ok: boolean) => void) | null>(null);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const answerWrite = useCallback((ok: boolean) => {
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = null;
    writeResolver.current?.(ok);
    writeResolver.current = null;
    setWritePrompt(null);
  }, []);

  const confirmWrite = useCallback(
    (summary: string) =>
      new Promise<boolean>((resolve) => {
        // A second request while one is pending refuses the first rather than
        // orphaning its resolver.
        writeResolver.current?.(false);
        if (writeTimer.current) clearTimeout(writeTimer.current);
        writeResolver.current = resolve;
        setWritePrompt(summary);
        writeTimer.current = setTimeout(() => {
          writeResolver.current = null;
          writeTimer.current = null;
          setWritePrompt(null);
          resolve(false);
        }, WRITE_PROMPT_MS);
      }),
    [],
  );

  /** Stopping the run takes the prompt with it — and refuses the write. */
  const cancelWrite = useCallback(() => {
    if (writeResolver.current) answerWrite(false);
  }, [answerWrite]);

  const engineRef = useRef<ChatEngine | null>(null);
  const clientRef = useRef<ReturnType<typeof createFelixClient> | null>(null);
  if (!engineRef.current) {
    // No proxy Worker and no shared key: this process reaches the harness
    // itself, so the credential is a bearer token it holds.
    const client = createFelixClient({
      baseUrl: config.origin,
      headers: () => authHeaders(config),
    });
    clientRef.current = client;
    engineRef.current = createChatEngine({
      client,
      threadId: () => threadIdRef.current,
      clientTools: createWorkspace({
        root,
        // `--yes` is a confirm that always agrees, not an absent one: a
        // workspace with no confirm at all would be a silent writer.
        confirm: config.yes ? async () => true : confirmWrite,
      }),
    });
    engineRef.current.setTurns(store.loadTurns(threadIdRef.current));
  }
  const engine = engineRef.current;
  const client = clientRef.current as ReturnType<typeof createFelixClient>;
  const { turns, error, streaming, reattaching, approvals, uiPrompt, phase } = useSyncExternalStore(
    engine.subscribe,
    () => engine.state,
  );
  const pending = approvals[0] ?? null;
  const blocked = Boolean(pending || uiPrompt || writePrompt);

  /** What the rail draws and what enter picks — the same list, always. */
  const visibleThreads = useMemo(() => {
    const query = railFilter.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) =>
      `${thread.title ?? ''} ${thread.id}`.toLowerCase().includes(query),
    );
  }, [threads, railFilter]);

  /** Below this the rail is not drawn, so there is nothing to give focus to. */
  const wide = (stdout?.columns ?? 80) >= 90;

  // Persist at every change; a terminal can be closed at any moment and the
  // local copy is the only transcript an anonymous caller gets back.
  useEffect(() => store.saveTurns(threadId, turns), [store, threadId, turns]);

  const refreshThreads = useCallback(async () => {
    const local = store.list();
    try {
      setThreads(mergeSessions(local, await client.listSessions()));
    } catch {
      setThreads(local); // offline, or a harness that rejects anonymous listing
    }
  }, [client, store]);

  /** The snapshot is authoritative; the local copy is a cache and a fallback. */
  const hydrate = useCallback(
    async (id: string) => {
      const snapshot = await client.getSessionSnapshot(id).catch(() => null);
      if (!snapshot) return;
      const rebuilt = eventsToTurns(snapshotToEvents(snapshot));
      if (rebuilt.length) engine.setTurns(rebuilt);
      if (snapshot.phase) engine.setPhase(snapshot.phase);
    },
    [client, engine],
  );

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  // Another client driving the same session is a real possibility here — that is
  // the point of running two. Take the lease, and say so rather than fighting.
  useEffect(() => {
    let holder = `tui-${process.pid}`;
    let cancelled = false;
    void (async () => {
      const lease = await client
        .acquireSessionLease({ threadId, holderId: holder, mode: 'exclusive' })
        .catch(() => ({ ok: false, error: 'lease unavailable' }));
      if (cancelled) return;
      if (!lease.ok) setNotice('another client holds this thread — following read-only');
      else leaseTokenRef.current = 'token' in lease ? (lease.token ?? null) : null;
    })();
    return () => {
      cancelled = true;
      void client.releaseSessionLease({
        threadId,
        holderId: holder,
        ...(leaseTokenRef.current ? { token: leaseTokenRef.current } : {}),
      });
      holder = '';
    };
  }, [client, threadId]);

  // Focus reporting is asked for from here rather than at construction, and the
  // reason is one line of terminal behaviour: the terminal answers on stdin, and
  // until Ink has raw mode on the tty echoes that answer to the screen — a
  // literal `^[[I` printed into the first frame. By the time this effect runs
  // the composer's `useInput` has mounted and raw mode is on.
  useEffect(() => {
    attention.begin();
    return () => attention.end();
  }, [attention]);

  // The window title says what the run is doing whether or not anyone is here;
  // the notification behind it fires only once the terminal reports it lost
  // focus. Same three states as the browser's presence signals.
  useEffect(() => {
    attention.set(blocked ? 'blocked' : streaming ? 'working' : 'idle');
  }, [attention, blocked, streaming]);

  // Left behind when the screen is: this is the only record of which thread was
  // open, and `--thread` is what takes it back.
  useEffect(() => {
    epilogue.text = formatEpilogue({
      threadId,
      turns: turns.length,
      ...(threads.find((t) => t.id === threadId)?.title
        ? { title: threads.find((t) => t.id === threadId)?.title }
        : {}),
    });
  }, [epilogue, threadId, threads, turns.length]);

  // A gated tool blocks the run and the harness does not reliably announce it
  // on the stream. Without this the card sits on 'running' forever.
  useEffect(() => {
    void engine.syncApprovals();
  }, [engine]);
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => void engine.syncApprovals(), APPROVAL_POLL_MS);
    return () => clearInterval(timer);
  }, [engine, streaming]);

  const send = useCallback(
    (text: string) => {
      if (streaming) {
        // A reattach keeps `streaming` true but has no run to steer.
        if (reattaching) {
          setNotice('rejoining the thread — wait for it to settle');
          return;
        }
        void client
          .steerChat({ threadId: threadIdRef.current, text })
          .catch((err) => engine.setError(explainError(err, 'steer the run', config)));
        return;
      }
      const assistantId = crypto.randomUUID();
      const firstTurn = turns.length === 0;
      engine.setTurns([
        ...turns,
        { id: crypto.randomUUID(), role: 'user', content: text },
        { id: assistantId, role: 'assistant', content: '', tools: [] },
      ]);
      store.index({
        id: threadIdRef.current,
        manifest,
        title: firstTurn
          ? titleFromText(text)
          : (threads.find((t) => t.id === threadIdRef.current)?.title ?? titleFromText(text)),
        updatedAt: Date.now(),
      });
      void engine
        .send({ manifest, messages: [{ role: 'user', content: text }], assistantId })
        .then(refreshThreads);
    },
    [
      client,
      config,
      engine,
      manifest,
      reattaching,
      refreshThreads,
      store,
      streaming,
      threads,
      turns,
    ],
  );

  /** Leaving the rail leaves its filter behind with it. */
  const closeRail = useCallback(() => {
    setRailFocused(false);
    setRailFilter('');
  }, []);

  const newThread = useCallback(() => {
    engine.abort();
    cancelWrite();
    engine.reset();
    setThreadId(crypto.randomUUID());
    setNotice(null);
  }, [cancelWrite, engine]);

  const selectThread = useCallback(
    (id: string) => {
      if (id === threadIdRef.current) return;
      engine.abort();
      cancelWrite();
      engine.reset();
      setThreadId(id);
      engine.setTurns(store.loadTurns(id));
      void hydrate(id);
    },
    [cancelWrite, engine, hydrate, store],
  );

  /**
   * Hand the composer's line to `$EDITOR`. Ink's `suspendTerminal` gives the
   * terminal to the child and restores it afterwards even if this throws, so
   * the only failure left to report is the editor's own.
   */
  const editPrompt = useCallback(
    async (value: string) => {
      if (!editorCommand()) {
        setNotice('set $EDITOR or $VISUAL to write a prompt in an editor');
        return undefined;
      }
      let edited: string | undefined;
      try {
        await suspendTerminal(async () => {
          edited = await openEditor({ value, cwd: root });
        });
      } catch (err) {
        setNotice(`editor: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      }
      return edited;
    },
    [root, suspendTerminal],
  );

  const command = useCallback(
    (line: string) => {
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
            .setThinkingLevel({ threadId: threadIdRef.current, thinkingLevel: level })
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
                          `${i + 1}) ${threads.find((t) => t.id === hit.id)?.title ?? hit.id} · ${oneLine(hit.snippet)}`,
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
    },
    [
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
      store,
      threads,
    ],
  );

  const submit = useCallback(
    (text: string) => {
      setNotice(null);
      setQuitArmed(false);
      // Commands are recorded too: `/think high` is as worth recalling as a
      // paragraph, and a shell does not filter its history either.
      history.add(text);
      setRecent(history.entries());
      if (text.startsWith('/')) command(text);
      else send(text);
    },
    [command, history, send],
  );

  // The first message from argv, once the engine exists.
  const sentFirst = useRef(false);
  useEffect(() => {
    if (sentFirst.current || !firstMessage) return;
    sentFirst.current = true;
    submit(firstMessage);
  }, [firstMessage, submit]);

  useInput((input, key) => {
    // Focus reports reach `useInput` as ordinary text; they are not keys.
    if (attention.isFocusReport(input)) return;
    if (key.ctrl && input === 'c') {
      if (quitArmed || !streaming) {
        exit();
        return;
      }
      // A run is live and ctrl+c is ambiguous — stop it, and take a second
      // press as "no, really".
      engine.abort();
      cancelWrite();
      void client.abortChat(threadIdRef.current).catch(() => {});
      setQuitArmed(true);
      setNotice('run stopped — ctrl+c again to quit');
      return;
    }
    if (blocked) return;
    // The rail takes the keyboard whole while it has focus — the same rule the
    // composer follows, for the same reason: Ink hands every keypress to every
    // mounted handler, so a key that means two things does both. Stopping a run
    // stays reachable throughout, because ctrl+c is handled above this line.
    if (railFocused) {
      if (key.tab || (key.escape && !railFilter)) {
        closeRail();
        return;
      }
      if (key.escape) {
        setRailFilter('');
        if (railCursor !== 0) setRailCursor(0);
        return;
      }
      if (key.upArrow) {
        setRailCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setRailCursor((c) => Math.max(0, Math.min(visibleThreads.length - 1, c + 1)));
        return;
      }
      if (key.return) {
        const target = visibleThreads[railCursor];
        if (target) selectThread(target.id);
        closeRail();
        return;
      }
      if (key.backspace || key.delete) {
        setRailFilter((f) => f.slice(0, -1));
        if (railCursor !== 0) setRailCursor(0);
        return;
      }
      // Chords belong to the app; arrows that are not up or down mean nothing
      // to a one-column list. Everything else is filter text.
      if (key.ctrl || key.meta || key.leftArrow || key.rightArrow) return;
      if (input) {
        setRailFilter((f) => f + input);
        if (railCursor !== 0) setRailCursor(0);
      }
      return;
    }
    if (key.escape && streaming) {
      engine.abort();
      cancelWrite();
      void client.abortChat(threadIdRef.current).catch(() => {});
      engine.setPhase('aborted');
      return;
    }
    if (key.tab) {
      if (!wide) return;
      // Open on the thread that is open, rather than on row zero with the
      // marker somewhere further down.
      const index = threads.findIndex((thread) => thread.id === threadIdRef.current);
      setRailCursor(index >= 0 ? index : 0);
      setRailFocused(true);
      return;
    }
    if (key.ctrl && input === 'n') {
      newThread();
    }
  });

  /**
   * What the keys do *now*. The rail case is the one that earns this: while it
   * has focus the composer is disabled and its own hint is not drawn, which is
   * exactly the moment the bindings are least guessable.
   */
  const hint = railFocused
    ? '↑↓ select · enter open · type to filter · esc clear · tab back'
    : streaming
      ? 'esc stop · tab threads · ctrl+e editor'
      : 'tab threads · ctrl+n new · ctrl+e editor · /help';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        {wide ? (
          <ThreadRail
            threads={visibleThreads}
            activeId={threadId}
            cursor={railCursor}
            focused={railFocused}
            filter={railFilter}
            total={threads.length}
          />
        ) : null}
        <Box flexDirection="column" flexGrow={1}>
          <Transcript turns={turns} />
        </Box>
      </Box>

      {/*
        Exactly one prompt is mounted at a time, and that is a correctness
        requirement rather than a layout preference: Ink delivers every keypress
        to *every* mounted `useInput`, so two banners on screen means one `y`
        answers both. The local write prompt wins because it is the one on a
        deadline; the harness-side prompts wait, and the run is already waiting
        on them anyway.
      */}
      {writePrompt ? (
        <WritePrompt summary={writePrompt} onAnswer={answerWrite} />
      ) : pending ? (
        <ApprovalPrompt
          pending={pending}
          onDecide={(status) => {
            void client
              .decideApproval(pending.approvalId, { status })
              .catch((err) => engine.setError(explainError(err, 'record that decision', config)));
            engine.shiftApproval();
          }}
        />
      ) : uiPrompt ? (
        <UiPrompt
          pending={uiPrompt}
          busy={uiResolving}
          onRespond={(value) => {
            setUiResolving(true);
            void client
              .respondUiRequest({ requestId: uiPrompt.requestId, value })
              .catch((err) => engine.setError(explainError(err, 'answer the agent', config)))
              .finally(() => {
                setUiResolving(false);
                engine.clearUiPrompt();
              });
          }}
          onCancel={() => {
            void client.respondUiRequest({ requestId: uiPrompt.requestId, cancelled: true });
            engine.clearUiPrompt();
          }}
        />
      ) : null}

      {notice ? <Text color="yellow">{notice}</Text> : null}

      {/*
        The rail takes the keyboard whole while it is focused. Ink delivers
        every keypress to every mounted `useInput`, so a composer left active
        would recall history on the same ↑ that moves the rail cursor, and
        submit whatever is typed on the Enter that picks a thread.
      */}
      <Composer
        streaming={streaming}
        disabled={blocked || railFocused}
        onSubmit={submit}
        history={recent}
        onEdit={editPrompt}
        isFocusReport={attention.isFocusReport}
        hint={streaming ? 'steer the run…' : 'ask, /help, ctrl+e to open $EDITOR'}
      />
      <StatusLine
        manifest={manifest}
        origin={config.origin}
        phase={phase}
        reattaching={reattaching}
        error={error}
        root={root}
        hint={hint}
      />
    </Box>
  );
}
