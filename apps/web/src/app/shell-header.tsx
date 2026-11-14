import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@felix/ui/dropdown-menu';
import {
  BirdIcon,
  BugIcon,
  CopyIcon,
  EllipsisIcon,
  MonitorIcon,
  MoonIcon,
  PanelRightIcon,
  PlusIcon,
  SunIcon,
} from 'lucide-react';
import { AttentionLine } from '@/components/attention-line';
import { BrandToggle, Wordmark } from '@/components/brand-mark';
import type { Theme } from '@/components/theme-provider';
import { ThreadReturn, ThreadTitle } from '@/components/thread-title';
import { middleTruncate } from '@/lib/format';
import { ariaShortcut, shortcutLabel } from '@/lib/navigation/shortcuts';
import { setPaneShown } from '@/lib/navigation/side-pane';
import { cn } from '@/lib/utils';
import { AccountChip } from '../components/account-chip';
import { isViewLevel, VIEW_OPTIONS } from './hooks/use-shell-preferences';
import type { AppController } from './use-app-controller';

/** The header menu's Theme choices, in the order the radio group lists them. */
const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; Icon: typeof SunIcon }> = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: MonitorIcon },
];
export function ShellHeader({ controller }: { controller: AppController }) {
  const {
    onHarness,
    sidebarInline,
    currentThread,
    mac,
    canary,
    runShown,
    runBlocked,
    toggleDebug,
    menuTriggerRef,
    continueAvailable,
    continueRun,
    copyThreadId,
    theme,
    setTheme,
    pane,
    paneHasItems,
    bannerOwned,
    pendingQueue,
    poolRuns,
    uiPrompt,
    attentionHost,
  } = controller;
  const {
    historyOpen,
    setHistoryOpen,
    threadId,
    turns,
    watching,
    renameThread,
    harnessView,
    debug,
    streaming,
    tenantApprovals,
    threads,
    inspectorOpen,
    setInspectorOpen,
    newThread,
    view,
    setView: chooseView,
  } = controller.shell;
  // Unavailable, it still says what it is and why, at full contrast: a disabled
  // item's half opacity on muted text put the reason under the contrast floor.
  const continueItem = continueAvailable.ok ? (
    <DropdownMenuItem disabled={streaming || watching} onSelect={() => continueRun()}>
      Continue run
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem disabled className="data-[disabled]:opacity-100">
      <span className="flex flex-col text-muted-foreground">
        Continue run
        <span className="text-xs">{continueAvailable.reason}</span>
      </span>
    </DropdownMenuItem>
  );

  return (
    <header className="flex h-[calc(var(--header-height)+env(safe-area-inset-top,0px))] shrink-0 items-center gap-1 border-b border-border/60 px-3 pt-safe">
      {/* Below 1024 the sidebar is a drawer and has no edge on screen, so its
                  brand — and with it the toggle — stands here, in the slot the panel
                  button had. From 1024 both live at the top of the sidebar instead,
                  on this bar's line, and the header starts with the run. */}
      {!sidebarInline && (
        <div data-slot="header-brand" className="flex shrink-0 items-center gap-1.5">
          <BrandToggle
            open={historyOpen}
            onClick={() => setHistoryOpen((o) => !o)}
            // What is on screen, not what is stored: at this width the stored
            // preference is not what the operator is looking at. Pressed means
            // the drawer is open.
            aria-pressed={historyOpen}
            aria-label="Sidebar"
            aria-keyshortcuts={ariaShortcut('toggle-workspace', mac)}
            title={`Sidebar (${shortcutLabel('toggle-workspace', mac)})`}
          />
          {/* Below `sm` the word steps aside on `/t`, for the thread's title,
                      and on `/harness` while a run state is showing: the mark beside
                      it is the brand and the toggle, and at 320px the word, the title
                      and the attention line do not fit together. It stays the page's
                      `h1` for a reader. */}
          <Wordmark className={cn((runShown || !onHarness) && 'max-sm:sr-only')} />
        </div>
      )}
      {/* The left cluster yields in a fixed order, because at 390px with both
                  modes on and a run blocked it holds more than its space. The brand
                  before it never shrinks, and nor does the run state. Below `sm` the
                  two modes draw as icons, keeping their words for a reader, and while
                  a run state is on screen they step aside (see the modes' row). Past
                  that — a 320px viewport, where the brand and the chip alone are wider
                  than the room — the cluster clips at its own edge rather than running
                  under the right cluster, which holds the controls. `py-1` is room for
                  a focus ring the clip would otherwise cut.

                  On `/t` the cluster also names the thread, and the title is the
                  first thing in the whole header to give way: from `sm` this cluster
                  carries a shrink weight far above the attention line's, so the title
                  is cut from the middle down to a floor (`sm:min-w-52`) before the
                  line loses a word of its sentence. The line is the signal; the title
                  is whole in its `title`, the sidebar and the Session menu's id.
                  Below `sm` the line does not shrink, so the floor goes and the
                  title takes the squeeze, down to nothing at 320px, before the brand
                  mark or the run state yield anything. What keeps it from getting
                  there at 390px is the line giving way first: at rest it is its dot
                  alone below `sm`, and only "N waiting" or "Unreachable" keep words. */}
      <div
        data-slot="header-state"
        className={cn(
          'flex min-w-0 items-center gap-2 overflow-hidden px-1.5 py-1',
          !onHarness && 'shrink-[10000] sm:min-w-52',
        )}
      >
        {/* This thread's run, in one slot that is the same on both addresses.
                    It used to ride the Chat door on `/harness` only, so `/t` said
                    nothing in the header and the two addresses disagreed about where
                    to look. Two words and nothing else — waiting on a person, or
                    working — because a copy with its own idea of which finer phases
                    were worth showing disagreed with the instrument's.

                    `blocked` outranks `running` and reads the same queue the tab title
                    does (`setPresence` above): a run waiting on an approval or a
                    question is not working, and "running" was the reason to stay on a
                    page while the run timed out behind it.

                    A tinted chip the height of the badges beside it, not bare text:
                    as `text-xs` with no surface it lost to the filled mode pill, so
                    the header ranked a viewing preference above the run. The tint is
                    the state's own hue at /10 — the ramp is tuned for text on its own
                    tint up to /15 in both themes.

                    Not a live region. The attention line below is one, and already
                    announces both "Working" and a call waiting on you; a second region
                    saying the same change would make a screen reader say it twice.
                    The `sr-only` prefix is what keeps it from being mistaken for that
                    line when it is read in place: that line is tenant-wide, this is
                    the thread on screen. */}
        {runBlocked ? (
          <span
            data-slot="run-state"
            title="This thread's run is waiting on you"
            className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border border-transparent bg-solid-state-blocked/10 px-2 py-0.5 text-xs font-medium text-state-blocked"
          >
            <span aria-hidden className="size-1.5 rounded-full bg-state-blocked" />
            <span className="sr-only">This thread's run: </span>
            blocked
          </span>
        ) : streaming ? (
          <span
            data-slot="run-state"
            title="This thread's run is in progress"
            className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border border-transparent bg-solid-state-running/10 px-2 py-0.5 text-xs font-medium text-state-running"
          >
            <span aria-hidden className="size-1.5 rounded-full bg-state-running" />
            <span className="sr-only">This thread's run: </span>
            running
          </span>
        ) : null}
        {/* The thread this sheet holds: after the run state, which keeps
                    its first slot on both addresses, so the chip does not move
                    between them. On `/harness` each page has its own title, so the
                    slot is the way back to the tab's thread instead — which also
                    says whose run the chip before it is. */}
        {onHarness && (
          <ThreadReturn
            threadId={threadId}
            thread={currentThread}
            empty={turns.length === 0}
            className="shrink-[100]"
          />
        )}
        {!onHarness && (
          <ThreadTitle
            threadId={threadId}
            thread={currentThread}
            readOnly={watching}
            onRename={renameThread}
            empty={turns.length === 0}
            showAgent={harnessView}
            className="shrink-[100]"
          />
        )}
        {/* The modes this tab is in, at every width. They were `hidden` below
                    `sm`, so on a phone, or at 200% zoom, debug and a canary rollout
                    were states with nothing on screen to say so. What narrows instead
                    is their words: below `sm` each draws as its icon, and the word
                    stays in the accessible name and the `title`.

                    Below `sm`, while this thread's run state is showing, the modes
                    step off the screen. Measured at 390px, the wordmark and a
                    `blocked` chip leave no room for even one icon beside them, and
                    the alternatives were both worse: a badge clipped part-way reads
                    as broken, and one pushed out of view by overflow is a Debug
                    button keyboard focus can land on and nobody can see. So Debug
                    is `hidden`, which takes it out of the tab order as well — the
                    Session menu still holds it — and the canary, which is not
                    focusable, goes `sr-only` and is still read. Both come back when
                    the run settles. Nothing else in the cluster shrinks, so this row
                    is `min-w-0` for the widths between, where it is the one to give. */}
        {/* The view governs both addresses — the sidebar's harness pages come
                    and go with it — so these are on both. The canary is the
                    harness's, and shows in harness view; the badge is debug's
                    alone, so it says what it means. */}
        {harnessView && (debug || canary) && (
          <div
            data-slot="header-modes"
            // `contents` while the modes have stepped off a narrow screen, so
            // the row leaves no empty box and no gap behind them.
            className={cn('flex min-w-0 items-center gap-2', runShown && 'max-sm:contents')}
          >
            {debug && (
              <Badge
                variant="secondary"
                className={cn('h-5.5 font-normal', runShown && 'max-sm:hidden')}
                asChild
              >
                {/* A button, because a badge that reports a mode should also be
                          the way out of it — otherwise the way out is two clicks into
                          a menu whose trigger says nothing about debug. Focus moves
                          to that menu's trigger, since the badge unmounts under the
                          click.

                          No `aria-pressed`: the badge exists only while debug is on,
                          so it was permanently true — a toggle that could never read
                          unpressed. The name says the state and the action instead,
                          which is also what lets the word go below `sm`. */}
                <button
                  type="button"
                  data-slot="debug-mode"
                  aria-label="Debug on, turn off"
                  title="Debug is on. Click to turn it off."
                  onClick={() => {
                    toggleDebug();
                    menuTriggerRef.current?.focus();
                  }}
                  className="cursor-pointer hover:bg-solid-secondary/80"
                >
                  <BugIcon aria-hidden className="sm:hidden" />
                  <span className="hidden sm:inline">Debug</span>
                </button>
              </Badge>
            )}
            {canary && (
              // Outline and mono, never a filled pill: the version is the
              // harness's number quoted back, and a filled badge made it the
              // loudest object in the header. On-canary reads in the
              // foreground, a rollout this thread is not confirmed to be on
              // stays muted — and the words say the same, because a colour
              // difference alone says it to nobody who cannot see it.
              <Badge
                variant="outline"
                data-slot="canary-mode"
                className={cn(
                  'h-5.5 border-border/60 font-mono font-normal',
                  canary.onCanary ? 'text-foreground' : 'text-muted-foreground',
                  runShown && 'max-sm:sr-only',
                )}
                title={
                  canary.onCanary
                    ? `This thread is served by canary v${canary.version} (rollout at ${canary.weight}%).`
                    : `Canary rollout in flight: v${canary.version} at ${canary.weight}%. ` +
                      'This thread is not confirmed to be on it.'
                }
              >
                <BirdIcon aria-hidden className="sm:hidden" />
                <span className="sr-only sm:not-sr-only">canary</span>
                <span className="sr-only sm:not-sr-only">
                  {canary.onCanary
                    ? `v${canary.version}`
                    : `v${canary.version}${canary.weight < 100 ? ` @ ${canary.weight}%` : ''}`}
                </span>
                <span className="sr-only">
                  {canary.onCanary
                    ? ', this thread is on it'
                    : ', this thread is not confirmed on it'}
                </span>
              </Badge>
            )}
          </div>
        )}
      </div>

      {/*
                The attention line. Always rendered, never conditional, and in the
                header so it is the same line on both addresses: it answers the
                question an operator has before they have navigated anywhere, so it
                cannot be somewhere they have to navigate to.

                `ml-auto` puts it beside the controls. From `sm` a shrink weight far
                above the controls' makes it give way — its sentence truncates — but
                only once the thread's title in the cluster before it has reached its
                floor: on `/t` that cluster's weight is higher still. Below `sm` it is its dot, or
                two words that cannot truncate when something is waiting or failing,
                so it does not shrink at all: it shrank below them and drew "1
                waiting" over New chat and the sidebar toggle at 390px and 320px.
                There the run cluster gives instead, clipping at its own edge.
              */}
      <div className="ml-auto flex min-w-0 shrink-[100] items-center justify-end pl-2 max-sm:shrink-0">
        <AttentionLine
          approvals={tenantApprovals}
          streaming={streaming}
          handled={bannerOwned}
          bannerOnScreen={!onHarness}
          threadId={threadId}
          threads={threads}
          reasons={Object.fromEntries(pendingQueue.map((q) => [q.approvalId, q.reason]))}
          question={uiPrompt?.prompt ?? null}
          elsewhereQuestions={poolRuns.questions.filter((q) => q.threadId !== threadId)}
          queueHost={attentionHost}
        />
      </div>
      {/* `shrink-0`: the controls are what the left cluster yields to, never
                  the other way round. */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Conversation controls stay with the conversation. On `/harness` —
                    whose premise is what outlives every run — New chat, the instrument
                    and the Session menu's run verbs act on a transcript that is not on
                    screen. The door back to Chat is the one way to them. It is plain
                    navigation: the run's state is the header's first slot, on both
                    addresses.

                    From 1024 New chat is the sidebar's first row, on screen expanded
                    or as icons, so a second one here was the same button twice. It
                    stays here where the sidebar is a drawer, because there it would
                    be two clicks away. */}
        {/* Below `sm` it steps aside while a run is showing, for the room
                    the run's status needs; the drawer holds it. Never disabled: a
                    new thread leaves the run going on its own. */}
        {!onHarness && !sidebarInline && (
          <Button
            variant="ghost"
            size="sm"
            onClick={newThread}
            className={cn('gap-1.5', runShown && 'max-sm:hidden')}
            title="New chat"
          >
            <PlusIcon className="size-4" aria-hidden />
            {/* `sr-only` below `sm` rather than `hidden`, so the word is the
                        accessible name at every width and no `aria-label` has to
                        repeat it. */}
            <span className="sr-only sm:not-sr-only">New chat</span>
          </Button>
        )}
        {/* The instrument is harness view's: everyday, neither address has
                    the toggle, so nothing moves between them. */}
        {!harnessView ? (
          // Off, the right zone is the side pane's alone: its toggle shows
          // while anything is open in it, so a hidden pane is one press back —
          // on `/harness` too, where the pane sits beside the page.
          paneHasItems ? (
            <Button
              variant={pane.shown ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => setPaneShown(threadId, !pane.shown)}
              aria-pressed={pane.shown}
              aria-label="Side pane"
              aria-keyshortcuts={ariaShortcut('toggle-instrument', mac)}
              title={`Side pane (${shortcutLabel('toggle-instrument', mac)})`}
            >
              <PanelRightIcon className="size-4" />
            </Button>
          ) : (
            // Held while there is nothing to toggle, as debug holds the
            // instrument's: the attention line moved 32px left whenever
            // something opened in the pane.
            <span aria-hidden data-slot="instrument-toggle-slot" className="size-8 shrink-0" />
          )
        ) : onHarness && paneHasItems ? (
          // No instrument on `/harness`: the slot is the pane's while it holds something.
          <Button
            variant={pane.shown ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => setPaneShown(threadId, !pane.shown)}
            aria-pressed={pane.shown}
            aria-label="Side pane"
            aria-keyshortcuts={ariaShortcut('toggle-instrument', mac)}
            title={`Side pane (${shortcutLabel('toggle-instrument', mac)})`}
          >
            <PanelRightIcon className="size-4" />
          </Button>
        ) : onHarness ? (
          // The instrument toggle's slot, held empty so the attention line
          // beside it stays put: without it the line moved on every switch
          // between the two addresses.
          <span aria-hidden data-slot="instrument-toggle-slot" className="size-8 shrink-0" />
        ) : (
          <Button
            variant={inspectorOpen ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => setInspectorOpen((o) => !o)}
            aria-pressed={inspectorOpen}
            aria-label="This thread"
            aria-keyshortcuts={ariaShortcut('toggle-instrument', mac)}
            title={`This thread (${shortcutLabel('toggle-instrument', mac)})`}
          >
            <PanelRightIcon className="size-4" />
          </Button>
        )}
        {/* One menu, in one place on both addresses. On `/t` it is named
                    Session and opens on Session — it used to open on a View group,
                    so the name promised one thing and the first row was another.
                    View follows, then Theme under a label of its own: the Debug
                    checkbox and the theme radios ran together as one unlabelled list.

                    On `/harness` it holds View and Theme, so it is named **View**
                    there: a menu called Session with no session in it would be the
                    "More tools" problem again. Debug is on both addresses because it
                    governs both — the sidebar's harness pages come and go with it.
                    Theme is a set-once preference, so it holds no header slot of its
                    own. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={menuTriggerRef}
              variant="ghost"
              size="icon-sm"
              aria-label={onHarness ? 'View' : 'Session'}
              title={onHarness ? 'View' : 'Session'}
            >
              <EllipsisIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          {/* `w-64` so Copy thread id and its id sit on one row: at `w-56` the
                      row wrapped. */}
          <DropdownMenuContent align="end" className="w-64">
            {!onHarness && (
              <>
                <DropdownMenuLabel>Session</DropdownMenuLabel>
                {/* First only when there is something to pick up — a run that
                            stopped short. On a finished or empty thread the harness refuses
                            it, so it sits after Copy thread id, disabled, saying why
                            (`continueOffer`, 2026-10-16). */}
                {continueAvailable.ok && continueItem}
                {/* Cut from the middle, never the end: `threadId.slice(0, 8)` read
                            `self-pr-` for every `self-pr-*` thread. The id is whole in
                            `title`, in the accessible name, and on the clipboard.

                            `middleTruncate` is the only cut. The span does not also
                            `truncate`: a CSS ellipsis on top of a middle ellipsis would
                            drop the end of the id, which is the half that differs. */}
                <DropdownMenuItem
                  onSelect={copyThreadId}
                  title={threadId}
                  aria-label={`Copy thread id ${threadId}`}
                  className="gap-1.5 whitespace-nowrap"
                >
                  <CopyIcon className="size-4" aria-hidden />
                  Copy thread id
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                    {middleTruncate(threadId, 14)}
                  </span>
                </DropdownMenuItem>
                {!continueAvailable.ok && continueItem}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel>View</DropdownMenuLabel>
            {/* A ladder, not two switches: each level is said on its row,
                        because the names alone do not say what each one adds. */}
            <DropdownMenuRadioGroup
              aria-label="View"
              value={view}
              onValueChange={(v) => {
                if (isViewLevel(v)) chooseView(v);
              }}
            >
              {VIEW_OPTIONS.map(({ value, label, hint }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <span className="flex flex-col">
                    {label}
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            {/* Radio items, so the checked theme is announced rather than marked
                        with a glyph only a sighted reader could see. */}
            <DropdownMenuRadioGroup
              aria-label="Theme"
              value={theme}
              onValueChange={(v) => {
                if (v === 'light' || v === 'dark' || v === 'system') setTheme(v);
              }}
            >
              {THEME_OPTIONS.map(({ value, label, Icon }) => (
                <DropdownMenuRadioItem key={value} value={value} className="gap-2">
                  <Icon className="size-4" aria-hidden />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Last, past the menu: who this browser is, when it signed in with
                    GitHub or Google. Renders nothing when not signed in. */}
        <AccountChip />
      </div>
    </header>
  );
}
