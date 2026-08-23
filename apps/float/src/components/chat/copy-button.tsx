import { CheckIcon, CopyIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/** Copy a turn's text, with the usual two-second confirmation. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const onCopy = useCallback(() => {
    // `navigator.clipboard` is undefined on a non-secure origin, and rejects
    // when the document is not focused. Neither is worth an error toast.
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => {});
  }, [text]);

  return (
    <button
      type="button"
      className="text-muted-foreground transition-colors hover:text-foreground"
      onClick={onCopy}
      title={label}
      aria-label={label}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </button>
  );
}
