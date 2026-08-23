import { Button } from '@felix/ui/button';
import { CircleAlertIcon } from 'lucide-react';
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /**
   * What to show instead of `children` when they throw. Gets `reset`, which clears
   * the caught error and re-mounts the subtree; useful when the cause was transient,
   * like one malformed poll response.
   */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** Prefix for the console error, so the log says which subtree failed. */
  label: string;
}

interface State {
  error: Error | null;
}

/**
 * Stops one broken subtree from taking the whole app with it.
 *
 * This exists because it already happened: a panel whose response shape had
 * drifted threw during render, React unmounted the entire tree, and the window
 * went white with the transcript and composer gone. Nothing in the app is worth
 * losing the conversation over.
 *
 * Error boundaries have to be class components; there is no hook equivalent.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`[${this.props.label}] render failed`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) return this.props.fallback(error, this.reset);
    return this.props.children;
  }
}

/** Compact inline fallback for a panel inside a larger, still-working surface. */
export function PanelErrorFallback({
  error,
  reset,
  what,
}: {
  error: Error;
  reset: () => void;
  what: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-state-failed/30 bg-state-failed/10 px-2.5 py-2 text-xs text-state-failed"
    >
      <div className="flex items-start gap-2">
        <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">{what} could not be displayed</p>
          <p className="mt-0.5 font-mono break-words">{error.message}</p>
        </div>
      </div>
      <Button size="sm" variant="outline" className="h-7 self-start text-xs" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}

/**
 * Whole-app fallback. Deliberately offers reload rather than `reset`: if the root
 * threw, the failure is not scoped to one panel and re-mounting the same state is
 * likely to reproduce it.
 */
export function AppErrorFallback({ error }: { error: Error }) {
  return (
    <div role="alert" className="flex h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold tracking-tight">
          Felix hit an error it can't recover
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Reloading usually clears it. Your conversations are stored locally and are not affected.
        </p>
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-border/50 bg-muted/40 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {error.message}
        </pre>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Reload Felix
        </Button>
      </div>
    </div>
  );
}
