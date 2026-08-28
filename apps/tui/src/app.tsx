/**
 * Felix in the terminal.
 *
 * Everything the conversation *is* — frames, transcript, tool cards, approvals,
 * durable runs, reattach — belongs to `@felix/client`. This file is the part a
 * terminal has to answer for itself: where the harness is, what the keyboard
 * does, how a write gets confirmed, and where the transcript is kept between
 * runs.
 */

import {
  type ChatEngine,
  createChatEngine,
  createFelixClient,
  eventsToTurns,
  mergeSessions,
  snapshotToEvents,
  type ThreadMeta,
  titleFromText,
} from '@felix/client';
import type { ThinkingLevel } from '@felix/protocol';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { authHeaders, type Config } from './config.js';
import { explainError } from './errors.js';
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

export interface AppProps {
  config: Config;
  store: ThreadStore;
  root: string;
  firstMessage?: string;
}

export function App({ config, store, root, firstMessage }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [threadId, setThreadId] = useState(() => config.thread ?? crypto.randomUUID());
  const [threads, setThreads] = useState<ThreadMeta[]>(() => store.list());
  const [manifest, setManifest] = useState(config.manifest);
  const [railFocused, setRailFocused] = useState(false);
  const [railCursor, setRailCursor] = useState(0);
  const [uiResolving, setUiResolving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [quitArmed, setQuitArmed] = useState(false);

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
        case 'quit':
          exit();
          return;
        default:
          setNotice('commands: /new /clear /continue /think /manifest /quit');
      }
    },
    [client, config, engine, exit, manifest, newThread],
  );

  const submit = useCallback(
    (text: string) => {
      setNotice(null);
      setQuitArmed(false);
      if (text.startsWith('/')) command(text);
      else send(text);
    },
    [command, send],
  );

  // The first message from argv, once the engine exists.
  const sentFirst = useRef(false);
  useEffect(() => {
    if (sentFirst.current || !firstMessage) return;
    sentFirst.current = true;
    submit(firstMessage);
  }, [firstMessage, submit]);

  useInput((input, key) => {
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
    if (key.escape && streaming) {
      engine.abort();
      cancelWrite();
      void client.abortChat(threadIdRef.current).catch(() => {});
      engine.setPhase('aborted');
      return;
    }
    if (key.tab) {
      setRailFocused((f) => !f);
      return;
    }
    if (key.ctrl && input === 'n') {
      newThread();
      return;
    }
    if (!railFocused) return;
    if (key.upArrow) setRailCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setRailCursor((c) => Math.min(threads.length - 1, c + 1));
    if (key.return) {
      const target = threads[railCursor];
      if (target) selectThread(target.id);
      setRailFocused(false);
    }
  });

  const wide = (stdout?.columns ?? 80) >= 90;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        {wide ? (
          <ThreadRail
            threads={threads}
            activeId={threadId}
            cursor={railCursor}
            focused={railFocused}
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

      <Composer
        streaming={streaming}
        disabled={blocked}
        onSubmit={submit}
        hint={streaming ? 'steer the run…' : 'ask, or /help'}
      />
      <StatusLine
        manifest={manifest}
        origin={config.origin}
        phase={phase}
        streaming={streaming}
        reattaching={reattaching}
        error={error}
        root={root}
      />
    </Box>
  );
}
