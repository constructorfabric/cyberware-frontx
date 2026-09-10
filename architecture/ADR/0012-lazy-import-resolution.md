---
status: proposed
date: 2026-06-04
---

# Lazy Dynamic Import Resolution


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [A runtime lazy-import ABI inherited from the parent load](#a-runtime-lazy-import-abi-inherited-from-the-parent-load)
  - [Native dynamic-import resolution with no runtime contract](#native-dynamic-import-resolution-with-no-runtime-contract)
  - [Build-time-only lazy splitting with eager runtime collapse](#build-time-only-lazy-splitting-with-eager-runtime-collapse)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-lazy-import-resolution`
## Context and Problem Statement

The runtime loads each microfrontend as an isolated module graph, fetching its chunks and minting per-load module references so distinct loads never share a module instance, and rewriting each chunk's bare dependency specifiers to the per-load references built for that load's shared dependencies. A microfrontend that code-splits also contains lazy chunks reached through dynamic imports that resolve only when first exercised, and those lazy chunks carry the same bare dependency specifiers as the eager chunks. How should a lazy chunk be resolved at the moment it is first needed so that it joins the same isolated graph — and inherits the same shared-dependency bindings — as the parent load that owns it, rather than resolving against the origin with unrewritten specifiers and thereby evaluating a second, divergent copy of those dependencies?

## Decision Drivers

* Per-load isolation must extend to lazily reached code — a lazy chunk must evaluate inside the same isolated module graph as the load that triggered it, not as a separate graph (anchors `cpt-frontx-fr-mfe-runtime-registration`).
* Shared-dependency identity must be preserved across the eager/lazy boundary — a lazy chunk's bare specifiers must bind to the identical shared-dependency references the parent load already built, so a singleton dependency stays a single instance within one load.
* Deferred resolution must stay deferred — the mechanism must preserve code-splitting so a lazy chunk is fetched and evaluated only when first exercised, not pulled into the eager graph.
* Separation of concerns between runtime and build — the obligation that lives in the running application (resolving a lazy reference into the parent load's graph) must be cleanly separable from the obligation that lives in how a microfrontend is compiled (emitting a lazy reference the runtime can recognize).
* Substrate neutrality — the contract must hold regardless of the bundler, UI framework, or type system a microfrontend adopts, exposing only a named, stable call shape rather than any bundler-internal artifact.
* Bounded, statically resolvable inputs — the argument identifying a lazy chunk must be resolvable to a concrete sibling reference, never an arbitrary runtime-computed value, so resolution stays predictable and within the load's known chunk set (anchors `cpt-frontx-nfr-runtime-performance`).

## Considered Options

* **A runtime lazy-import ABI inherited from the parent load** — define a named runtime contract (an Application Binary Interface, ABI: a stable call shape a compiled chunk targets in place of a raw dynamic import) for every lazy reference; at load time the runtime supplies a per-load resolver, bound to that one load, that maps the lazy reference into the parent load's isolated graph and reuses the same shared-dependency bindings. The build-time act of emitting the ABI call in compiled chunks is a separate, consumer-side contract obligation owned by template build tooling, outside the ecosystem runtime's scope.
* **Native dynamic-import resolution with no runtime contract** — leave each lazy reference as a native dynamic import that resolves against the chunk's origin, accepting that the lazily fetched chunk evaluates with its own dependency bindings rather than the parent load's.
* **Build-time-only lazy splitting with eager runtime collapse** — split lazily at build time but, at runtime, fold every lazy chunk into the parent load's eager graph as it is discovered, so there is no deferred resolution and no separate runtime contract.

## Decision Outcome

Chosen option: **a runtime lazy-import ABI inherited from the parent load**, because it is the only option that keeps a lazily reached chunk inside the same isolated graph and bound to the same shared-dependency references as its parent load while still deferring the chunk's fetch and evaluation to first use. The decision draws an intrinsic boundary by concern: the **runtime ABI** — the named lazy-import call contract plus the per-load resolution that routes each lazy reference into the parent load's graph and reuses its shared-dependency bindings — is owned by the ecosystem runtime, because only the runtime holds the per-load graph and the bindings a lazy chunk must inherit. The **build-time transform** that rewrites a compiled chunk's dynamic imports into the ABI call shape is **template-bound build tooling**, exercised as a consumer-side contract obligation a conforming microfrontend's build satisfies; it is outside this cycle's ecosystem scope. The two halves meet only at the ABI: the runtime guarantees that any chunk targeting the contract is resolved into its parent load's graph, and a conforming build guarantees that every lazy reference in a shipped chunk targets the contract. The ABI accepts only statically resolvable references so each lazy chunk maps to a known sibling within the load's chunk set; a reference that cannot be resolved to a concrete sibling is rejected rather than resolved unpredictably.

### Consequences

* Good, because a lazily reached chunk evaluates inside the same isolated graph as the load that triggered it, so per-load isolation is not broken at the lazy boundary.
* Good, because a lazy chunk inherits the parent load's shared-dependency bindings, so a singleton dependency remains one instance within a load rather than splitting into a divergent second copy.
* Good, because deferred resolution is preserved — a lazy chunk is fetched and evaluated only on first use, keeping the eager path small.
* Good, because the runtime/build split is clean and intrinsic: the runtime owns what only it can own (the per-load graph and bindings), and the build owns only the obligation to emit the agreed call shape.
* Good, because the contract is a named call shape rather than a bundler artifact, so it holds across bundlers and substrates.
* Bad, because correct end-to-end behavior depends on two cooperating halves owned by different parties (runtime and consumer build), so a conforming build is a precondition the runtime cannot itself produce.
* Bad, because restricting the ABI argument to statically resolvable references excludes fully runtime-computed lazy paths, which must be expressed within that constraint.

### Confirmation

A continuous-integration check confirms the ABI contract holds on both sides of the boundary. On the runtime side, an automated test confirms that a lazy reference exercised within a load resolves into that load's existing graph and reuses its shared-dependency bindings (a singleton dependency observed identical across the eager and lazy chunks of one load), and that a distinct concurrent load resolves its own lazy references through its own resolver rather than a sibling's. On the consumer-contract side, a build-time check rejects any lazy reference whose argument is not statically resolvable, with a diagnostic pointing at the offending reference. The grounding mechanisms in the present concrete instantiation are, on the build side, the AST rewrite carried by the `frontxMfGts` plugin — `LazyImportTransformer` and `transformLazyImports`, run at the `renderChunk` stage, which rewrite each statically resolvable dynamic import to the `__frontx_lazy` call and raise a build-time error on a non-statically-resolvable argument; that half lives in template territory and is therefore cited by construct rather than as authoritative grounding, per `cpt-frontx-adr-template-territory-traceability`. On the runtime side the grounding is the per-load resolution path: the per-load loader stub minted by `ensureLazyLoaderUrl` in `MfeHandlerMF` (`packages/mfes/src/handler/MfeHandlerMF.ts`), the host-side per-load resolver table `LazyLoaderRegistry` (`packages/mfes/src/lazy-loader/lazy-loader-registry.ts`), and `resolveLazyChunk`, which funnels a lazy reference back into the same load's graph and shared-dependency bindings (`packages/mfes/src/handler/MfeHandlerMF.ts`).

## Pros and Cons of the Options

### A runtime lazy-import ABI inherited from the parent load

A named runtime call contract replaces each lazy reference; a per-load resolver maps it into the parent load's isolated graph and reuses its shared-dependency bindings. Emitting the call shape at build time is a separate, consumer-side obligation owned by template build tooling.

* Good, because it extends per-load isolation across the lazy boundary.
* Good, because lazy chunks inherit the parent load's shared-dependency bindings, preserving singleton identity within a load.
* Good, because it preserves deferred resolution — lazy chunks load only on first use.
* Good, because it draws an intrinsic runtime/build boundary, each side owning only what it can own.
* Neutral, because it depends on a stable, versionable named contract that both halves target.
* Bad, because end-to-end correctness requires a conforming consumer build the runtime cannot itself guarantee.
* Bad, because the ABI argument is restricted to statically resolvable references.

### Native dynamic-import resolution with no runtime contract

Each lazy reference stays a native dynamic import resolving against the chunk's origin, with no runtime mediation.

* Good, because it requires no contract and no per-load resolver, keeping the mechanism minimal.
* Good, because it relies only on native module-loading semantics.
* Bad, because the lazily fetched chunk resolves with its own dependency bindings, so a singleton dependency can split into a divergent second instance within one logical load.
* Bad, because the lazy chunk escapes the parent load's isolated graph, breaking per-load isolation at the lazy boundary.

### Build-time-only lazy splitting with eager runtime collapse

Code is split lazily at build time, but at runtime every lazy chunk is folded into the parent load's eager graph as it is discovered.

* Good, because every chunk shares the parent load's bindings and isolated graph by construction.
* Good, because there is no separate runtime contract to define or version.
* Bad, because folding lazy chunks into the eager graph defeats deferred resolution, pulling code into the eager path that was meant to load on demand.
* Bad, because discovering and eagerly resolving the full lazy set enlarges the eager working set against the runtime-performance targets.

## More Information

The present concrete instantiation expresses the ABI as the named `__frontx_lazy` call. A build-time AST rewrite in the `frontxMfGts` Vite plugin converts each statically resolvable dynamic `import('<rel>')` in a compiled chunk into a `__frontx_lazy('<rel>')` call at the `renderChunk` stage (after bundling, so code-splitting is preserved), and rejects a non-statically-resolvable argument with a build-time diagnostic. At load time the runtime injects a per-load loader stub that re-exports `__frontx_lazy` bound to that load's resolver; the stub reaches the host-side resolver table through a single narrow `resolve(id, path)` entry point, and the resolver funnels the lazy reference back into the same load's blob-URL chain so it inherits the load's `sharedDepBlobUrls`. Sibling loads receive distinct resolvers so a lazy reference routes back to the load that owns it. The specific contract name, the bundler hook, and the per-load reference mechanism are descriptive of the current instantiation and non-binding; the durable decision is a runtime-resolved lazy-import ABI whose per-load resolution inherits the parent load's shared-dependency bindings, with the build-time emission of the ABI owned as a consumer-side contract obligation. This decision composes with `cpt-frontx-adr-mfe-load-isolation`, which decides the per-load isolated module graph this ABI extends to lazy chunks.

**Scope of impact.** Decides how a lazily reached chunk is resolved into its parent load's isolated graph and shared-dependency bindings, and where the runtime/build responsibility boundary falls for that mechanism. It does not decide how the parent load's isolated graph or shared-dependency bindings are built in the first place (decided in `cpt-frontx-adr-mfe-load-isolation`), nor how a microfrontend is discovered and located for loading (decided in `cpt-frontx-adr-mfe-asset-discovery`).

**Review trigger.** Revisit if a runtime mechanism makes a lazily fetched chunk inherit a parent load's dependency bindings without a named ABI, if the constraint that lazy references be statically resolvable becomes untenable for conforming microfrontends, or if the runtime/build ownership boundary must shift.

**Checklist applicability.**

* ARCH — applicable and addressed above (a runtime resolution contract affecting every code-split microfrontend and a deliberate runtime/build ownership boundary, hard to reverse once chunks and the runtime depend on the ABI).
* ARCH-ADR-008 (supersession) — Not applicable because this is a standalone, forward-looking decision with no live superseded record to link.
* PERF — applicable and addressed above (PERF-ADR-001/002): the latency-relevant trade-off is preserving deferred resolution so the eager working set stays small while a singleton shared dependency is not duplicated across the lazy boundary; this anchors `cpt-frontx-nfr-runtime-performance`, whose on-demand-load target the ABI serves. Verification is the runtime test that a lazy reference reuses the parent load's bindings and the build check rejecting non-resolvable references; no separate load-test harness is mandated by this decision.
* SEC — Not applicable as a primary concern: the trust-surface and code-admission decision is made in `cpt-frontx-adr-mfe-load-isolation`; this decision adds no new dynamic-code primitive and constrains the ABI argument to statically resolvable references.
* REL — Not applicable because it governs module resolution within a load, not service availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — Not applicable as a primary concern: the ABI is an internal runtime/build contract, not an external integration boundary; the external integration boundary is decided in `cpt-frontx-adr-mfe-asset-discovery`.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-fr-mfe-runtime-registration` — the ABI is how a code-split microfrontend's lazily reached chunks are loaded on demand into the same isolated graph as the registered microfrontend.
* `cpt-frontx-nfr-runtime-performance` — preserving deferred resolution keeps the eager working set small and serves the on-demand-load target, while per-load inheritance avoids duplicating shared dependencies.
* `cpt-frontx-component-mfe-runtime` — this decision shapes the lazy-chunk resolution behavior of the MFE Runtime component and bounds its responsibility against template-bound build tooling.
