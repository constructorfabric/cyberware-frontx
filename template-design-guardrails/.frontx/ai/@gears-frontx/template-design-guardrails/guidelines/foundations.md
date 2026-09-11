---
summary: Normative language, source precedence, and the working model every screen task starts from.
tier: core
---

# Standard: Foundations

## Normative language and precedence

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are requirement levels.

When sources disagree, use this order:

1. Approved product requirements and design references for the screen.
2. Installed FrontX template manifests and `@gears-frontx/ui-kit` documentation.
3. Machine-readable contracts in this bundle.
4. Guidelines in this bundle.
5. Installed application behavior and existing screens.
6. Local screen request.
7. Model defaults.

Approved requirements and designs decide how a screen looks; the UI kit documentation decides the component APIs that build it. The installed application ranks below both because it may still carry UI the approved design is replacing — an existing screen is a reference for consistency, not an authority over the design.

design-contract.json's `sourcePrecedence` is the canonical ordering; this list restates it.

The bundle's own value sources are the layout constraints in `layout-contract.json` and the motion timing/easing roles in the motion guideline; all other token values come from the installed system.

## System ownership

- Generated UI **MUST** reuse the installed shell, navigation, components, icon family, typography and semantic tokens.
- Local code **MUST NOT** override UI-kit internals or duplicate a kit primitive with styled `div` elements.
- A missing primitive **MUST** be recorded as a gap. A native semantic element plus local composition is preferred to a fake component.
- Tailwind **MAY** compose layouts. Arbitrary values and parallel color, radius or type scales **MUST NOT** replace product tokens.
- Token sourcing and gap handling follow the visual-foundations guideline's token policy (installed tokens only; derive via `color-mix` or record the gap).

## Product hierarchy

- Every page **MUST** communicate scope, primary job and current state before secondary detail.
- Each local region **MUST** have no more than one dominant action.
- Consequential conclusions **MUST** expose provenance, evidence or a route to it.
- Status, selection and severity **MUST NOT** be conveyed by color alone.
- Helper text **SHOULD** be removed when it repeats the title, visible structure, selected state or control label.
- Charts, cards, scores and illustrations **MUST NOT** be added merely to occupy empty space.

## Density modes

Use one explicit density per surface:

- `comfortable`: forms, onboarding, confirmation and low-frequency settings;
- `compact`: tables, workbenches, repository trees and monitoring views.

Density changes **MUST** use component variants or tokens, never local one-off dimensions. Height and rhythm acceptance rules live in the layout guideline's density-acceptance section.

## Semantic color roles

The role vocabulary (accent, success, warning, danger, info, neutral) is defined once, in the `color-and-theming` guideline — its "Status usage" and "Selection versus status" sections. Apply those definitions; do not restate them.

## Definition of done for generated UI

The interface is not ready for review until it has:

1. real UI-kit primitives;
2. token-backed styling;
3. declared wide, medium and narrow behavior;
4. complete applicable states;
5. keyboard and focus behavior;
6. meaningful content rather than filler;
7. a self-review against the quality-gate IDs.

