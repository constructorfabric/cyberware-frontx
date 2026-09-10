---
status: accepted
date: 2026-08-27
decision-makers: German Bartenev
---

# Occupant Reference Boundary

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Occupant Identity Lexical Rule](#occupant-identity-lexical-rule)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Occupant as a structural parameter contract, adapted by a separate glue layer](#occupant-as-a-structural-parameter-contract-adapted-by-a-separate-glue-layer)
  - [Direct import of the concrete extension type](#direct-import-of-the-concrete-extension-type)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-routing-adr-occupant-reference-boundary`

## Context and Problem Statement

Route Ownership Signal resolves, at each domain level, every compound query-string key whose own domain-path is exactly that level's own domain key — matching that key's own occupant-identity segment against that domain's declared prefixes — and reports the route owner each such key names, or that none does, to the consumer holding that level. That route owner is, in this ecosystem, ultimately an `mfes` runtime `Extension` — the concrete registration type carrying `id`, `domain`, `entry`, and, for a screen, a `presentation.route` (`packages/mfes/src/types/index.ts`). How should the routing core name and carry that identity through resolution and reporting without itself depending on the concrete extension type the `mfes` runtime defines?

## Decision Drivers

* Standalone package boundary — `@gears-frontx/routing` imports no other ecosystem package and calls no consumer of its own (`cpt-frontx-routing-nfr-standalone`), enforced mechanically by the `arch:edges`/`arch:deps` boundary guards, not merely by convention.
* Agnostic core — the navigation substrate and the route ownership signal built on it carry no dependency on a concrete router engine or UI framework, and by the same reasoning carry no dependency on a concrete extension-registration format either (`cpt-frontx-routing-nfr-agnostic-core`).
* Structural contract, not a behavioral port — Occupant, as this ADR specifies it, is a plain data pair (a stable identity plus an opaque parameter bag) passed as an argument at each resolution call, never injected and never implemented by anything: `cpt-frontx-routing-nfr-standalone` requires this package to call no consumer of its own, so nothing could satisfy an Occupant "port" even if one were declared. This is a deliberate contrast with how this package already treats its router-engine dependency: `NavigationHistory` (`location`, `subscribe`, `push`, `replace`, `go`) is a behavioral port — a contract of methods a separately published engine-provider package (`@gears-frontx/routing-tanstack`) implements, never a concrete engine import inside the core (`cpt-frontx-adr-core-package-boundaries`). The two shapes both keep a concrete dependency out of the routing core, but by different means — one by injection, satisfied by an implementer; the other by argument-passing, satisfied by a caller — and the contrast is what motivates treating Occupant as its own kind of boundary rather than assuming it must take the same shape `NavigationHistory` already does.
* Standalone deployment — a microfrontend served on its own, with no `mfes` runtime present at all, still needs the route ownership signal to resolve against something; a hard dependency on the concrete `Extension` type would tie that resolution to a runtime that standalone deployment does not have.

## Considered Options

* **Occupant as a structural parameter contract, adapted by a separate glue layer** — the routing core resolves against `Occupant`: a structural type carrying a stable identity plus an opaque parameter bag, with no knowledge of `mfes`'s `Extension` shape, passed as a plain argument at each resolution call rather than injected; a glue/adapter layer, architecturally the same role `routing-tanstack`'s Engine Provider already plays for the router engine, maps concrete `Extension` registrations into that structural shape.
* **Direct import of the concrete extension type** — the routing core imports `@gears-frontx/mfes` and resolves directly against `Extension`/`ScreenExtension`, skipping an adapter layer.

## Decision Outcome

Chosen option: **Occupant as a structural parameter contract, adapted by a separate glue layer**, because it is the only option consistent with this package's own CI-enforced boundary properties, and because a data pair carried by argument is the only shape a package that calls no consumer of its own can offer in the first place. `cpt-frontx-routing-nfr-standalone` requires zero intra-ecosystem edges in this package's manifest and import graph, checked mechanically by the boundary guards, and requires the package to call no consumer of its own; importing `@gears-frontx/mfes` directly would add exactly the edge that requirement forbids, and an injected, implementer-satisfied Occupant port would require a call this package is never allowed to make. `cpt-frontx-routing-nfr-agnostic-core` requires the package to carry no dependency on a concrete router engine or UI framework "whatsoever" — the same rationale extends to a concrete extension-registration format, since binding route resolution to one runtime's own registration shape would reintroduce, for extension identity, precisely the coupling the engine-provider port already exists to avoid for router engines. This is where the comparison to `NavigationHistory` is useful only as a contrast, not as precedent: `NavigationHistory` is "deliberately narrower than what any concrete engine's own history contract typically requires," carried as a behavioral port the substrate declares and a separately published provider *implements* (`packages/routing/architecture/DESIGN.md` §1.1) — a real dependency inversion, satisfied by an implementer this package never calls directly. Occupant cannot take that shape, because nothing implements it: it is a structural type — a stable identity plus an opaque parameter bag — that a glue layer *constructs* and hands to the routing core as a plain argument at each resolution call. The two keep the routing core free of a concrete dependency by different mechanisms — one by injection, the other by argument-passing — and calling Occupant a "port" by analogy to `NavigationHistory` would misstate which mechanism is actually at work. Everything else about what that identity names — that it is an `mfes` `Extension`, which domain it targets, which entry it mounts — remains exactly the kind of runtime-specific knowledge `cpt-frontx-routing-principle-publishes-not-orchestrates` already keeps out of this package.

### Occupant Identity Lexical Rule

`cpt-frontx-routing-adr-domain-occupancy-addressing-granularity` makes an occupant's own identity a literal substring of a compound query-string key (`{domain-path}::{occupant-identity}`), so this package can no longer describe that identity as purely opaque: the routing core still never interprets what the identity *names* — that remains the glue layer's own concern — but the identity value must be lexically valid to serve as part of an address this package itself composes and parses. The accurate description is **uninterpreted but well-formed**, not opaque, and this package states the well-formedness rule normatively:

* Non-empty: an occupant identity is never the empty string.
* Composed of one or more non-empty segments.
* Drawn from an explicit allowed character set that excludes both of `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`'s reserved delimiters — the path delimiter (`.`) and the boundary delimiter (`::`) — so an identity value can never be misread as a further path segment or as a second domain-path/occupant-identity boundary.
* Unique within its own domain — already guaranteed by the existing registration-time same-declared-prefix conflict check (`packages/routing/architecture/PRD.md` §11), not re-decided here.

The parameter bag remains opaque in the sense this ADR already gives it: the routing core carries it without reading any field inside it. Only the identity value's own lexical shape — never its meaning — is now a rule this package states and can check.

This package **MUST** run a validator for this lexical rule automatically, synchronously, inside the only two places this package's own code actually receives a consumer-supplied identity token as an argument: observer creation, where the declared identifier-to-prefix pairs source the consumer supplies carries each owner's own identity, and the URL back-projection helper, where each slot delta in a batch names a compound key carrying an identity segment. A malformed token at either input path **MUST** be rejected synchronously with a clear error at that point — not merely documented as something the glue layer should have checked before calling in.

This validation runs on those two input paths and nowhere else — **NEVER** on a value parsed out of the URL during resolution. A stale or malformed identity segment encountered while resolving an existing URL — a bookmark created before this rule existed, or before a stricter character set was adopted — **MUST** resolve to "no owner": this is not a gap the validator leaves open, but the same fully specified, already-handled outcome this DESIGN already gives to any compound key whose occupant-identity segment matches no declared prefix ("no owner is named at all when no declared prefix matches," `packages/routing/architecture/DESIGN.md` §1.1; "A compound key's own occupant-identity segment matches no declared prefix, at some domain level," §4) — never a thrown error. This is a deliberate, permanent non-extension of the validator's scope, not an oversight: a future implementer who "helpfully" adds a throw on the parse path would turn every previously-valid bookmarked URL into a crash the instant this rule tightens, which is exactly the failure this scope boundary exists to prevent.

This package also still publishes the same validator function, alongside its existing prefix-equivalence predicate, so the glue layer can check an identity proactively before ever calling into observer creation or the back-projection helper — but that publication is now a convenience for early feedback, not the extent of the enforcement itself; see Consequences below for what this package does, and does not, enforce as a result.

### Consequences

* Good, because the package keeps its zero-intra-ecosystem-edge property, verifiable by the same `arch:edges`/`arch:deps` guards that already check it today.
* Good, because a standalone deployment — no `mfes` runtime present — still resolves through the same Occupant contract; nothing about it presupposes the runtime exists.
* Good, because a future second host runtime, or a second type-system provider for extensions, needs only its own glue layer against the same structural shape, not a change to the routing core.
* Bad, because every consumer bridging `mfes` extensions into route ownership carries one more layer than a direct import would: the glue that maps `Extension` registrations into `Occupant` pairs.
* Bad, because a mismatch between an `Occupant`'s opaque parameter bag and what a concrete `Extension` actually carries is caught only where the glue layer maps one into the other, not by a compiler-checked import of the concrete type inside the routing core itself.
* Good, because lexical well-formedness of an occupant identity is now enforced at this package's own API boundary, not merely documented: observer creation and the URL back-projection helper both reject a malformed token synchronously, so a caller of either entry point cannot construct an invalid compound key through this package's own code.
* Bad, because every invariant the address depends on beyond lexical well-formedness — identity uniqueness within a domain, stability across reload — remains an obligation on consumer glue that this package's own types cannot enforce; a plain data pair carries no compiler-checked guarantee that the identity it holds is unique or the same value it was on a previous mount, and this package's own boundary check cannot substitute for a registry it never holds.
* Bad, because that glue is not a nameless abstraction for this ecosystem: it is the framework package (`template-shell/packages/framework`), which is exactly why the two framework-owned ADRs (`cpt-frontx-framework-adr-occupant-identity-stability`, `cpt-frontx-framework-adr-route-support-scope`) exist — those obligations are decided and enforced there, not restated here.
* Bad, because this package's own enforcement stops at lexical well-formedness, checked only at observer creation and at the back-projection helper: it cannot enforce cross-mount identity uniqueness itself, which stays the consumer's own registration-time conflict check (`packages/routing/architecture/PRD.md` §11), and it cannot check either invariant at rest, since it never holds a registry of occupants to check them against.

### Confirmation

Confirmed the same way this package's existing standalone and agnostic-core properties are confirmed: the boundary guards (`arch:edges`, `arch:deps`) report zero intra-ecosystem edges in this package's manifest and import graph, and a design/code review of the Occupant contract's own shape confirms it carries no field, literal, or import that names `@gears-frontx/mfes` or any other concrete extension-registration format, and confirms it is passed as a plain argument rather than declared as an injectable port with an implementer.

## Pros and Cons of the Options

### Occupant as a structural parameter contract, adapted by a separate glue layer

The routing core declares `Occupant` as a stable identity plus an opaque parameter bag, a structural type rather than an injected port; a glue layer external to this package maps concrete `mfes` `Extension` registrations into that shape and hands it to the routing core as a plain argument, the same role the Engine Provider already plays for `NavigationHistory`, but by a different mechanism — construction and argument-passing rather than implementation and injection.

* Good, because it preserves the zero-intra-ecosystem-edge property the package already claims and that CI already enforces.
* Good, because it is consistent with the standalone NFR's own constraint that this package calls no consumer of its own, which a data contract satisfies and an injected port could not.
* Neutral, because it requires a glue layer to exist somewhere, symmetric to the engine-provider package this design already requires for the router engine.
* Bad, because a resolution bug at the Occupant/Extension seam surfaces one layer away from where the concrete extension is declared, in the glue rather than in the routing core.

### Direct import of the concrete extension type

The routing core imports `@gears-frontx/mfes` and resolves against `Extension`/`ScreenExtension` directly, with no intermediate abstraction.

* Good, because there is one fewer layer between a declared route owner and the code that resolves it, and no separate mapping to keep in sync.
* Bad, because it adds an intra-ecosystem edge this package's own NFR (`cpt-frontx-routing-nfr-standalone`) forbids, breaking a property the boundary guards already check today.
* Bad, because it ties route resolution to one runtime's own extension-registration format, contradicting the agnostic-core property (`cpt-frontx-routing-nfr-agnostic-core`) and the precedent already set for the router engine.
* Bad, because a standalone deployment with no `mfes` runtime present would still carry the import, even though nothing in that deployment mode uses it.

## More Information

Diagram note: this decision is a single binary comparison — the chosen Occupant structural-contract abstraction against the one rejected alternative of a direct concrete import — matching the shape this repository's own root ADRs already use for a decision of this kind (`cpt-frontx-adr-core-package-boundaries`, `cpt-frontx-adr-extension-domain-occupancy`), both recorded in prose and comparison tables with no diagram. No diagram is included here for the same reason.

**Scope of impact.** Governs only how the routing core (`@gears-frontx/routing`) names and carries route-owner identity through resolution and reporting. It does not decide how a concrete glue layer maps `mfes` `Extension` registrations into the Occupant contract — that mapping is the glue layer's own concern, outside this package's boundary — nor does it revisit the engine-provider port this ADR draws its contrast from (`cpt-frontx-routing-fr-engine-provider-port`). It also does not decide, and defers entirely to the framework package's own ADRs, which concrete extension field the glue layer reads as identity (`cpt-frontx-framework-adr-occupant-identity-stability`) or which extension types carry one at all (`cpt-frontx-framework-adr-route-support-scope`).

**Review trigger.** Revisit if a requirement emerges for the routing core itself to interpret a field of the concrete extension registration (rather than treating the whole parameter bag as opaque), which would undercut the rationale for keeping Occupant's shape structural rather than interpreted.

**Checklist applicability.**

* ARCH — applicable and addressed above (an architecturally significant, hard-to-reverse boundary decision affecting every consumer that bridges extension registrations into route ownership).
* SEC — Not applicable because this decision introduces no secret, credential, or authorization concern; it only shapes what identity shape crosses a package boundary.
* PERF — Not applicable because a structural identity-plus-parameter-bag contract carries no different runtime cost than a concrete-type import at the volumes this package operates at.
* REL — Not applicable because it governs a compile-time/import-graph boundary, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — applicable: the Occupant contract is itself an integration contract between the routing core and whatever glue layer bridges a concrete runtime's extensions into it; its shape is owned by this package going forward, and a breaking change to it is scoped the same way `cpt-frontx-routing-fr-engine-provider-port` already scopes a breaking change to `NavigationHistory`.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.
* MAINT — applicable: the structural contract keeps the routing core's own blast radius bounded to this package when the concrete extension-registration format changes, at the cost of the extra glue layer noted above, and at the cost that this package cannot itself enforce the invariants that glue layer must uphold (see Consequences).

## Traceability

- **PRD**: [../PRD.md](../PRD.md)
- **DESIGN**: [../DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-routing-nfr-standalone` — the Occupant structural contract is what lets route resolution avoid the intra-ecosystem edge this NFR forbids, and what makes an injected, implementer-satisfied port impossible in the first place, since the NFR also forbids this package from calling any consumer of its own.
* `cpt-frontx-routing-nfr-agnostic-core` — extends this package's existing engine-agnosticism to extension-registration-format agnosticism.
* `cpt-frontx-routing-fr-route-ownership-signal` — the signal reports Occupant identity, not concrete `Extension` identity, at every domain level.
* `cpt-frontx-routing-fr-engine-provider-port` — cited only as a deliberate contrast, not as precedent: a behavioral port satisfied by an implementer, distinct from the structural, argument-passed contract this decision adopts for Occupant.
* `cpt-frontx-component-routing-navigation-substrate` — the component whose resolution primitive this decision keeps free of any concrete extension-registration import.
* `cpt-frontx-framework-adr-occupant-identity-stability` — the framework-package decision that fixes which concrete extension field the glue layer reads as Occupant identity; this ADR names the framework package as where that obligation is decided and enforced, not restated.
* `cpt-frontx-framework-adr-route-support-scope` — the framework-package decision that fixes which extension types carry a route at all; cited here for the same reason as above.
* `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity` — the source of the reserved delimiter characters (`.`, `::`) the Occupant Identity Lexical Rule above excludes from the allowed identity character set.
