---
target: the composer
total_score: 29
p0_count: 0
p1_count: 2
timestamp: 2026-08-24T00-58-29Z
slug: s-chat-ui-src-components-chat-multimodal-input-tsx
---
# Critique: the composer

Target `apps/chat-ui/src/components/chat/multimodal-input.tsx` (672 lines) and the `prompt-input` primitive it wraps (1,175). Driven live against the harness on `:8080`.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Rich state feedback, undercut by a hint that contradicts it mid-run |
| 2 | Match System / Real World | 3 | Plain, specific copy throughout; "Background" is a bare noun for an unexplained mode |
| 3 | User Control and Freedom | 2 | Escape dismisses the slash menu permanently, with no way back |
| 4 | Consistency and Standards | 3 | Three colour vocabularies inside one file after the app moved to a state palette |
| 5 | Error Prevention | 3 | Length, file type, size and count all guarded with specific messages |
| 6 | Recognition Rather Than Recall | 3 | Slash menu, model descriptions, previews, labels; weakened by the Escape trap |
| 7 | Flexibility and Efficiency | 4 | The best-built thing in the app |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained and on-ramp; one decorative hover scale |
| 9 | Error Recovery | 2 | A complete disconnected state exists in code and can never render |
| 10 | Help and Documentation | 3 | Keyboard hint, command and model descriptions, specific errors |
| **Total** | | **29/40** | **Good** |

The composer is the strongest surface in the product and the only one this session to earn a 4. The defects are behavioural rather than visual: measured, it is clean.

## Anti-Patterns Verdict

**Deterministic scan:** `detect.mjs` over both files returns **0 findings**.

**LLM assessment:** no tells. The composer does not look generated, it looks worked on. Placeholder copy shifts with run state, error messages name the specific limit that was hit, the model picker deliberately renders only the label in the toolbar with a comment explaining why, and there is a hand-written comment about `InputGroup` collapsing the textarea to a one-character column. That is the texture of something debugged against reality.

The one decorative flourish is `hover:scale-105 active:scale-95` on the stop button. It conveys nothing, though the reduced-motion block already neutralises it.

**Measured craft**, at a 1571px viewport in dark:

- placeholder contrast **7:1** against its field, comfortably past the 4.5 the rules single out as the usual failure
- every control **32px** or larger, above the 24px WCAG 2.5.8 minimum
- type entirely on the ramp, 11px and 13px only
- one element below 4.5:1, the disabled Background button, exempt under WCAG 1.4.3

## Overall Impression

Someone clearly cared about this file, and it shows in the parts you feel rather than see: focus returns after a send, the slash menu supports arrow keys and Tab, interim speech shows beside the mic instead of corrupting what you typed, dropping a file is tracked with a depth counter so nested dragleave events do not flicker the overlay.

What it lacks is a second pass over the things that only appear in states nobody exercises. Two of the three real defects are invisible unless you press Escape or lose your connection, and both were found by trying rather than reading.

## What's Working

1. **The accelerator set is genuinely excellent.** Enter sends, Shift+Enter breaks, Enter steers a live run, `/` opens a filtered command menu with arrow-key and Tab selection, voice input appends on final transcripts, images drag, drop, or paste, the agent switches inline, and focus returns to the field after every send. This is the one surface where an expert is properly served.

2. **Errors name the limit that was hit.** "Max 4 attachments", "Max 10MB per file", "Only image files are supported right now", "Unknown command: /foo". Each says which rule stopped you, not that something went wrong.

3. **Interim speech does not touch the textarea.** Finalized chunks append with a space; the in-progress transcript renders beside the mic. That preserves the ability to edit between utterances, and the reason is written down.

## Priority Issues

### [P1] Escape kills the slash menu for the rest of the session

Reproduced live: type `/` (menu opens), press Escape (menu closes), clear the field and type `/` again, and **the menu does not come back**.

`slashDismissed` is set by Escape and reset in exactly two places: selecting a command, and this effect:

```ts
// Re-enable slash command menu after text changes (clears the user's explicit Escape dismissal)
useEffect(() => {
  setSlashDismissed(false);
}, []);
```

The dependency array is empty, so it runs once on mount. The comment describes behaviour the code does not have. Since the only other reset requires selecting a command from the menu that is no longer showing, the feature is unreachable until reload.

