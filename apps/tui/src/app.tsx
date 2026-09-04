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
import {
  type ChatEngine,
  createChatEngine,
  createFelixClient,
  eventsToTurns,
  formatArgsForEditing,
  mergeSessions,
  msUntilDecision,
  type PendingApproval,
  parseEditedArgs,
  snapshotToEvents,
  type ThreadMeta,
  titleFromText,
} from '@felix/client';
import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core';
import {
  useKeyboard,
  useRenderer,
  useSelectionHandler,
  useTerminalDimensions,
} from '@opentui/react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { spills } from './artifacts.js';
import type { Attention } from './attention.js';
import { copyText, describeCopy } from './clipboard.js';
import { runCommand } from './commands.js';
import { authHeaders, type Config } from './config.js';
import { editorCommand, openEditor } from './editor.js';
import { type EpilogueSlot, formatEpilogue } from './epilogue.js';
import { explainError } from './errors.js';
import type { PromptHistory } from './history.js';
import { inspectorRows, SECTIONS, type SectionKey } from './inspector.js';
import { type Overlay, route } from './keys.js';
import { useLease } from './lease.js';
import { page, pagerCommand } from './pager.js';
import { usePanel } from './panel.js';
import { useTheme } from './theme.js';
import type { ThreadStore } from './threads.js';
import { Composer } from './ui/composer.js';
import { Greeting } from './ui/greeting.js';
import { Inspector } from './ui/inspector.js';
import { ApprovalPrompt, UiPrompt, WritePrompt } from './ui/prompts.js';
import { type Connection, railRows, StatusLine, ThreadPicker } from './ui/rails.js';
import { Transcript } from './ui/transcript.js';
import { createWorkspace } from './workspace.js';
import { useWriteGate } from './write-gate.js';

/** Matches chat-ui: often enough to catch a gated tool, cheap enough to leave on. */
const APPROVAL_POLL_MS = 2500;

export interface AppProps {
  config: Config;
  store: ThreadStore;
  history: PromptHistory;
  attention: Attention;
  epilogue: EpilogueSlot;
  root: string;
  firstMessage?: string;
  /** Tear down and leave. Owned by `main.tsx`, which has to order the exit. */
  onExit: () => void;
}

