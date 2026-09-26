---
target: chat-ui
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/Users/blake/Projects/felix-web/apps/chat-ui/src"
timestamp: 2026-09-26T16-06-16Z
slug: apps-chat-ui-src
---
Method: dual-agent (A: design review, live on :5190 · B: detector CLI + in-page overlay)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Attention line says "Nothing waiting on you." (green) while the approvals poll is failing; errors swallowed (attention-line.tsx:50) |
| 2 | Match System / Real World | 3 | Every History row "Untitled conversation / —" though harness ids are meaningful |
| 3 | User Control and Freedom | 2 | Narrow load opens persisted rails as stacked modals; closing rewrites desktop preference |
| 4 | Consistency and Standards | 2 | Three header grammars across /harness; Ledger tool names proportional; drawer name "Harness inspector" vs "This run" |
| 5 | Error Prevention | 3 | Approval card strong; Rewind/Regenerate one-click, no confirm |
| 6 | Recognition Rather Than Recall | 2 | History rows and Ledger rows indistinguishable |
| 7 | Flexibility and Efficiency | 3 | Real shortcuts; Mod+K focuses New chat, not search |
| 8 | Aesthetic and Minimalist Design | 3 | Calm, state-only colour; Jobs form outranks list; /harness icon-per-row |
| 9 | Error Recovery | 2 | Instrument error slab good; tool Output is one unwrapped escaped-JSON line |
| 10 | Help and Documentation | 3 | Empty states explain the mechanism |
| **Total** | | **25/40** | **Acceptable** |

## Priority Issues
- [P0] Attention line asserts all-clear (green) when it cannot see: poll failure swallowed, resting dot uses state-done against DESIGN.md's idle-off-ramp rule. harden + clarify.
- [P1] Past threads indistinguishable (Untitled conversation, per-row icon) and the run readout forgets pre-tab history. clarify.
- [P1] Narrow widths open persisted rails as stacked modals and overwrite desktop preference. adapt.
- [P2] /harness: three header grammars, Ledger reads as admin table, Jobs form above list, no <main>. distill + polish.
- [P2] Tool evidence: Output <pre> unwrapped, MCP targets raw JSON. polish.

## Detector
CLI: [] (exit 0). Overlay: / 6 (flat hierarchy + tiny text = system's own 11/13/16 ramp; line-length on the 11px empty-thread sentence = real; composer hairline+shadow = known; nested cards composer/rail = check), /harness/memory 2, /harness/ledger 2; `transition: height` is sonner's (false positive).
