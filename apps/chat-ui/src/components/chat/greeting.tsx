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
    // `flex-1` rather than a fixed min-height: the greeting is the only child of the
    // transcript column when a thread is empty, so it should centre in whatever height
    // is actually available. The old `min-h-[min(52vh,28rem)]` pinned it to the top of
    // the scroll area and left a measured 221px gap above the composer at 906px tall,
    // and 818px on a 1503px display.
    // `max-w-3xl` matches the composer and the transcript; at `max-w-2xl` the empty
    // state was 96px narrower than the content that replaces it, so everything shifted
    // sideways on the first message.
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 py-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {manifest}
        </p>
        <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-[1.75rem]">
          What do you want to work on?
        </h2>
        <p className="max-w-prose text-pretty text-base text-muted-foreground">
          You&apos;re chatting with <span className="font-medium text-foreground">{manifest}</span>.
          Pick a starter or type below; you can switch agents anytime from the composer.
        </p>
      </div>
      <SuggestedActions manifest={manifest} disabled={disabled} onSend={onSend} />
    </div>
  );
}
