---
summary: Motion purpose, durations, reduced motion, and progress/feedback patterns.
tier: conditional
loadWhen:
  - dashboard or timeline screens
  - overlay, inspector, or master-detail screens
  - animation or transition work
  - loading, progress, or optimistic-update feedback
---

# Standard: Motion and feedback

## Purpose

Motion **MUST** do at least one job:

- explain where an element came from or went;
- preserve continuity between states;
- confirm an action;
- direct attention to a consequential change;
- communicate progress without blocking the task.

If motion performs no job, remove it.

## Motion tokens

This guideline is the authoritative motion source; the kit ships no motion token set. Timing:

- instant: 0 ms for reduced-motion substitutions and direct state changes;
- fast: 100 ms for hover, press and small opacity changes;
- standard: 160 ms for menus, tooltips and compact state changes;
- deliberate: 240 ms for dialogs, inspectors and spatial transitions;
- slow: 320 ms for rare large-layout transitions.

Durations above 400 ms **SHOULD** be reserved for intentional narrative or onboarding sequences, not routine product work.

Easing:

- enter: decelerating curve;
- exit: accelerating curve;
- move: standard ease-in-out;
- linear: only for continuous progress or time representation.

## Animation properties

- Prefer `opacity` and `transform` for routine transitions.
- Avoid animating layout properties across large subtrees when a transform can communicate the same movement.
- Do not scale text directly; animate a wrapper when scaling is necessary.
- Late-arriving content follows the layout guideline's geometry-reservation rule; do not animate layout to compensate for it.
- Infinite animation **MUST** be limited to genuine ongoing progress and stop when the operation completes or fails.

## Interaction feedback

- Press feedback should be immediate.
- Hover feedback **MUST NOT** be the only indication that an element is interactive.
- Pending actions **MUST** show progress in the action region; duplicate-execution prevention is defined in the accessibility guideline's state rules.
- Optimistic updates **MUST** have a rollback or clear error path.
- Toasts **MUST NOT** carry the only copy of a consequential failure.
- Success feedback follows the accessibility guideline's state rules (confirm the changed entity, persist long enough) and avoids blocking the next task.

## Spatial rules

- Menus and popovers originate from their trigger.
- Inspectors enter from the edge they occupy or appear without translation when reduced motion is requested.
- List reordering preserves object continuity; do not flash or fully reload the surface when only one row changed.
- Route changes **SHOULD NOT** animate unrelated regions.

## Reduced motion

- Respect `prefers-reduced-motion: reduce`.
- Replace spatial travel with a short opacity change or immediate state update.
- Preserve progress, state and focus cues.
- Disable parallax, bounce, spring overshoot and decorative looping.

## Motion rejection examples

Reject:

- staggered entrance animation on every operational table row;
- bouncing primary buttons;
- different easing for every component;
- a spinner with no accessible status;
- motion that delays input;
- an inspector that slides over the focused content without moving focus;
- transitions that still travel large distances in reduced-motion mode.

