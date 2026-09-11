---
summary: WCAG 2.2 AA baseline, semantic structure, keyboard behavior, and the required state inventory.
tier: core
---

# Standard: Accessibility, semantics and states

## Baseline

- Target WCAG 2.2 AA. The product **MAY** enforce stricter house rules.
- Use native semantic HTML and UI-kit primitives before adding ARIA.
- Follow the WAI-ARIA Authoring Practices keyboard model for composite widgets.
- Accessibility **MUST** be designed into component anatomy; it is not a final annotation pass.

## Structure and names

- Use one page `h1`; headings **MUST** form a meaningful hierarchy.
- Landmarks **MUST** identify navigation, main content and complementary regions where applicable.
- Every field **MUST** have a persistent programmatic label.
- Every icon-only control **MUST** have an accessible name and, when meaning is not universal, a visible tooltip.
- Link and button labels **MUST** describe their result outside surrounding copy. Avoid `Click here`, `Open`, or `Continue` when a specific label is possible.
- Decorative icons **MUST** be hidden from assistive technology.

## Keyboard and focus

Kit components deliver their own keyboard mechanics — tab/arrow models, modal focus trap and return, Escape handling — while used unmodified (the `kitGuaranteed` boundary from `component-state-matrix.json`). The application owns:

- All actions **MUST** work without a pointer, including app-composed ones.
- Focus order **MUST** follow visual and task order.
- Dismissal **MUST** never discard work silently.
- Focus **MUST** remain visible and **MUST NOT** be obscured by sticky or floating UI.
- The house focus indicator **SHOULD** meet the WCAG 2.2 Focus Appearance geometry and 3:1 state contrast even though that criterion is AAA.

## Contrast and non-color cues

- Normal text: at least 4.5:1.
- Large text: at least 3:1.
- Meaningful component boundaries, states and focus indicators: at least 3:1 against adjacent colors.
- Status, severity, selection and validation **MUST** combine color with text, shape or an icon.
- Disabled state **MUST** remain understandable even though inactive components are exempt from some contrast criteria.

## Reflow, zoom and targets

- Text **MUST** resize to 200% without loss of content or function.
- Content reflow at 320 CSS px is governed by the layout guideline's overflow rules (LAY-002); verify it as part of this section's review.
- Pointer targets **MUST** satisfy WCAG 2.2's 24 × 24 CSS px minimum or its spacing exception.
- Dragging **MUST** have a single-pointer alternative unless dragging is essential.
- Hover-only information **MUST** also appear on keyboard focus and be dismissible, hoverable and persistent as required by WCAG.

## Motion and sensory safety

- Respect `prefers-reduced-motion`.
- Reduced motion **MUST** preserve state understanding and task completion.
- Do not use flashing, continuous parallax or motion triggered by ordinary scrolling as the only explanation of change.
- Autoplaying movement lasting more than five seconds **MUST** be pausable, stoppable or hideable when WCAG applies.

## Required state inventory

For each data region or action, explicitly mark applicable states:

- initial/loading;
- empty;
- populated;
- selected and focused;
- stale or partially updated;
- restricted/permission denied;
- offline or unavailable;
- validation error;
- server or dependency error;
- submitting/pending;
- success;
- destructive confirmation and completion.

Do not generate every state visually at once; implement the state model and representative screens.

## State behavior

- Loading **SHOULD** preserve final structure — the layout guideline's geometry-reservation rule. Skeletons are for predictable content shapes, not arbitrary waiting decoration.
- Empty states **MUST** state scope and next valid action. A filtered empty state **MUST** preserve and expose the active filters.
- Stale or partial states **MUST** preserve the last trustworthy value, label its age and identify what failed.
- Errors **MUST** say what failed, what remains safe or available and how to recover.
- Empty and restricted states **MUST** distinguish no data, no matching data, missing permission and failed loading.
- Pending actions **MUST** prevent accidental duplicate submission while preserving a clear status.
- Success feedback **MUST** confirm the changed entity and persist long enough to be understood.

## Forms

- Required state **MUST** be programmatically exposed and visually clear.
- Validate at a useful time without clearing input or moving focus unexpectedly.
- Field errors **MUST** be associated with the field; long forms **SHOULD** include a focusable error summary.
- Recoverable server errors **MUST** preserve entered values.
- Disabled submission **MUST** have an adjacent reason or be replaced by enabled submission followed by clear validation.
- Authentication **MUST** support password managers, paste, autocomplete and accessible error recovery.

## Verification boundary

Automated scans catch only part of accessibility. The later testing stage **MUST** combine automated checks with keyboard review, zoom/reflow review and manual assessment of names, order, context and recovery.

