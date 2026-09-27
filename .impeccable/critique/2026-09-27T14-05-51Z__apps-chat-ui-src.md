---
target: chat-ui
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/blake/Projects/felix-web/apps/chat-ui/src"
timestamp: 2026-09-27T14-05-51Z
slug: apps-chat-ui-src
---
Method: dual-agent (A: design review, live on :5190 @ 62dd23d · B: detector CLI + in-page overlay)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | "This run" heading over three tabs scoped "All threads" |
| 2 | Match System / Real World | 3 | History / Threads / conversation / sessions / chat name one thing |
| 3 | User Control and Freedom | 2 | Reload on /harness then Chat mints a new thread; Continue run unexplained |
| 4 | Consistency and Standards | 2 | Header id end-cut (slice(0,8)) vs middle-cut rule; header rule heights differ per /harness page |
| 5 | Error Prevention | 3 | Agent change on a past thread is silent |
| 6 | Recognition Rather Than Recall | 2 | Untitled threads are end-cut UUIDs; picker has no capability hints |
| 7 | Flexibility and Efficiency | 3 | Good key map |
| 8 | Aesthetic and Minimalist Design | 3 | Calm; dot grid and all-green OK dots the exceptions |
| 9 | Error Recovery | 2 | Ledger "3 failed" over 12 drawn rows with no way to see the rest |
| 10 | Help and Documentation | 3 | Empty copy explains mechanism; Tools empty copy ignores the thread |
| **Total** | | **26/40** | **Acceptable** |

## Priority Issues
- [P1] "Touched this session" lists files only mentioned in any string argument (collectToolCallPaths walks every string incl. a PR body). clarify.
- [P1] Instrument heading "This run" contradicts tenant-wide tabs; Tools empty copy ignores a thread that used tools. distill/clarify.
- [P2] Returning to threads: end-cut UUIDs, 5-row popover, header id slice(0,8), /harness reload + Chat mints a new thread, opens mid-prompt. harden.
- [P2] Dot-grid radial-gradient (#208) contradicts DESIGN.md "no gradient anywhere". quieter or document.
- [P3] Agent picker: proportional names (Provenance Rule), no capability line, silent change on a past thread. clarify.

## Detector
CLI [] (0). Overlay: fresh thread 7, self-pr-306 10, /harness/ledger 3 — tiny-text (all 11px Label/Value, by design), flat hierarchy (documented ramp), transition: height (sonner), nested-cards (ScrollArea/input-group wrappers, likely false), one intentional truncate, ~90ch transcript line (within max-w-3xl spec).
