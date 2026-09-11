---
status: accepted
date: 2026-06-05
---

# MFE Load Isolation


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Per-load inline-content module graph behind an audited trust kernel](#per-load-inline-content-module-graph-behind-an-audited-trust-kernel)
  - [Shared module graph across microfrontends](#shared-module-graph-across-microfrontends)
  - [Per-load isolation with eager teardown of inline-content references](#per-load-isolation-with-eager-teardown-of-inline-content-references)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-mfe-load-isolation`
## Context and Problem Statement

The runtime admits independently developed microfrontends — potentially authored by different teams or vendors — and evaluates their code inside the host. Without deliberate isolation, two microfrontends could share a single module instance and silently couple through it, and the small set of dynamic-code primitives an isolation mechanism requires (dynamic import of inline content, dynamic construction of matchers over specifiers) are exactly the primitives that, if used carelessly elsewhere, become an arbitrary-code-execution surface. How should the runtime evaluate a loaded microfrontend so that each load is an isolated module instance, and how should the dangerous primitives the mechanism depends on be contained so the trust surface stays small and auditable?

## Decision Drivers

* Per-instance isolation — each loaded microfrontend must evaluate as its own module instance so that distinct occupants cannot couple through a shared module record (anchors `cpt-frontx-nfr-security`).
* Stable references during asynchronous evaluation — a module that continues evaluating after its import resolves (for example via top-level await) must keep its backing reference valid for the lifetime it needs, so isolation must not tear references down mid-evaluation.
* Minimal, audited trust surface — the dynamic-code primitives isolation requires must live in one small, explicitly reviewed location, not be scattered across the codebase.
* Default-deny admission posture — a microfrontend gains no capability beyond what it is granted, and the mechanism that admits its code must not widen that surface (anchors `cpt-frontx-nfr-security`).
* Bounded, non-user inputs to dangerous primitives — the inputs reaching any dynamic-code primitive must be provably bounded and author-declared, never arbitrary user input.
* No exception for cyclic dependency graphs — a bundler routinely emits chunks that import one another circularly, and isolation must admit no exception for them: any specifier a load resolves outside its own graph names a module record shared with every other load that reaches it the same way, and every module reachable from that one is shared too, so the exception is never confined to the single edge that closes the cycle (anchors `cpt-frontx-nfr-security`).
* Substrate neutrality — isolation must hold regardless of the UI framework or type system a microfrontend uses.

## Considered Options

* **Per-load inline-content module graph behind an audited trust kernel** — each load produces a fresh isolated module graph for the whole dependency chain, keyed by the extension instance identity and retained for the page lifetime (never torn down mid-evaluation); the dynamic-code primitives the mechanism needs are concentrated in a single audited trust-kernel file whose every export is safety-reviewed, side-effect-free, and forbidden from importing dangerous host capabilities, enforced by a custom lint rule.
* **Shared module graph across microfrontends** — all microfrontends evaluate against one shared module instance graph, relying on convention to avoid cross-coupling, with dynamic-code primitives used wherever convenient.
* **Per-load isolation with eager teardown of inline-content references** — the same per-load isolation, but the backing inline-content references are revoked as soon as each import resolves, rather than retained for the page lifetime.

## Decision Outcome

Chosen option: **per-load inline-content module graph behind an audited trust kernel**, because it is the only option that gives each loaded microfrontend its own module instance while keeping the dynamic-code trust surface small, audited, and provably fed by bounded inputs. Each load builds a fresh isolated module graph covering its entire dependency chain, keyed by the extension instance identity so two extensions sharing the same definition still evaluate as distinct instances and a re-load of the same instance reuses its existing graph. Where a dependency cycle cannot be brought inside the load's own graph, the load fails rather than any module resolving outside it: availability is what a cycle costs, never isolation. The backing inline-content references are retained for the page lifetime rather than revoked, because a module may continue evaluating after its import resolves and revoking a reference mid-evaluation would break it. All dynamic-code primitives the mechanism depends on — dynamic import of inline content and dynamic construction of specifier matchers — are concentrated in a single audited trust-kernel file. That file is held to an enforced contract: every export carries a safety rationale, the module holds no mutable state, it imports no dangerous host capability, and a runtime guard rejects any input to the import primitive that is not scheme-prefixed inline content. A custom lint rule makes the trust kernel the only place these primitives may appear, so the arbitrary-code-admission surface is one small, continuously reviewed location.

### Consequences

* Good, because each loaded microfrontend evaluates as its own isolated module instance, so distinct occupants cannot couple through a shared module record.
* Good, because retaining backing references for the page lifetime keeps modules with post-resolution evaluation (such as top-level await) valid, avoiding mid-evaluation breakage.
* Good, because concentrating all dynamic-code primitives in one audited trust kernel makes the arbitrary-code-admission surface small and reviewable rather than diffuse.
* Good, because the enforced trust-kernel contract (safety rationale per export, no mutable state, no dangerous imports, a runtime guard on inputs) makes the safety invariants explicit and machine-checkable.
* Bad, because retaining backing references for the page lifetime means the per-instance memory they hold is reclaimed only when the page unloads, not when a microfrontend unmounts.
* Bad, because the trust kernel is a deliberate exception to ordinary static-analysis scanning, so its discipline depends on the enforced contract and review rather than on the general scanner.
* Good, because the per-instance guarantee is total: every module a load reaches evaluates inside that load's own instance, with no exception for dependency cycles, so a consumer may rely on it unconditionally rather than reasoning about which modules are covered.
* Bad, because a static-import cycle in a microfrontend's chunk graph fails the load rather than degrading it, so a microfrontend whose build emits circular chunk imports cannot be loaded until it is rebuilt — availability, never isolation, is what a cycle costs.
* Good, because the failure is diagnosed rather than silent: it names the chunks on the cycle and the microfrontend, so it is actionable by the microfrontend's author at build time instead of surfacing as an unexplained runtime error.

### Confirmation

A security review confirms that admission of microfrontend code passes only through the trust kernel, that each load yields a distinct module graph keyed by instance identity, and that no microfrontend can reach a host capability beyond what its domain grants. The same review confirms that every specifier a load emits resolves to inline content minted by that load and never to an origin location, and that any dependency that cannot be resolved into the load's own graph fails the load with a diagnostic. An automated check confirms the trust-kernel contract: the dynamic-code primitives appear only in that file, every export carries its safety rationale, the file declares no mutable module-level state and imports no forbidden host capability, and the import primitive's runtime guard rejects any non-inline-content input. The grounding mechanisms are the audited trust kernel `packages/mfes/src/handler/mf-dynamic-module-ops.ts` (the sole site of dynamic import and specifier-matcher construction, with its guard and safety annotations) and the per-load isolation in `packages/mfes/src/handler/MfeHandlerMF.ts` (the instance-keyed load and the retain-for-page-lifetime invariant).

## Pros and Cons of the Options

### Per-load inline-content module graph behind an audited trust kernel

Each load is a fresh instance-keyed module graph retained for the page lifetime; all dynamic-code primitives live in one audited, contract-enforced trust kernel.

* Good, because it delivers true per-instance isolation with no cross-microfrontend module sharing.
* Good, because retention keeps post-resolution evaluation valid.
* Good, because the trust surface is one small, audited, lint-enforced location with bounded inputs.
* Neutral, because it requires a maintained trust-kernel contract and a custom lint rule to keep the surface closed.
* Bad, because per-instance backing references are held until page unload, deferring their reclamation.

### Shared module graph across microfrontends

All microfrontends evaluate against one shared module instance graph, relying on convention.

* Good, because it minimizes memory and load overhead by sharing instances.
* Bad, because microfrontends can couple through the shared instance, defeating per-instance isolation.
* Bad, because dynamic-code primitives used wherever convenient leave the arbitrary-code-admission surface diffuse and hard to audit.

### Per-load isolation with eager teardown of inline-content references

The same per-load isolation, but backing references are revoked as soon as each import resolves.

* Good, because it reclaims per-instance backing memory promptly on resolution.
* Bad, because a module that keeps evaluating after its import resolves loses its backing reference mid-evaluation and breaks.
* Neutral, because it keeps per-instance isolation but trades correctness of post-resolution evaluation for earlier reclamation.

## More Information

The present concrete instantiation isolates each load by building a per-load graph of inline-content module URLs for the dependency chain in `packages/mfes/src/handler/MfeHandlerMF.ts`, keyed by the extension instance identity (`extensionId`) so distinct instances get distinct evaluations and a re-load of the same instance reuses its cached graph; the inline-content URLs are not revoked, because modules with top-level await keep evaluating after the import resolves. The audited trust kernel `packages/mfes/src/handler/mf-dynamic-module-ops.ts` is the sole site of dynamic `import()` of inline content and of specifier-matcher construction; each export documents why its pattern is safe, the import primitive guards that its input is a scheme-prefixed inline-content URL, and a custom lint rule keeps these primitives out of every other file. The specific mechanism names, the keying field, and the inline-content scheme are descriptive of the current instantiation and non-binding; the durable decision is per-instance isolated module graphs with retained backing references and a single audited dynamic-code trust kernel.

**Scope of impact.** Applies to how a loaded microfrontend's code is evaluated in isolation and how the dynamic-code primitives that mechanism needs are contained. It does not decide how a microfrontend is matched into a domain (decided in `cpt-frontx-adr-domain-extension-compatibility`) or how a domain's occupancy is governed (decided in `cpt-frontx-adr-extension-domain-occupancy`); those decide admission compatibility and placement, while this decides runtime code isolation and the trust surface.

**Review trigger.** Revisit if a runtime mechanism for reclaiming per-instance backing references without breaking post-resolution evaluation becomes available, if a new dynamic-code primitive must be admitted to the trust kernel, if the inputs reaching the trust kernel could cease to be bounded and author-declared, or if a mechanism becomes available that admits a cyclic dependency graph into a load's own isolated instance uniformly across the supported browsers — such a mechanism takes the shape of assigning each module a per-load identity before its content exists.

**Checklist applicability.**

* ARCH — applicable and addressed above (a runtime isolation and trust-surface decision affecting every loaded microfrontend, and hard to reverse once the isolation and trust-kernel contract are relied upon).
* ARCH-ADR-008 (supersession) — Not applicable because this is a standalone, forward-looking decision with no live superseded record to link.
* SEC — applicable and addressed above (SEC-ADR-001): the threat model is admission of independently authored — potentially untrusted — microfrontend code into the host; the attack surface is the small set of dynamic-code primitives, which is contained in a single audited trust kernel with an enforced no-mutable-state, no-dangerous-imports, safety-annotated contract, a runtime input guard, and a lint rule that forbids these primitives elsewhere; the blast radius of any one microfrontend is bounded by per-instance module isolation and the default-deny posture that grants a microfrontend nothing beyond its domain's grants. No secret or credential is introduced by this decision.
* PERF — Not applicable as a primary concern: the retain-for-page-lifetime invariant has a memory consequence (noted under Consequences), but this decision is made on isolation and trust-surface grounds, not performance grounds.
* REL — Not applicable because it governs code isolation and the trust surface, not service availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — Not applicable because it shapes internal runtime code isolation, not an external integration contract.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-nfr-security` — per-instance isolation and the audited trust kernel uphold the default-deny posture by bounding each microfrontend's blast radius and keeping the arbitrary-code-admission surface small and reviewed.
* `cpt-frontx-fr-mfe-runtime-registration` — isolation is the mechanism by which a registered microfrontend is loaded on demand and evaluated as its own instance within the running application.
* `cpt-frontx-component-mfe-runtime` — this decision shapes the runtime code-isolation and trust-surface behavior of the MFE Runtime component.
* `cpt-frontx-principle-agnostic-core` — isolation holds regardless of the UI framework or type system a microfrontend adopts, keeping the substrate agnostic.
