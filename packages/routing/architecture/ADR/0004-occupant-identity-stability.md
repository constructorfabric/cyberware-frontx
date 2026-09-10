---
status: accepted
date: 2026-09-09
decision-makers: German Bartenev, G S
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
  - [The extension's own `route` property, normalized to the grammar's `name` alphabet, as identity](#the-extensions-own-route-property-normalized-to-the-grammars-name-alphabet-as-identity)
  - [The type system's versioned GTS id as identity](#the-type-systems-versioned-gts-id-as-identity)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-routing-adr-occupant-identity-stability`

## Context and Problem Statement

This package's own Route Ownership Signal resolves a domain's own entries to a route owner by matching each entry's own extension token against that domain's registered extensions (`cpt-frontx-routing-fr-route-ownership-signal`), and this package's own PRD already defines a route owner as the identity of whichever extension currently occupies one entry — identically the entry's own extension token, paired with the fact of that occupancy (`PRD.md` §1.4). Mapping a concrete `@gears-frontx/mfes` `Extension` into this package's own Occupant contract is the host's own glue layer's job, external to this package (`cpt-frontx-routing-adr-occupant-reference-boundary`; ADR 0001, "the host's glue layer"), so this record — not that glue layer's own judgment call — must fix which concrete field on that extension registration the glue layer reads as that identifier, and how that field is squared with the grammar's own `name` alphabet (`cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`). Two candidate values already exist on the concrete extension registration this identifier could be drawn from: the extension's own GTS type id (`Extension.id`, e.g. `gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.helloworld.v1`) and, for a screen, its own `presentation.route` (`ExtensionPresentation.route`, `packages/mfes/src/types/index.ts`). Which one should the host's own glue layer read and hand to the Occupant contract as the stable identity a URL entry's own extension token resolves to?

## Decision Drivers

* Bookmark and deep-link stability — an identity used to resolve a URL entry must not change when the code behind it is redeployed, or every previously working or bookmarked link pointing at it silently breaks.
* Already-declared, no new contract — the chosen identity should already exist on the extension's own registration rather than requiring a new field this ecosystem does not otherwise carry.
* Conformance to the grammar's own `name` alphabet — the extension token of an entry is drawn from `name` (`a`–`z`, `0`–`9`, `-`, lower case, no `.`); whichever value is chosen as identity must reduce to that alphabet by a fixed, stated rule, not by convention alone.
* One extension per registration, unique within a domain — this package's own PRD assumption already holds that the registered-extensions source is a set of route owners, but no identity appears in it against two different tokens (`PRD.md` §11); whichever value is chosen as identity must be able to satisfy this without contradiction.

## Considered Options

* **The extension's own `route` property, normalized to the grammar's `name` alphabet, as identity** — the stable identity a URL entry resolves to is the extension's own declared `route` (`ExtensionPresentation.route`, already present today on screen extension presentations), with one leading `/` stripped and the result required to be a valid `name`.
* **The type system's versioned GTS id as identity** — the stable identity is the extension's own versioned GTS type id (`Extension.id`).

## Decision Outcome

Chosen option: **the extension's own `route` property, normalized to the grammar's `name` alphabet, as identity**, because it is the only one of the two that stays stable across exactly the kind of change a deep link or bookmark must survive — a new version of a microfrontend or extension — while also reducing cleanly to the single token the grammar's own `extension` production requires. A GTS id is versioned by construction — `gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.helloworld.v1` names a specific version of a specific derived type, and carries both `.` and `~`, neither of which the grammar's `name` alphabet admits — so shipping a new version of that same conceptual screen changes the id string a URL entry would have resolved against, silently breaking every previously working or bookmarked route pointing at it, with no code anywhere having done anything a reviewer would flag as wrong, on top of requiring an escaping scheme the grammar does not otherwise need. `route` carries no version information at all: it is a human-authored, presentation-level path segment (`packages/mfes/src/types/index.ts`, `ExtensionPresentation.route`) that a redeployment of the same conceptual screen has no structural reason to change, and that already exists on `ScreenExtension` today without requiring a new field.

An occupant's own identity token in the URL is therefore `presentation.route` with one leading `/` stripped, required to match the grammar's own `name` alphabet exactly. A registration whose normalized route is not a valid `name` — because it is empty, carries `.` or upper case, or fails the alphabet in any other way — or that carries no route at all, is not routable and is never projected into the URL by this package. Uniqueness within one domain is a registration-time check the consumer performs using this package's own name-equality predicate, comparing two candidate extension tokens character-by-character exactly as the resolution primitive itself compares them at match time — never a separate, approximating comparison of the consumer's own devising.

### Consequences

* Good, because a new version of an extension's own GTS id — an expected, routine event whenever that extension's code changes — does not, by itself, break a route that previously resolved to it.
* Good, because it requires no new contract on the extension type: `route` already exists on `ScreenExtension.presentation` today.
* Good, because it keeps the identity a human author actually chooses and can reason about directly, rather than a machine-generated, version-bearing string.
* Good, because normalizing to the grammar's `name` alphabet at registration time means a resolvable route is always already a well-formed extension token — there is no runtime escaping step between "this extension has a route" and "this extension is addressable."
* Bad, because nothing in the type system enforces that `route` stays unique, stable across a redeploy, or shaped like a valid `name` the way a compiler-checked GTS id reference would; a redeploy that does change `route` on purpose still breaks existing links, and that risk is now carried by convention and by the registration-time check rather than by the type system.
* Bad, because two independently authored extensions can, in principle, declare the same `route` value; this is exactly the same-domain conflict this package's own PRD registration-time check already exists to catch (PRD §11), not a new risk this decision introduces, but the check's effectiveness now depends on the normalized `route` value being what the host's own glue layer compares, not the GTS id.
* Bad, because a registration whose `route` does not reduce to a valid `name` is silently non-routable rather than automatically coerced into one — an author who mistypes or upper-cases a route segment loses routability rather than getting a mangled but working address, a deliberate fail-closed choice rather than a best-effort one.

### Confirmation

Confirmed by a design/code review checking that the host's own glue layer, which maps a concrete `mfes` `Extension` into this package's own Occupant contract, reads the identity from `presentation.route` with one leading `/` stripped, never from `Extension.id`; that a registration whose normalized route fails the grammar's `name` alphabet is treated as not routable and never projected; and that the same-domain, same-extension conflict check this package's own PRD already requires (§11) runs against that same normalized `route` value using this package's own name-equality predicate.

## Pros and Cons of the Options

### The extension's own `route` property, normalized to the grammar's `name` alphabet, as identity

`presentation.route` — already declared on `ScreenExtension` today — is stripped of one leading `/`, checked against the grammar's `name` alphabet, and read as the stable identity a URL entry's extension token resolves to.

* Good, because it survives a version bump of the extension's own GTS id, the routine case a deep link or bookmark must actually be robust against.
* Good, because it requires no new field: the property already exists on the concrete extension type this ecosystem ships today.
* Neutral, because it is a human-authored string rather than a machine-derived one, so its stability is a matter of convention rather than a type-system guarantee.
* Bad, because the type system does not itself prevent two extensions from declaring the same `route`, a redeploy from changing it, or an author from typing a route that fails the `name` alphabet; all three are caught only by the registration-time checks, not by construction.

### The type system's versioned GTS id as identity

`Extension.id` — the GTS type id already present on every extension registration — is read as the identity a URL entry's extension token resolves to.

* Good, because it is already globally unique by construction within the type system, requiring no separate conflict check for uniqueness.
* Bad, because it is versioned: a new version of the same conceptual extension changes the id string, silently breaking every previously working or bookmarked route pointing at the old one.
* Bad, because it carries `.` and `~`, neither of which the grammar's `name` alphabet admits, so it could only be used as an extension token through an additional escaping scheme this decision would otherwise have to invent.
* Bad, because it ties a user-facing, bookmarkable value to an internal type-system detail (the version segment) that has no reason to be user-visible or stable across a routine redeploy.

## More Information

Diagram note: this decision is a single binary comparison — the normalized `route` property against the one rejected alternative, the versioned GTS id — matching the shape this repository's own root ADRs already use for a decision of this kind (`cpt-frontx-adr-core-package-boundaries`, `cpt-frontx-adr-extension-domain-occupancy`), both recorded in prose and comparison tables with no diagram. No diagram is included here for the same reason.

**Scope of impact.** Governs only which field of a concrete extension registration the host's own glue layer reads as the Occupant identity a URL entry's extension token resolves to, and the normalization rule that reduces it to the grammar's own `name` alphabet. It does not decide the Occupant contract's own overall shape (that is this package's own `cpt-frontx-routing-adr-occupant-reference-boundary`), the entry grammar itself (that is this package's own `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`), or whether every extension type carries `route` at all.

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

- **PRD**: [../PRD.md](../PRD.md)
- **DESIGN**: [../DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-routing-fr-route-ownership-signal` — fixes which concrete value this package's own resolution primitive's extension token is drawn from for an `mfes` extension, via the host's own glue layer.
* `cpt-frontx-routing-adr-occupant-reference-boundary` — this package's own Occupant contract decision the host's glue layer maps into; this ADR fixes which field of the concrete extension registration that glue layer reads for it.
* `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity` — the source of the grammar's `name` alphabet the normalized `route` value must satisfy to be routable at all.
* Route owner (this package's own `PRD.md` §1.4 Glossary) — this decision resolves the glossary's "extension token" to a concrete, already-existing field for this ecosystem's own extension type.
* This package's own PRD §11 (same-domain, same-extension conflict check) — this decision fixes the normalized `route`, not the GTS id, as the value that check compares, using this package's own name-equality predicate.