**Fix:** depend on `text`, which is what the comment already claims.

**Suggested command:** `/impeccable harden`

### [P1] The disconnected state is built and unreachable

`isConnected` is passed as a bare prop at `App.tsx:1272`, so it is always `true`. Everything behind it is dead:

- `<ConnectionBanner />` with its "Reconnecting to the assistant" pill
- the `'Reconnecting…'` helper text and the spinner branch in `HelperHint`
- the `if (!isConnected) toast.error('Disconnected. Reconnecting…')` guard in `handleSubmit`
- the `isConnected` term in both `canSubmit` and `canBackground`

This is a client whose entire job is a streaming HTTP connection to a harness that is frequently a local process. It does lose the connection. The affordance for saying so was designed, built, styled, and then never wired to anything that knows.

**Fix:** derive it from something real, the SSE stream's error state or a failed poll, so the safety net that already exists can actually catch.

**Suggested command:** `/impeccable harden`

### [P2] Three statements about the Enter key, at once, during a run

Captured mid-stream:

| Where | Says |
|---|---|
| placeholder | "Type to steer the run…" |
| helper hint | "Generating. Press Enter to steer." |
| persistent hint below | "↵ to send" |

Two say steer, one says send, and the one that says send is the one that never changes. `KeyboardHint` is static while everything around it is state-aware.

**Fix:** make the hint reflect run state, or drop it while streaming, since the helper already carries the message.

**Suggested command:** `/impeccable clarify`

### [P2] Three colour vocabularies inside one file

The app moved to `--state-*` tokens, and this file now mixes all three generations:

- the mic's listening state uses `bg-state-failed/15 text-state-failed`
- its own pulse ring, two lines below, uses `bg-destructive/20`
- the drag state and drop overlay use `border-primary/60 bg-primary/5 ring-primary/25 text-primary`

The mic one is mine and it is a real mistake: an earlier pass swapped every `text-destructive` to `text-state-failed` mechanically, and red on a mic means *recording*, not *failed*. Coupling them means a future change to the failure colour silently restyles the microphone.

**Fix:** give recording its own token, or accept red and name it something that is not failure. Drag/drop is a fourth state and deserves its own decision rather than the leftover `primary`.

**Suggested command:** `/impeccable colorize`

## Persona Red Flags

**Alex (power user):** genuinely well served here, which makes the Escape trap sting more: the one keyboard user most likely to press Escape to dismiss a menu is the one who loses the feature permanently.

**Jordan (first-timer):** sees a button labelled "Background" next to Send, with no tooltip, no description, and no indication that it starts a run that continues without them. It is the only control in the composer whose label is a bare noun rather than an action.

**Sam (accessibility):** well handled. Every control carries an `aria-label`, the textarea now has one, `aria-invalid` is set when over length, the character count is `aria-live="polite"`, and the decorative separator is `aria-hidden`. The mic's listening state is colour plus an icon swap plus the interim transcript, so it is never colour alone.

**Riley (stress tester):** types 32,100 characters and finds the count appears only past 28,800, then hits a hard `maxLength` stop at 32,200 with a toast that fires on submit rather than on typing. Presses Escape once and loses slash commands. Pulls the network cable and the interface says nothing at all.

## Minor Observations

- The `memo` comparator deliberately omits every callback prop. I traced the obvious exploit, switching threads with the same manifest so no compared prop changes, and it holds: the send path reads `threadIdRef.current` rather than the closed-over `threadId`. Safe by construction today, but it means any future callback that closes over state without a ref will go stale silently, and nothing marks that requirement.
- `hover:scale-105` on the stop button is the only decorative motion in the app.
- The character counter appears at 90% of the limit, which is 28,800 characters. Nothing indicates a limit exists before that.
- `navigator.vibrate?.(5)` on slash select is a no-op on desktop; harmless but only ever fires where it cannot be felt.

## Questions to Consider

- If Enter steers during a run, is the persistent hint pulling its weight at all, or is the placeholder enough?
- "Background" is the only mode in the product that changes what happens after you look away. Should it be a button beside Send, or a choice you make about the message?
- The disconnected state was designed carefully and never wired. Is the right fix to wire it, or to admit the app has no connection model and build one deliberately?
