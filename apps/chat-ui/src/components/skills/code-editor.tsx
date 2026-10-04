import { useDeferredValue, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { highlight, languageForPath } from './highlight';

/**
 * A plain textarea over a highlighted mirror: the textarea is transparent and
 * holds the caret, selection, undo stack and IME; the `<pre>` behind it paints
 * the colours. No editor library, because a skill file is short and the
 * transcript already ships one code renderer.
 *
 * Tab indents two spaces; Shift+Tab moves focus back as it does anywhere else,
 * and Escape then Tab moves it on, so the textarea is never a keyboard trap.
 * The hint is the field's description, so a screen reader says how out.
 *
 * `readOnly` keeps the same surface for a stored version: the text can still be
 * focused, selected and copied, but Tab moves focus as it does anywhere else.
 *
 * Under forced colours the browser repaints the transparent textarea's text in
 * the system colour, so the mirror is hidden there (`index.css`) rather than
 * drawn twice.
 */

/** Past this many characters the mirror is re-highlighted a render behind the typing. */
const DEFER_HIGHLIGHT_CHARS = 100_000;

export type CodeEditorHandle = {
  focusLine: (line: number) => void;
};

// The textarea and the highlight mirror must share identical font metrics —
// same class, same padding — or the caret drifts off the painted text.
// `skill-code` is the hook `index.css` sizes all three by on a touch screen, where
// text fields go to 16px and a mirror left at 11px would put the caret mid-word.
const SURFACE_CLASSES = 'skill-code font-mono text-xs leading-5 whitespace-pre p-3 pr-8';

export function CodeEditor({
  path,
  value,
  onChange,
  readOnly = false,
  errorLines,
  issuesId,
  className,
  ref,
}: {
  path: string;
  value: string;
  onChange?: (value: string) => void;
  /** Viewable, selectable and copyable, but not editable. */
  readOnly?: boolean;
  errorLines?: Set<number>;
  /** The id of the list of validation issues, when there are any. */
  issuesId?: string;
  className?: string;
  ref?: React.Ref<CodeEditorHandle>;
}) {
  const hintId = useId();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [escapePressed, setEscapePressed] = useState(false);

  const lineCount = useMemo(() => value.split('\n').length, [value]);
  // A large file is highlighted from a deferred copy, so a keystroke never
  // waits on re-tokenizing the whole of it; the caret is the textarea's, so
  // nothing typed is lost while the colours catch up.
  const deferred = useDeferredValue(value);
  const source = value.length > DEFER_HIGHLIGHT_CHARS ? deferred : value;
  const highlighted = useMemo(() => highlight(source, languageForPath(path)), [source, path]);

  useImperativeHandle(ref, () => ({
    focusLine: (line: number) => {
      const textarea = textareaRef.current;
      const scroller = scrollerRef.current;
      if (!textarea || !scroller) return;
      const lines = textarea.value.split('\n');
      const offset =
        lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0) +
        (lines[line - 1]?.length ?? 0);
      textarea.focus();
      textarea.setSelectionRange(offset, offset);
      const lineHeight = 20; // matches leading-5
      scroller.scrollTop = Math.max(0, (line - 1) * lineHeight - scroller.clientHeight / 2);
    },
  }));

  const insertText = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // execCommand keeps the native undo stack intact where supported.
    const inserted = document.execCommand?.('insertText', false, text);
    if (!inserted) {
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
      onChange?.(textarea.value);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    if (event.key === 'Escape') {
      setEscapePressed(true);
      return;
    }
    if (event.key === 'Tab' && !escapePressed && !event.shiftKey) {
      event.preventDefault();
      insertText('  ');
      return;
    }
    setEscapePressed(false);
  };

  return (
    <div
      ref={scrollerRef}
      className={cn(
        'max-h-[560px] overflow-auto rounded-md border border-border/60 bg-code-surface',
        className,
      )}
    >
      <div className="flex w-max min-w-full">
        <div
          aria-hidden
          className="sticky left-0 z-10 shrink-0 select-none border-r border-border/60 bg-code-surface py-3 text-right font-mono text-xs leading-5 text-muted-foreground"
        >
          {Array.from({ length: lineCount }, (_, index) => (
            // Row N is line N: the index is the identity.
            <div key={`ln-${index + 1}`} className="relative px-3">
              {errorLines?.has(index + 1) && (
                <span
                  className="absolute top-1.5 left-1 size-1.5 rounded-full bg-state-failed"
                  title="A validation issue is on this line"
                />
              )}
              {index + 1}
            </div>
          ))}
        </div>
        <div className="relative flex-1">
          <pre
            aria-hidden
            className={cn(
              SURFACE_CLASSES,
              'skill-code-mirror pointer-events-none m-0 text-foreground',
            )}
            // The output of our own escaping tokenizer: every input byte is escaped.
            dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }}
          />
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            onKeyDown={onKeyDown}
            readOnly={readOnly}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={`${path} source`}
            aria-describedby={
              [readOnly ? null : hintId, issuesId].filter(Boolean).join(' ') || undefined
            }
            aria-invalid={issuesId ? true : undefined}
            data-skill-source
            className={cn(
              SURFACE_CLASSES,
              'absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-foreground outline-none selection:bg-foreground/15 selection:text-transparent',
            )}
          />
        </div>
      </div>
      {!readOnly && (
        <p id={hintId} className="sr-only">
          Tab inserts two spaces; Escape then Tab leaves the editor.
        </p>
      )}
    </div>
  );
}
