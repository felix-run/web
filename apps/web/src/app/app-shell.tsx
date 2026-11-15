import { SidebarInset, SidebarProvider } from '@felix/ui/sidebar';
import { Outlet } from 'react-router';
import { ShellProvider } from '@/app/shell-context';
import { AppSidebar } from '@/components/app-sidebar';
import { RewindFilesDialog } from '@/components/chat/rewind-files-dialog';
import { HarnessHealthLine } from '@/components/harness-health-line';
import { ShellHeader } from './shell-header';
import { useAppController } from './use-app-controller';

export function AppShell() {
  const controller = useAppController();
  const { shell, sidebarInline, setAttentionHost, fileQuestion, setFileQuestion } = controller;
  const { historyOpen, setHistoryOpen, debug } = shell;
  return (
    // `--vvh` is the visual viewport while an on-screen keyboard covers part of the
    // layout one (use-visual-viewport.ts); otherwise `dvh`, which follows Safari's
    // toolbar where `h-screen` (the *large* viewport) put the composer under it.
    // The side insets are on the shell rather than on each zone: a phone on its
    // side has the notch at one edge, and everything inside clears it at once.
    <div className="flex h-[var(--vvh,100dvh)] flex-col bg-ground px-safe-0">
      {/*
        The address decides what renders here. The engine, the thread and the
        approval queue are above it deliberately: mounting `createChatEngine`
        inside a route would unmount it on a visit to any other address, and
        take a live run down with it.
      */}
      <ShellProvider value={shell}>
        {/* The first Tab stop: past the sidebar's list, its workspace and the
            harness's nine pages to whatever the address shows. Every address puts
            its content in one `main`; focus moves there rather than to an anchor,
            because the sheet scrolls itself and the page never does. Its padding
            is stated under `focus:`, since `not-sr-only` resets padding to 0. */}
        <button
          type="button"
          onClick={() => {
            const main = document.querySelector('main');
            if (!main) return;
            main.tabIndex = -1;
            main.focus();
          }}
          className="sr-only rounded-md bg-background text-sm font-medium text-foreground shadow-sheet outline-none focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          Skip to content
        </button>
        <SidebarProvider
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          openMobile={historyOpen}
          onOpenMobileChange={setHistoryOpen}
          mobile={!sidebarInline}
        >
          {/* Full height, beside the header rather than under it, so its top edge
              can carry the brand on the header's own line. */}
          <AppSidebar />
          {/* The sheet: everything but the sidebar sits on one surface lifted off the
              stone ground. Inline (from 1024) it floats with a margin and the largest
              radius; as a drawer layout it is the whole screen, edge to edge. */}
          <SidebarInset className="bg-background lg:my-2 lg:mr-2 lg:overflow-hidden lg:rounded-2xl lg:shadow-sheet">
            {/* The inset is added to the bar's height rather than taken out of it:
                `--header-height` is read by the toaster and must stay the bar's own. */}
            <ShellHeader controller={controller} />

            {/* The attention line's queue opens here, under the bar the line sits
                on, in the flow — it pushes the page down rather than covering it. */}
            <div ref={setAttentionHost} className="contents" />
            {/* One line for every read the harness did not answer for a reason
                that passes — a 429, a 503, no answer at all — in place of a red
                box per panel (`lib/harness-health.ts`). */}
            <HarnessHealthLine debug={debug} />

            <Outlet />
          </SidebarInset>
        </SidebarProvider>
        <RewindFilesDialog
          files={fileQuestion?.files ?? null}
          onAnswer={(answer) => {
            fileQuestion?.answer(answer);
            setFileQuestion(null);
          }}
        />
      </ShellProvider>
    </div>
  );
}
