# Product

## Register

product

## Users

Two audiences share one surface, and the design has to hold both.

**Operators** run real agent work through `chat-ui`: they send a turn, watch tool calls land,
approve or deny gated actions, and read token spend afterwards. Some wrote the harness; some did
not. Their context is a wide desktop window, often with a run already in flight, attention split
between the transcript and whatever the agent is doing underneath it. The job to be done is *know
what the agent just did, and whether to let it continue*.

**Demo viewers** see the same screen cold, over someone's shoulder or a shared window. They have no
mental model of manifests, leases, or plan steps. They should be able to tell, without narration,
that this is a control surface for something autonomous and that the machinery is on display
deliberately.

## Product Purpose

`chat-ui` is the instrument panel for a self-hosted agent harness. It is not a chat app that happens
to log tool calls; it is a window onto a running process that happens to accept messages. Everything
the harness does — tool invocations, approvals, plans, skills, token meters, audit events — is
supposed to be visible, in near real time, without leaving the conversation.

Success looks like: an operator can answer "what is it doing, is it healthy, and what did it cost"
in one glance at the right rail, and can find a past session in the left rail in under three
seconds. Failure looks like: the transcript is readable but the rails are wallpaper, so the operator
falls back to reading harness logs in a terminal.

## Brand Personality

**Instrumented, calm, exact.**

- *Instrumented*: the mechanism is the product. Show real states, real numbers, real event types.
  Never summarize the machine into a friendlier fiction.
- *Calm*: an autonomous process is already generating uncertainty. The UI does not add to it. No
  alarm colors for ordinary states, no motion that competes with streaming text, no celebration.
- *Exact*: a number is a number, a status is the status the harness reported. Precision over warmth,
  and never rounding away information the operator would act on.

Voice: plain declaratives that name the mechanism. "Deciding resumes the paused run" over "You're
all set!". Second person only where the operator must act.

## Anti-references

Four failure modes, all of which this codebase is currently within reach of:

1. **The scaffolded AI chat default.** Untouched neutral token set, `rounded-xl` bordered cards
   stacked to the bottom of every panel, an icon on every row, a gradient somewhere. Recognizable as
   generated rather than designed. This is the closest and most urgent one.
2. **Density without hierarchy.** The observability-dashboard failure: every panel equally loud,
   chrome on every metric, nothing edited down, so the operator's eye has nowhere to land. Density
   is fine; undifferentiated density is not.
3. **Consumer-chat warmth.** Big friendly empty states, avatars, the harness tucked out of sight.
   Hiding the mechanism is the opposite of the product's purpose.
4. **Warm-neutral editorial.** Cream body, serif display, marketing cadence leaking into product
   copy. Wrong register entirely.

## Design Principles

1. **The mechanism is the interface.** When a choice is between showing what the harness actually
   reported and showing a tidier abstraction of it, show the harness. Tidy the *presentation*, never
   the truth.
2. **Rank before you render.** Every panel must answer "what should the eye hit first" before it
   answers "what data do I have". Uniform treatment of non-uniform information is the house bug.
3. **One shell, not three panes.** The transcript and both rails are one instrument. They share a
   spatial system, a header grammar, and a density scale; they do not each invent their own.
4. **Color carries state, nothing else.** In a surface where color is the fastest channel for
   "healthy / waiting / failed", spending it on decoration is spending the operator's attention.
5. **Legible cold.** A viewer with no harness knowledge should be able to read the shape of what is
   happening. Labels say what the thing is, not what the API field is called.

## Unattended runs

A background run (`POST /chat` → a durable run the tab polls) breaks the assumption the rest of this
document rests on: that an operator is present. It can block on an approval minutes after the tab
lost focus, and a durable run carries no frames, so nothing arrives to render.

The audience does not change — it is the same operator, in a different posture. Present, they want
the mechanism on display because they are supervising. Elsewhere, they want it quiet until it needs
them, and complete and immediate when it does. Two rules follow:

- **Assume competence.** This surface is reached by running the harness yourself and holding the
  gate key. No onboarding, no explanatory chrome, no softened language for concepts the operator
  configured on their own machine.
- **Do not assume attention.** Every state the operator would act on has to survive an unwatched
  tab. A signal that exists only in the viewport does not exist. Today that means `document.title`
  and — when the tab is hidden and permission was granted from a real gesture — an OS notification,
  plus an `/approvals` poll for the frames a durable run cannot deliver.

This was briefly a second app (`float`), on the theory that the unattended case wanted its own
surface at lower density. It did not: what it actually contributed was the second rule above, which
is a mode, not a product. Removed 2026-08-23.

## Accessibility & Inclusion

**WCAG 2.2 AA, enforced.** Contrast failures, missing focus indication, keyboard-unreachable
controls, and unhandled `prefers-reduced-motion` are treated as defects, not polish.

Specific commitments for this surface:

- Body and metadata text meets 4.5:1 in both themes. The current 10-11px `text-muted-foreground`
  metadata is the standing risk and is measured, not assumed.
- Status is never encoded in color alone. Every state dot carries a text label or shape.
- Both rails are fully keyboard operable, including delete affordances that today only appear on
  hover.
- Live-updating regions (activity feed, streaming transcript) announce politely and do not steal
  focus.
- Text sizes below 11px are treated as a smell requiring justification, not a density tool.