export function App({
  config,
  store,
  history,
  attention,
  epilogue,
  root,
  firstMessage,
  onExit,
}: AppProps) {
  const renderer = useRenderer();
  const theme = useTheme();
  const { width, height } = useTerminalDimensions();
  const exit = onExit;

  const [threadId, setThreadId] = useState(() => config.thread ?? crypto.randomUUID());
  const [threads, setThreads] = useState<ThreadMeta[]>(() => store.list());
  const [manifest, setManifest] = useState(config.manifest);
  // One value rather than a flag each: the two overlays are mutually exclusive,
  // because both consume every key they are handed and both are opaque boxes at
  // the same zIndex.
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [sectionKey, setSectionKey] = useState<SectionKey>('activity');
  const [searching, setSearching] = useState(false);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  /**
   * What the client believes about the harness, from the transport's own
   * callbacks rather than from whichever call happened to fail.
   *
   * Latched on transition. `onReachability(true)` fires on *every* successful
   * request, and `onUnauthorized` fires on every 401 — with the approvals poll
   * running every 2.5s during a run, a rotated key is a 401 storm. Setting state
   * unconditionally would re-render the status line per round trip.
   */
  const [connection, setConnection] = useState<Connection>('ok');
  const [skills, setSkills] = useState<{ declared: string[]; active: string[] } | null>(null);
  const panelRef = useRef<ScrollBoxRenderable | null>(null);
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

  /**
   * The transcript's scroll box, driven directly rather than by focusing it.
   *
   * `ScrollBoxRenderable` already handles every scroll key there is — it just
   * has to be focused to hear them, and focus here means a mode you must leave
   * before you can type again. The page keys conflict with nothing (the
   * composer's textarea claims arrows, home and end, but not these), so they
   * can simply work, from anywhere, with no mode at all.
   */
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  // The prompt that authorizes a write, with its own deadline. See write-gate.ts.
  const writeGate = useWriteGate();
  const {
    prompt: writePrompt,
    answer: answerWrite,
    confirm: confirmWrite,
    cancel: cancelWrite,
  } = writeGate;

  const engineRef = useRef<ChatEngine | null>(null);
  const clientRef = useRef<ReturnType<typeof createFelixClient> | null>(null);
  if (!engineRef.current) {
    // No proxy Worker and no shared key: this process reaches the harness
    // itself, so the credential is a bearer token it holds.
    const client = createFelixClient({
      baseUrl: config.origin,
      headers: () => authHeaders(config),
      // A stopped harness is the most common local failure — it is a process on
      // the same machine — and until these were wired it surfaced only as an
      // error string on whichever call fired, while the status line went on
      // naming an origin that was not there.
      onReachability: (reachable) =>
        setConnection((was) => (reachable ? (was === 'unreachable' ? 'ok' : was) : 'unreachable')),
      // There is no re-prompt here: this process holds a bearer token from argv,
      // the environment or a file, and has nowhere to put a new one. `errors.ts`
      // already writes what to do about that.
      onUnauthorized: () => setConnection('rejected'),
    });
    clientRef.current = client;
    engineRef.current = createChatEngine({
      client,
      threadId: () => threadIdRef.current,
      // The engine parses a `list_skills` result and hands it over; without this
      // port that capture goes nowhere, which is why the panel could not exist.
      onSkills: setSkills,
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

  useLease(client, threadId, setNotice);

  /**
   * Selecting text copies it.
   *
   * The renderer draws the highlight either way; without this there is nothing
   * to do with it. Copying happens on mouse-up rather than as the drag moves,
   * because every intermediate selection would otherwise be written to the
   * clipboard and the last one to land would win by luck.
   *
   * A terminal that does not do OSC 52 is told about once and then left alone —
   * repeating it on every drag would make selecting text feel like an error.
   */
  const copyWarned = useRef(false);
  useSelectionHandler((selection) => {
    if (selection.isDragging) return;
    const result = copyText(renderer, selection.getSelectedText());
    if (result.status === 'unsupported') {
      if (copyWarned.current) return;
      copyWarned.current = true;
    }
    const said = describeCopy(result);
    if (said) setNotice(said);
  });

  // Focus reporting is asked for from here rather than at construction, and the
  // reason is one line of terminal behaviour: the terminal answers on stdin, and
  // until the renderer has raw mode on the tty echoes that answer to the screen
  // — a literal `^[[I` printed into the first frame, where it stays.
  //
  // Reading the answer is no longer our job. The renderer parses the reports and
  // emits `focus` / `blur`; this is the whole of what `isFocusReport` used to be.
  useEffect(() => {
    attention.begin();
    const focused = () => attention.setFocus(true);
    const blurred = () => attention.setFocus(false);
    renderer.on('focus', focused);
    renderer.on('blur', blurred);
    return () => {
      renderer.off('focus', focused);
      renderer.off('blur', blurred);
      attention.end();
    };
  }, [attention, renderer]);

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
        .send({
          manifest,
          messages: [{ role: 'user', content: text }],
          assistantId,
        })
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
    setOverlay('none');
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
   * Hand the composer's line to `$EDITOR`.
   *
   * `suspend` gives the terminal to the child and `resume` takes it back. The
   * `finally` is the whole point: an editor that exits non-zero, or a spawn that
   * throws, must not leave the renderer suspended — that is a client that has
   * stopped drawing with no way back.
   */
  const editPrompt = useCallback(
    async (value: string) => {
      if (!editorCommand()) {
        setNotice('set $EDITOR or $VISUAL to write a prompt in an editor');
        return undefined;
      }
      let edited: string | undefined;
      try {
        renderer.suspend();
        edited = await openEditor({ value, cwd: root });
      } catch (err) {
        setNotice(`editor: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      } finally {
        renderer.resume();
      }
      return edited;
    },
    [renderer, root],
  );

  /**
   * Approve a gated call with different arguments — the harness's third answer.
   *
   * A write to the wrong path could previously only be denied, which throws
   * away a correct intention over a wrong detail and makes the model guess
   * again. The harness has always taken `edited_args`; nothing offered it.
   *
   * `$EDITOR` rather than a form, because the arguments are arbitrary JSON and
   * this client already knows how to hand the terminal over and take it back.
   * That does mean the deadline runs while the editor is open and the countdown
   * is off screen — so the deadline is re-checked on the way back rather than
   * assumed to have held.
   */
  const editApproval = useCallback(
    async (approval: PendingApproval) => {
      const edited = await editPrompt(formatArgsForEditing(approval.args));
      // Abandoned, or no editor configured — `editPrompt` has already said why.
      if (edited === undefined) return;

      const parsed = parseEditedArgs(edited, approval.args);
      if (parsed.status === 'invalid') {
        // Deliberately not a decision: a malformed edit must not become an
        // approval of the original call.
        setNotice(`those arguments were not usable — ${parsed.error}. Nothing was decided.`);
        return;
      }
      if (msUntilDecision(approval) === 0) {
        setNotice('the harness stopped waiting while the editor was open — it denied this itself');
        engine.shiftApproval();
        return;
      }

      void client
        .decideApproval(approval.approvalId, {
          status: 'approved',
          // An unmodified edit approves plainly. Sending `edited_args` equal to
          // the originals would install a substitution nobody asked for.
          ...(parsed.status === 'edited' ? { edited_args: parsed.args } : {}),
        })
        .catch((err) => engine.setError(explainError(err, 'record that decision', config)));
      setNotice(
        parsed.status === 'edited'
          ? 'approved with your arguments — the same call is rewritten this way until the grant expires'
          : 'approved unchanged',
      );
      engine.shiftApproval();
    },
    [client, config, editPrompt, engine],
  );

  /**
   * Hand a body to the pager, outside the alt screen.
   *
   * Same shape as `editPrompt`: resolve the command *before* suspending, and
   * resume in a `finally`, because a pager that exits non-zero must not leave a
   * client that has stopped drawing with no way back.
   */
  const showBody = useCallback(
    (body: string, name: string) => {
      if (!pagerCommand()) {
        setNotice('set $PAGER to read a spilled output in place');
        return;
      }
      try {
        renderer.suspend();
        const { path } = page(body, name);
        setNotice(`artifact written to ${path}`);
      } catch (err) {
        setNotice(`pager: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        renderer.resume();
      }
    },
    [renderer],
  );

  const command = useCallback(
    (line: string) =>
      runCommand(
        {
          client,
          engine,
          store,
          config,
          root,
          manifest,
          setManifest,
          setNotice,
          threadId: () => threadIdRef.current,
          threads: () => threads,
          hits: hitsRef,
          selectThread,
          refreshThreads,
          hydrate,
          newThread,
          exit,
          spills: () => spills(turns),
          show: showBody,
          fs: { exists: existsSync, write: writeFileSync },
        },
        line,
      ),
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
      showBody,
      store,
      threads,
      turns,
    ],
  );

  const submit = useCallback(
    (text: string) => {
      setNotice(null);
      setQuitArmed(false);
      // Sending while scrolled up would otherwise put the reply somewhere you
      // are not looking. Landing at the bottom also re-engages sticky.
      scrollRef.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER });
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

  /**
   * The keys the app owns, above everything drawn inside it.
   *
   * A global handler runs before the focused renderable and may take a key
   * outright, which is what `preventDefault` is doing here: without it the rail
   * would filter on the same ↑ that moves its cursor, and the composer would
   * keep typing while the rail has focus.
   *
   * Focus reports are not in this function at all any more — the renderer parses
   * them and emits `focus` / `blur`, so they can no longer be mistaken for keys.
   */
  useKeyboard((key: KeyEvent) => {
    const action = route(key, {
      blocked,
      streaming,
      quitArmed,
      overlay,
      railFilter,
      searching,
      consoleAvailable: renderer.consoleMode === 'console-overlay',
    });
    if (!action) return;
    // A non-null action is also the claim: without this the rail would filter on
    // the same arrow that moves its cursor, and the composer would keep typing
    // while the rail has focus.
    key.preventDefault();

    switch (action.kind) {
      case 'quit':
        exit();
        return;
      case 'stop':
        engine.abort();
        cancelWrite();
        void client.abortChat(threadIdRef.current).catch(() => {});
        setQuitArmed(true);
        setNotice('run stopped — ctrl+c again to quit');
        return;
      case 'scroll':
        scrollRef.current?.scrollBy(action.by, 'viewport');
        return;
      case 'close-rail':
        closeRail();
        return;
      case 'clear-filter':
        setRailFilter('');
        if (railCursor !== 0) setRailCursor(0);
        return;
      case 'rail-move':
        setRailCursor((c) =>
          action.by < 0
            ? Math.max(0, c - 1)
            : Math.max(0, Math.min(visibleThreads.length - 1, c + 1)),
        );
        return;
      case 'rail-open-selected': {
        const target = visibleThreads[railCursor];
        if (target) selectThread(target.id);
        closeRail();
        return;
      }
      case 'filter-backspace':
        setRailFilter((f) => f.slice(0, -1));
        if (railCursor !== 0) setRailCursor(0);
        return;
      case 'filter-append':
        setRailFilter((f) => f + action.char);
        if (railCursor !== 0) setRailCursor(0);
        return;
      case 'abort':
        engine.abort();
        cancelWrite();
        void client.abortChat(threadIdRef.current).catch(() => {});
        engine.setPhase('aborted');
        return;
      case 'open-inspector':
        setOverlay('inspector');
        setRailFilter('');
        return;
      case 'close-inspector':
        setOverlay('none');
        setSearching(false);
        return;
      case 'section': {
        const at = SECTIONS.findIndex((sec) => sec.key === sectionKey);
        const next = (at + action.by + SECTIONS.length) % SECTIONS.length;
        setSectionKey(SECTIONS[next]?.key ?? 'activity');
        setSearching(false);
        return;
      }
      case 'panel':
        panelRef.current?.scrollBy(action.by, 'absolute');
        return;
      case 'refresh-section':
        setRefreshTick((n) => n + 1);
        return;
      case 'search-open':
        if (sectionKey === 'memory') setSearching(true);
        return;
      case 'search-close':
        setSearching(false);
        return;
      case 'open-rail': {
        // Open on the thread that is open, rather than on row zero with the
        // marker somewhere further down.
        const index = threads.findIndex((thread) => thread.id === threadIdRef.current);
        setRailCursor(index >= 0 ? index : 0);
        setOverlay('threads');
        return;
      }
      case 'new-thread':
        newThread();
        return;
      case 'toggle-console':
        renderer.console.toggle();
        return;
      case 'consume':
        return;
    }
  });

  /**
   * What the keys do *now*. The rail case is the one that earns this: while it
   * has focus the composer is disabled and its own hint is not drawn, which is
   * exactly the moment the bindings are least guessable.
   */
  const section = SECTIONS.find((sec) => sec.key === sectionKey) ?? SECTIONS[0];
  const panel = usePanel({
    client,
    section: sectionKey,
    open: overlay === 'inspector',
    query: memoryQuery,
    tick: refreshTick,
    approvals,
    skills,
    theme,
    config,
  });

  const railFocused = overlay === 'threads';
  // Written in falling order of usefulness, because `StatusLine` takes the tail
  // when it has to cut. `shift+tab` goes after `tab` for that reason: it is the
  // one that can afford to be lost on a narrow terminal, and it is in `/help`.
  const hint =
    overlay === 'inspector'
      ? '←→ section · ↑↓ scroll · r refresh · esc close'
      : railFocused
        ? '↑↓ move · enter open · type to filter · esc close'
        : streaming
          ? 'esc stop · pgup/pgdn scroll · tab threads'
          : 'tab threads · shift+tab inspect · ctrl+n new · /help';

  return (
    // Bounded to the terminal, and clipped rather than allowed to spill. A
    // column taller than the screen is not scrolled here — it is drawn over
    // whatever is beneath it, which is how a rail asking for more rows than fit
    // ended up on top of the composer.
    <box flexDirection="column" height={height} overflow="hidden" paddingLeft={1} paddingRight={1}>
      <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
        <Transcript
          turns={turns}
          streaming={streaming}
          scrollRef={scrollRef}
          theme={theme}
          greeting={
            <Greeting
              manifest={manifest}
              workspace={root.replace(/\/+$/, '').split('/').pop() || root}
              unattended={config.yes}
              theme={theme}
            />
          }
        />
        {/*
          Absolute, so opening it does not reflow the conversation underneath —
          and last in the column, so it paints over what came before at the same
          `zIndex`. It replaced a permanent left-hand column that cost
          twenty-eight of a hundred cells whether or not anyone was looking at
          it, and that only existed above ninety columns, so the client had two
          different shapes depending on the terminal.
        */}
        {overlay === 'inspector' && section ? (
          <Inspector
            section={section}
            panel={panel}
            width={width}
            rows={inspectorRows(height)}
            theme={theme}
            panelRef={panelRef}
            searching={searching}
            query={memoryQuery}
            onQuery={setMemoryQuery}
          />
        ) : null}
        {overlay === 'threads' ? (
          <ThreadPicker
            threads={visibleThreads}
            activeId={threadId}
            cursor={railCursor}
            filter={railFilter}
            total={threads.length}
            rows={railRows(height)}
            theme={theme}
            onPick={(id: string) => {
              selectThread(id);
              closeRail();
            }}
          />
        ) : null}
      </box>

      {/*
        Exactly one prompt is mounted at a time, and that is a correctness
        requirement rather than a layout preference: `useKeyboard` is a global
        subscription, so two banners on screen means one `y` answers both. The
        local write prompt wins because it is the one on a deadline; the
        harness-side prompts wait, and the run is already waiting on them anyway.
      */}
      {writePrompt ? (
        <WritePrompt summary={writePrompt} onAnswer={answerWrite} theme={theme} />
      ) : pending ? (
        <ApprovalPrompt
          theme={theme}
          pending={pending}
          onDecide={(status) => {
            void client
              .decideApproval(pending.approvalId, { status })
              .catch((err) => engine.setError(explainError(err, 'record that decision', config)));
            engine.shiftApproval();
          }}
          onEdit={() => void editApproval(pending)}
        />
      ) : uiPrompt ? (
        <UiPrompt
          theme={theme}
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
            void client.respondUiRequest({
              requestId: uiPrompt.requestId,
              cancelled: true,
            });
            engine.clearUiPrompt();
          }}
        />
      ) : null}

      {notice ? (
        <text fg={theme.notice} flexShrink={0}>
          {notice}
        </text>
      ) : null}

      {/*
        The rail takes the keyboard whole while it is focused, so the composer is
        disabled rather than merely unfocused: an enabled textarea would still
        take the keys the rail is reading.
      */}
      <Composer
        streaming={streaming}
        disabled={blocked || overlay !== 'none'}
        onSubmit={submit}
        history={recent}
        onEdit={editPrompt}
        hint={streaming ? 'steer the run…' : 'ask, /help, ctrl+e to open $EDITOR'}
        theme={theme}
      />
      <StatusLine
        manifest={manifest}
        origin={config.origin}
        connection={connection}
        phase={phase}
        reattaching={reattaching}
        error={error}
        root={root}
        hint={hint}
        width={width}
        theme={theme}
      />
    </box>
  );
}
