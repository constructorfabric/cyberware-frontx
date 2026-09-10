---
status: accepted
date: 2026-08-27
decision-makers: German Bartenev
---

# Route Support Scope

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Per-type capability, validated at registration like mount-strategy cardinality](#per-type-capability-validated-at-registration-like-mount-strategy-cardinality)
  - [Optional field on the base extension type](#optional-field-on-the-base-extension-type)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-framework-adr-route-support-scope`

## Context and Problem Statement

Whether an extension needs a `route` at all — decided as the occupant identity in `cpt-frontx-framework-adr-occupant-identity-stability` — is not the same question as whether a given *extension type* (screen, widget, sheet, modal, and whatever else this ecosystem's extension domains define) supports or requires one at all. Today, `route` already lives on `ExtensionPresentation`, consumed only by `ScreenExtension` — a derived type a screen domain requires via `extensionsTypeId` (`packages/mfes/src/validation/extension-type.ts`, `validateExtensionType`) — while the base `Extension` type carries no `presentation` and no `route`. That existing shape already implies a type-level answer rather than a per-instance one; this record decides whether to keep it that way as new extension types are added, or to instead collapse route support into an optional field on the base type. How should route support for a new extension type — a modal, say, that should never carry one — be declared and enforced?

## Decision Drivers

* Per-type invariant, not per-instance convention — "all screens have routes, no modals do" is a statement about a *type*, and needs to be enforced as one, not left to each instance's author to remember.
* Fail-at-admission, not at runtime — an extension instance missing a `route` its own type requires, or carrying one its own type forbids, should be rejected when it is registered, the same standard `cpt-frontx-adr-extension-domain-occupancy`'s cardinality matrix already holds mount-strategy actions to.
* Existing mechanism reuse — this ecosystem already has a working, CI-checkable pattern for exactly this shape of rule: `crossValidateHandlers` in `packages/mfes/src/runtime/DefaultMfeRegistry.ts` rejects a domain whose declared lifecycle actions do not match its chosen mount strategy's required/forbidden row.
* No solution-specific vocabulary leaked into the runtime — whatever mechanism enforces this must stay consistent with the runtime's own agnostic-core principle (`cpt-frontx-principle-agnostic-core`), the same constraint `cpt-frontx-adr-extension-domain-occupancy` already holds its own strategy catalog to.

## Considered Options

* **Per-type capability, validated at registration like mount-strategy cardinality** — whether an extension type supports or requires a `route` is declared once per extension type (the same way `ScreenExtension` already requires `presentation.route` via `extensionsTypeId`), and cross-validated at registration the same way `crossValidateHandlers` already validates mount-strategy actions against a domain's declared strategy — never as a per-instance optional field on the base `Extension` type.
* **Optional field on the base extension type** — `route` becomes an optional field directly on `Extension`, present or absent per instance, with no type-level declaration of which types are supposed to carry it.

## Decision Outcome

Chosen option: **per-type capability, validated at registration like mount-strategy cardinality**, because it is the only option that can actually express a per-*type* invariant, which is what "all screens have routes, no modals do" is. An optional field on the base type is a per-*instance* property: nothing about it stops one screen instance from omitting `route` while a sibling screen instance declares it, or a modal instance from carrying one it should never have. Making it type-level and registration-validated is not a new pattern this decision invents — it is the same shape `cpt-frontx-adr-extension-domain-occupancy` already committed to for mount-strategy cardinality: a domain author selects a named strategy, and `crossValidateHandlers` rejects a domain whose declared actions do not match that strategy's required/forbidden row, at admission rather than at runtime. Route support follows the same logic already at work in this ecosystem's own type-derivation mechanism: `ScreenExtension` already requires `presentation.route` by deriving from a type a screen domain's `extensionsTypeId` names, and `validateExtensionType` already rejects a registration whose type does not derive from the required one (`packages/mfes/src/validation/extension-type.ts`). Extending that same mechanism — or a cardinality-matrix-shaped check built the same way — to route support is strictly cheaper than inventing a parallel per-instance rule, because each domain would still need its own enforcement logic against the optional field to get the same guarantee, buying no real simplification for the field-on-base-type alternative.

### Consequences

* Good, because "does this extension type support/require a route" is answered once per type, not re-decided, or forgotten, per instance.
* Good, because a registration violating its own type's route capability is rejected at admission, before any user encounters a broken route, the same guarantee `cpt-frontx-adr-extension-domain-occupancy`'s cardinality matrix already gives for mount-strategy actions.
* Good, because it reuses a mechanism this ecosystem already ships and already trusts (`validateExtensionType`, `crossValidateHandlers`), rather than introducing a second, differently-shaped validation path.
* Bad, because adding a new extension type that supports routes means declaring that capability explicitly (deriving the right type, or adding a matrix row) rather than simply setting an optional field — a small amount of ceremony an optional field would not require.
* Bad, because this decision constrains route support to whatever set of extension types this ecosystem's type-derivation mechanism can express; a genuinely novel route-support shape not expressible as "does this type derive from the route-carrying one" would need the mechanism itself extended, not just a new instance.

### Confirmation

Confirmed by a design/code review checking that route support is declared through the extension type hierarchy (a derived type like `ScreenExtension` requiring `presentation.route`, or an equivalent registration-time declaration for a future extension type) rather than as an optional field directly on the base `Extension` type, and that an automated check — the same shape as `crossValidateHandlers`/`validateExtensionType` already run — rejects a registration whose instance is missing a `route` its own type requires, or carries one its own type forbids.

## Pros and Cons of the Options

### Per-type capability, validated at registration like mount-strategy cardinality

Route support is a property of the extension *type* — declared through type derivation the way `ScreenExtension` already requires `presentation.route` — and cross-validated at registration the same way mount-strategy actions already are.

* Good, because the invariant is expressed exactly at the level it actually holds: the type, not the instance.
* Good, because violations are caught at admission, before a broken route ever reaches a user.
* Good, because it reuses `crossValidateHandlers`/`validateExtensionType`, mechanisms this ecosystem already ships and trusts, rather than a new bespoke check.
* Neutral, because adding a new route-supporting type requires declaring the capability explicitly, a small, deliberate step rather than an implicit default.
* Bad, because it is bounded by what the existing type-derivation and cardinality-matrix mechanisms can express; a shape those mechanisms cannot represent would need them extended first.

### Optional field on the base extension type

`route` becomes an optional field on `Extension` itself, set or omitted per instance, with no type-level statement of which types are supposed to carry it.

* Good, because it requires no type-level declaration at all — any instance can simply set the field or not.
* Bad, because it cannot express a per-type invariant: nothing stops one screen instance from omitting `route` while a sibling declares it, or a modal from carrying one.
* Bad, because each domain still needs its own enforcement logic against the optional field to recover the guarantee the type-level option gets for free, so the base-type field buys no real simplification.
* Bad, because a violation (a screen without a route, a modal with one) is discovered only when something downstream — routing resolution, a UI render — behaves unexpectedly, not at registration.

## More Information

Diagram note: this decision is a single binary comparison — a per-type capability against the one rejected alternative, a per-instance optional field — matching the shape this repository's own root ADRs already use for a decision of this kind (`cpt-frontx-adr-core-package-boundaries`, `cpt-frontx-adr-extension-domain-occupancy`), both recorded in prose and comparison tables with no diagram. No diagram is included here for the same reason.

**Scope of impact.** Governs only how route support is declared and enforced per extension type. It does not decide which concrete field this package's glue layer reads as identity once route support exists (decided in `cpt-frontx-framework-adr-occupant-identity-stability`), nor does it change the mount-strategy cardinality matrix itself (`cpt-frontx-adr-extension-domain-occupancy`) beyond reusing its validated-at-registration shape as precedent.

**Review trigger.** Revisit if a requirement emerges for route support to vary per instance within the same type rather than uniformly across the type — for example, a screen type where some instances are routable and others deliberately are not — which this decision's own per-type framing does not accommodate.

**Checklist applicability.**

* ARCH — applicable and addressed above (a type-system-shape decision affecting every present and future extension type, and hard to reverse once instances and their consumers depend on route support being type-uniform).
* SEC — Not applicable because this decision introduces no secret, credential, or authorization concern.
* PERF — Not applicable because either option is a registration-time check running once per extension admission, with no meaningful performance difference between them.
* REL — Not applicable because it governs registration-time validation, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — Not applicable because this shapes an internal extension-registration invariant, not an external integration contract.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.
* MAINT — applicable: expressing the invariant once per type, enforced by a reused mechanism, is what keeps a future extension type from needing its own bespoke route-support logic.

## Traceability

This package (`template-shell/packages/framework`) currently has no `PRD.md` or `DESIGN.md` of its own — only `CLAUDE.md` and `llms.txt`. This ADR is the second SDLC artifact recorded for it, alongside `0001-occupant-identity-stability.md`.

This decision directly addresses the following:

* `cpt-frontx-routing-fr-route-ownership-signal` — route support must be resolvable for a given extension type before the routing package's signal has anything to observe for it.
* `cpt-frontx-framework-adr-occupant-identity-stability` — this decision fixes which extension types carry the `route` that ADR names as identity, and enforces that they do.
* `cpt-frontx-adr-extension-domain-occupancy` — the precedent this decision follows: a per-type capability validated at registration through a cardinality-matrix-shaped check, the same standard already applied to mount-strategy actions.
* `packages/mfes/src/validation/extension-type.ts` (`validateExtensionType`) — the existing mechanism this decision extends the same reasoning to, rather than replacing with a per-instance rule.
