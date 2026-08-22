import { SuggestedActions } from './suggested-actions';

/**
 * Empty-conversation overview: welcome + starter prompts for the active agent.
 */
export function Greeting({
  manifest,
  disabled,
  onSend,
}: {
  manifest: string;
  disabled?: boolean;
  onSend: (text: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-[min(52vh,28rem)] w-full max-w-2xl flex-col justify-center gap-8 px-1 py-4">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {manifest}
        </p>
        <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-[1.75rem]">
          What do you want to work on?
        </h2>
        <p className="max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
          You&apos;re chatting with <span className="font-medium text-foreground">{manifest}</span>.
          Pick a starter or type below — switch agents anytime from the composer.
        </p>
      </div>
      <SuggestedActions manifest={manifest} disabled={disabled} onSend={onSend} />
    </div>
  );
}
