---
target: chat-ui
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/blake/Projects/felix-web/apps/chat-ui/src"
timestamp: 2026-09-26T14-01-32Z
slug: apps-chat-ui-src
---
Method: dual-agent (A: design review · B: detector) — no browser evidence (:5173 served a different app; plan mode blocked overlay).

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | "This run" rail carries no run-scoped data |
| 2 | Match System / Real World | 3 | "This run" label is false; tabs are tenant-wide |
| 3 | User Control and Freedom | 3 | ui_request offers No and Cancel undistinguished |
| 4 | Consistency and Standards | 2 | One approval, three surfaces, three info levels; type scale drift vs DESIGN.md |
| 5 | Error Prevention | 3 | Inspector approves with no diff/reason/deadline |
| 6 | Recognition Rather Than Recall | 2 | Collapsed tool header shows name only |
| 7 | Flexibility and Efficiency | 1 | No global keyboard shortcuts |
| 8 | Aesthetic and Minimalist Design | 2 | Scaffolded-chat residue; 7-control composer footer |
| 9 | Error Recovery | 3 | describeError + Retry everywhere |
| 10 | Help and Documentation | 2 | Explanations live in hover-only title= |
| **Total** | | **24/40** | **Acceptable** |

## Priority Issues
- [P1] "This run" isn't about this run — add fixed run readout (state, elapsed, steps, tokens/cost, current tool); scope or rename tabs. clarify + layout.
- [P1] Inspector Approvals re-offers banner-owned approvals with less info — apply attention line's handled exclusion; pass expires_at/reason. harden.
- [P1] Transcript wears scaffolded-chat default (greeting 28px, haiku starters, bubble, avatar, typing dots, wrench icons). distill + quieter.
- [P2] No keyboard layer. harden.
- [P2] Approval deadline + grant sentence in 11px muted footer. typeset.

## Minor
reattach notice uses running blue for stopped; popover empty copy "composer below"; Plans empty copy assumes `deep`; autoFocus in ui-prompt-banner; second h1 on mobile /harness; composer 13px vs message 16px; DESIGN.md stale (11/13/16 scale, no rounded.full).
