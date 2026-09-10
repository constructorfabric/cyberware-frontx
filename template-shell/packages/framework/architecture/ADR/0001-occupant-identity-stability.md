---
status: accepted
date: 2026-08-27
decision-makers: German Bartenev
---

# Occupant Identity Stability

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [The extension's own `route` property as identity](#the-extensions-own-route-property-as-identity)
  - [The type system's versioned GTS id as identity](#the-type-systems-versioned-gts-id-as-identity)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-framework-adr-occupant-identity-stability`

## Context and Problem Statement

The routing package's Route Ownership Signal resolves a domain level's local URL remainder to a route owner by longest matching declared prefix (`cpt-frontx-routing-fr-route-ownership-signal`), and the routing PRD already defines a route owner as "the opaque identifier of whichever extension currently occupies a declared prefix within one domain" (routing package's `PRD.md` §1.4). This package's own glue layer is what maps a concrete `@gears-frontx/mfes` `Extension` into the routing package's Occupant port, so it is this package that must decide which concrete field on that extension registration the glue layer reads as that identifier. Two candidate values already exist on the concrete extension registration this identifier could be drawn from: the extension's own GTS type id (`Extension.id`, e.g. `gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.helloworld.v1`) and, for a screen, its own `presentation.route` (`ExtensionPresentation.route`, `packages/mfes/src/types/index.ts`). Which one should the glue layer read and hand to the Occupant port (the port this package's glue layer maps into, decided in the routing package's own `cpt-frontx-routing-adr-occupant-reference-boundary`) as the stable identity a URL prefix resolves to?

## Decision Drivers

* Bookmark and deep-link stability — an identity used to resolve a URL segment must not change when the code behind that segment is redeployed, or every previously working or bookmarked link pointing at it silently breaks.
* Already-declared, no new contract — the chosen identity should already exist on the extension's own registration rather than requiring a new field this ecosystem does not otherwise carry.
* One prefix per registration — the routing PRD's own assumption already holds that "the owner-prefix pairs source ... is a set of pairs, but no identifier appears in it against two different prefixes" (routing package's `PRD.md` §11); whichever value is chosen as identity must be able to satisfy this without contradiction.

## Considered Options

* **The extension's own `route` property as identity** — the stable identity a URL prefix resolves to is the extension's own declared `route` (`ExtensionPresentation.route`, already present today on screen extension presentations).
* **The type system's versioned GTS id as identity** — the stable identity is the extension's own versioned GTS type id (`Extension.id`).

## Decision Outcome

Chosen option: **the extension's own `route` property as identity**, because it is the only one of the two that stays stable across exactly the kind of change a deep link or bookmark must survive: a new version of a microfrontend or extension. A GTS id is versioned by construction — `gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.helloworld.v1` names a specific version of a specific derived type — so shipping a new version of that same conceptual screen changes the id string a URL segment would have resolved against, silently breaking every previously working or bookmarked route pointing at it, with no code anywhere having done anything a reviewer would flag as wrong. `route` carries no version information at all: it is a human-authored, presentation-level path segment (`packages/mfes/src/types/index.ts`, `ExtensionPresentation.route`) that a redeployment of the same conceptual screen has no structural reason to change, and that already exists on `ScreenExtension` today without requiring a new field.

### Consequences

* Good, because a new version of an extension's own GTS id — an expected, routine event whenever that extension's code changes — does not, by itself, break a route that previously resolved to it.
* Good, because it requires no new contract on the extension type: `route` already exists on `ScreenExtension.presentation` today.
* Good, because it keeps the identity a human author actually chooses and can reason about directly, rather than a machine-generated, version-bearing string.
* Bad, because nothing in the type system enforces that `route` stays unique or stable across a redeploy the way a compiler-checked GTS id reference would; a redeploy that does change `route` on purpose still breaks existing links, and that risk is now carried by convention rather than by the type system.
* Bad, because two independently authored extensions can, in principle, declare the same `route` value; this is exactly the same-domain conflict the routing PRD's own registration-time check already exists to catch (routing PRD §11), not a new risk this decision introduces, but the check's effectiveness now depends on `route` being the value this package's glue layer compares, not the GTS id.

### Confirmation

Confirmed by a design/code review checking that this package's glue layer, which maps a concrete `mfes` `Extension` into the routing package's Occupant port, reads the identity from `presentation.route`, never from `Extension.id`, and that the same-domain, same-prefix conflict check the routing PRD already requires (§11) runs against that same `route` value.

## Pros and Cons of the Options

### The extension's own `route` property as identity

`presentation.route` — already declared on `ScreenExtension` today — is read as the stable identity a URL prefix resolves to.

* Good, because it survives a version bump of the extension's own GTS id, the routine case a deep link or bookmark must actually be robust against.
* Good, because it requires no new field: the property already exists on the concrete extension type this ecosystem ships today.
* Neutral, because it is a human-authored string rather than a machine-derived one, so its stability is a matter of convention rather than a type-system guarantee.
* Bad, because the type system does not itself prevent two extensions from declaring the same `route`, or a redeploy from changing it; both are caught only by the registration-time conflict check, not by construction.

### The type system's versioned GTS id as identity

`Extension.id` — the GTS type id already present on every extension registration — is read as the identity a URL prefix resolves to.

* Good, because it is already globally unique by construction within the type system, requiring no separate conflict check for uniqueness.
* Bad, because it is versioned: a new version of the same conceptual extension changes the id string, silently breaking every previously working or bookmarked route pointing at the old one.
* Bad, because it ties a user-facing, bookmarkable value to an internal type-system detail (the version segment) that has no reason to be user-visible or stable across a routine redeploy.

## More Information

Diagram note: this decision is a single binary comparison — `route` against the one rejected alternative, the versioned GTS id — matching the shape this repository's own root ADRs already use for a decision of this kind (`cpt-frontx-adr-core-package-boundaries`, `cpt-frontx-adr-extension-domain-occupancy`), both recorded in prose and comparison tables with no diagram. No diagram is included here for the same reason.

**Scope of impact.** Governs only which field of a concrete extension registration this package's glue layer reads as the Occupant identity a URL prefix resolves to. It does not decide the Occupant port's own overall shape (that is the routing package's own `cpt-frontx-routing-adr-occupant-reference-boundary`) or whether every extension type carries `route` at all — that is decided separately in `cpt-frontx-framework-adr-route-support-scope`.

**Review trigger.** Revisit if a requirement emerges for a route to survive a deliberate rename of `route` itself (for example, a stable alias distinct from the human-authored path segment), which none of this decision's own reasoning currently provides for.

**Checklist applicability.**

* ARCH — applicable and addressed above (a hard-to-reverse identity choice: once routes are bookmarked and deep-linked against `route`, switching the identity later breaks every link a second time).
* SEC — Not applicable because this decision introduces no secret, credential, or authorization concern.
* PERF — Not applicable because either candidate identity is a plain string comparison at resolution time, with no meaningful performance difference between them.
* REL — Not applicable because it governs identity stability across a redeploy, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved; `route` already exists on the in-memory extension registration.
* INT — applicable: `route` becomes part of the de facto contract between an extension's presentation metadata and every deep link or bookmark pointing at it, though the field itself was not introduced by this decision.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.
* UX — applicable: this decision is what keeps a user's existing bookmark or deep link working across a routine redeploy of the extension it points at, rather than breaking silently.

## Traceability

This package (`template-shell/packages/framework`) currently has no `PRD.md` or `DESIGN.md` of its own — only `CLAUDE.md` and `llms.txt`. This ADR is the first SDLC artifact recorded for it, establishing this package's `architecture/ADR/` tree.

This decision directly addresses the following:

* `cpt-frontx-routing-fr-route-ownership-signal` — fixes which concrete value the routing package's resolution primitive's "declared prefix" is drawn from for an `mfes` extension, via this package's glue layer.
* `cpt-frontx-routing-adr-occupant-reference-boundary` — the routing package's own Occupant port decision this package's glue layer maps into; this ADR fixes which field of the concrete extension registration that glue layer reads for it.
* Route owner (routing package's `PRD.md` §1.4 Glossary) — this decision resolves the glossary's "opaque identifier" to a concrete, already-existing field for this ecosystem's own extension type.
* Routing PRD §11 (same-domain, same-prefix conflict check) — this decision fixes `route`, not the GTS id, as the value that check compares.
