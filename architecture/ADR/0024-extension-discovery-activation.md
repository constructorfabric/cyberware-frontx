---
status: accepted
date: 2026-06-05
---

# Discovery and Activation of Installed-Template AI Extensions


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Generalized scan parameterized by the extension contract](#generalized-scan-parameterized-by-the-extension-contract)
  - [Static registry](#static-registry)
  - [Manual per-project wiring](#manual-per-project-wiring)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-extension-discovery-activation`
## Context and Problem Statement

When a template is installed in a project, the AI extensions it carries must become available to AI agents working in that project without the developer wiring them up by hand (`cpt-frontx-fr-ai-extension-discovery-activation`); this is the postcondition that makes a Template Developer's bundled extensions take effect downstream (`cpt-frontx-usecase-bundle-template-ai-extensions`). The extensions are carried in the declared shape decided in `cpt-frontx-adr-template-ai-extension-contract`. How should installed-template extensions be found and composed into the capability set an AI agent sees, with zero manual configuration and without privileging any single template's identity?

## Decision Drivers

* **Zero manual wiring** — template-supplied capabilities must become available the moment a template is installed, with no per-project registration step (`cpt-frontx-fr-ai-extension-discovery-activation`).
* **Generality across templates** — the mechanism must find the extensions of any conforming template, parameterized over the extension contract rather than tied to one template's or one solution's namespace identity.
* **Deterministic composition** — when base capabilities and one or more templates each contribute extensions, the composed result must be defined by an explicit precedence so two installations of the same set yield the same agent-visible capabilities.
* **Reliance on a declared shape** — discovery recognizes a bundle by the declared extension contract, so what is found is exactly what conforms (`cpt-frontx-adr-template-ai-extension-contract`).
* **Activation, not just detection** — finding a bundle is insufficient; the mechanism must compose found extensions into the agent-visible capability set so they are usable in-session.

## Considered Options

* **Generalized scan parameterized by the extension contract** — the mechanism scans the scaffolded project's filesystem — each applied template's `.frontx/ai/` bundle — for extension declarations conforming to the contract, and composes the matches into the agent-visible capability set under an explicit precedence. The scan is parameterized over the contract: a bundle contributes by conforming to the declared shape, and no namespace identity is special-cased.
* **Static registry** — a maintained list enumerates which packages or namespaces contribute extensions; activation consults the list, and a contributing package must be present in it.
* **Manual per-project wiring** — the developer explicitly registers each installed template's extensions in the project so agents can use them.

## Decision Outcome

Chosen option: **Generalized scan parameterized by the extension contract**, because it is the only option that delivers zero-configuration discovery for any conforming template while keeping composition deterministic. Discovery scans the scaffolded project's `.frontx/ai/` bundles for extension declarations that conform to the contract decided in `cpt-frontx-adr-template-ai-extension-contract`; every conforming declaration found is composed into the capability set the AI agent sees, under an explicit precedence that resolves overlaps when base capabilities and multiple templates contribute. The scan is parameterized over the contract — a bundle qualifies by conforming to the declared shape, so any conforming template's extensions are found by the same code path and no namespace identity is treated specially.

The bundles this scan reads are written by the CLI itself, not by any template: `.frontx` is unconditionally subtracted from every template's effective ownership (`cpt-frontx-adr-template-ownership-boundary-declaration`), so no template can materialize `.frontx/ai/<manifest-name>/` through its own ownership. The CLI delivers that folder as a CLI-owned step keyed to the template's manifest name — once, on that name's first applied target, refreshed on `upgrade`, removed when `delete` removes the name's last target — the same way it writes `.frontx/project.json`. Which mechanism writes a bundle does not affect this decision: discovery recognizes a bundle by the contract it conforms to, whoever put it there.

The precedence is the defined rule for composing contributions: base capabilities and each installed template's extensions are layered so that an overlap resolves to a single, predictable outcome, and the parameterization is what keeps the mechanism open to any conforming contributor rather than bound to a fixed set of namespaces. The scope of this decision is how installed-template extensions are found and composed into the agent-visible capability set; it does not decide the shape extensions conform to (that is `cpt-frontx-adr-template-ai-extension-contract`) nor how the framework or templates are packaged and installed (that is `cpt-frontx-adr-ai-tooling-framework-packaging`). The static-registry option re-introduces a manual maintenance step and privileges enumerated identities, so a newly published conforming template is not found until the list is updated — failing both zero-configuration and generality. The manual-wiring option contradicts the no-manual-wiring requirement outright.

### Consequences

* Good, because any conforming template's extensions become agent-visible the moment the template is installed, with no project edits.
* Good, because parameterizing over the contract keeps discovery open to any conforming contributor and privileges no namespace, so extensibility is unbounded by identity.
* Good, because an explicit precedence makes composition deterministic when base and multiple template contributions overlap.
* Bad, because scanning the scaffolded project's `.frontx/ai/` bundles for conforming declarations has a cost that grows with the number of applied-template bundles in the project and must be bounded.
* Bad, because the mechanism depends on the extension contract being well-formed; a bundle that does not conform is not found, so conformance must be enforced upstream at publish time.

### Confirmation

Compliance is confirmed by an automated check that installing a conforming template makes its declared extensions agent-visible with no edits to the consuming project; a test that two templates contributing overlapping capability names compose to the outcome the defined precedence specifies; and a test that a conforming package is discovered regardless of its namespace — asserting no namespace string is special-cased, so the scan is genuinely parameterized over the contract. Design and code review confirm activation composes found extensions into the agent-visible capability set rather than only detecting them.

## Pros and Cons of the Options

### Generalized scan parameterized by the extension contract

The mechanism scans the scaffolded project's `.frontx/ai/` bundles for contract-conforming declarations and composes matches into the capability set under an explicit precedence, parameterized so no namespace is privileged.

* Good, because it delivers zero-configuration discovery for any conforming template.
* Good, because parameterization over the contract keeps the mechanism open to any conforming contributor.
* Good, because an explicit precedence makes composition deterministic.
* Neutral, because it relies on the extension contract being well-formed, which is a separate decision it composes with.
* Bad, because scanning the scaffolded project's `.frontx/ai/` bundles for conforming declarations has a cost that grows with the number of applied-template bundles in the project and must be bounded.

### Static registry

A maintained list enumerates contributing packages or namespaces; activation consults the list.

* Good, because the set of contributors is explicit and inspectable at a glance.
* Bad, because a newly published conforming template is not found until the list is updated, failing zero-configuration.
* Bad, because enumerating namespaces privileges specific identities, working against generality.

### Manual per-project wiring

The developer registers each installed template's extensions in the project.

* Good, because the developer controls exactly which extensions are active.
* Bad, because it directly contradicts the requirement that extensions activate without manual wiring.
* Bad, because the wiring step must be repeated in every consuming project and kept in sync with installs.

## More Information

The declared shape that discovery recognizes is decided in `cpt-frontx-adr-template-ai-extension-contract`; the packaging that delivers the base capabilities these extensions are composed alongside is decided in `cpt-frontx-adr-ai-tooling-framework-packaging`. These are non-binding pointers to related decisions and are not part of this decision's durable identity. The precedence rule names the composition policy, not a specific layering instance; adding a contributor does not change the policy and requires no amendment to this decision.

Integration treatment (INT): discovery is the integration point between an installed template and the AI agents acting in a project. **Integration impact (INT-ADR-001)** — the agent-visible capability set is the surface this decision composes; its inputs are conforming extension bundles, and its compatibility posture is anchored to the extension contract and the framework's matched-version policy rather than narrated as a transition. **Contract changes (INT-ADR-002)** — because discovery reads the extension contract, a change to that contract is a change to discovery's input; backward-compatible contract additions keep existing conforming templates discoverable, and the precedence rule defines how new contributions integrate with existing ones.

Applicability of the remaining checklist categories:

* **PERF** — partially in scope and addressed: the scan's cost grows with the count of applied-template `.frontx/ai/` bundles in the scaffolded project and must be bounded; the decision records this as a consequence rather than fixing a numeric budget (which belongs in DESIGN/implementation).
* **SEC** — Not applicable, because the decision introduces no secret material and no authentication surface; it composes capabilities, not credentials.
* **REL** — Not applicable, because there is no service-availability target; discovery runs locally during a development session.
* **DATA** — Not applicable, because no persistent database or schema is defined here.
* **OPS** — Not applicable, because there are no runbooks for a local discovery step.
* **COMPL** — Not applicable, because no regulatory obligation bears on extension discovery.
* **INT** — addressed: discovery reads a bundle convention on disk that templates produce and the agent host consumes; that is the only boundary this decision crosses, and it lies inside the assembled project.
* **MAINT** — addressed: one discovery rule keyed to a template's own identity means adding a template adds no discovery code, and a bundle failing its contract is reported rather than silently skipped.
* **UX** — addressed: activation is what makes a template's own skills available in an agent session without the developer wiring anything by hand.
* **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.
* **ARCH-ADR-008 (supersession)** — Not applicable, because this ADR supersedes no live ADR.
* **Review cadence**: revisit if the project-filesystem scan's cost becomes a measured bottleneck, or if a required contributor cannot be expressed through contract conformance and would need a privileged path.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-fr-ai-extension-discovery-activation` — This decision defines how installed-template AI extensions are discovered and activated for AI agents with no manual wiring.
