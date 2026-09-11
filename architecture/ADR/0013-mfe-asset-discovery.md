---
status: accepted
date: 2026-06-04
---

# MFE Asset Discovery


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Enriched-manifest-driven discovery](#enriched-manifest-driven-discovery)
  - [Runtime remote-entry parsing](#runtime-remote-entry-parsing)
  - [Host-maintained entry maps](#host-maintained-entry-maps)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-mfe-asset-discovery`
## Context and Problem Statement

To load a microfrontend the runtime must discover where its chunk assets live, which file backs each exposed entry, and what shared dependencies the microfrontend declares. That locating information can be obtained either by reading a structured description a microfrontend publishes about itself, or by fetching and parsing the microfrontend's compiled remote-entry module to recover the same facts from bundler-internal output. How should the runtime obtain the information it needs to locate and load a microfrontend's assets, so that the source of that information is a stable, declared contract rather than a bundler's internal artifact?

## Decision Drivers

* A declared, stable locating contract — the information the runtime needs to find a microfrontend's assets must come from an explicitly published, versioned description, so it is durable against changes in how a microfrontend is compiled (anchors `cpt-frontx-contract-template-manifest`).
* Substrate and bundler neutrality — discovery must not depend on the internal structure of any particular bundler's compiled output, so a microfrontend built with any conforming toolchain can be loaded (anchors `cpt-frontx-fr-mfe-runtime-registration`).
* Completeness for an isolated load — the description must carry everything an isolated load needs: the base location for assets, the file backing each exposed entry, the entry's stylesheet assets, and the full set of shared-dependency declarations in a stable **enumeration order** — so a load needs no out-of-band lookup. That enumeration order fixes only the sequence in which a consumer visits the declarations; it is neither a fetch order nor a dependency order. Resolving the declarations leaves-first is the consumer's own pass over the sources it fetches, which is where dependency-order correctness and circular-dependency handling are decided (`cpt-frontx-adr-mfe-load-isolation`).
* Robust, low-ambiguity extraction — obtaining locating facts must not rely on pattern-matching compiled output, where minification or bundler-version drift can silently change the shapes being matched.
* Producer/consumer symmetry — the same description is produced when a microfrontend is validated for publication and consumed when it is loaded, so producer and consumer share one versioned shape.

## Considered Options

* **Enriched-manifest-driven discovery** — the runtime locates and loads a microfrontend from a published, enriched manifest that carries the asset base location, per-entry backing file and stylesheet assets, and the shared-dependency declarations in the enumeration order the completeness driver fixes; the manifest is the single declared contract for discovery.
* **Runtime remote-entry parsing** — the runtime fetches the microfrontend's compiled remote-entry module at load time and recovers the locating facts by parsing that bundler-emitted output.
* **Host-maintained entry maps** — the host application carries a hardcoded map from each microfrontend to its asset locations, maintained outside any artifact the microfrontend itself publishes.

## Decision Outcome

Chosen option: **enriched-manifest-driven discovery**, because it is the only option that sources every locating fact from a stable, published, versioned contract owned by the microfrontend rather than from a bundler's internal output or from host-side bookkeeping. The runtime reads the manifest's asset base location and resolves every relative chunk reference against it, reads the backing file and stylesheet assets for the exposed entry from the manifest's per-entry asset record, and reads the shared-dependency declarations the isolated load needs, in the enumeration order the completeness driver fixes — so a single declared description supplies everything one isolated load requires, with no parsing of compiled output and no out-of-band lookup. Because the manifest is the contract published when a microfrontend is validated and consumed when it is loaded, producer and consumer share one versioned shape, and compatibility of that shape follows the platform's evolvability rule. Handler selection — which handler services a given microfrontend entry — is decided separately in `cpt-frontx-adr-mfe-handler-resolution`; this decision fixes only that, whichever handler is selected, discovery is manifest-driven.

### Consequences

* Good, because the runtime depends on a declared, versioned contract rather than on bundler-internal output, so discovery survives changes in how a microfrontend is compiled.
* Good, because discovery is bundler- and substrate-neutral: any conforming toolchain that emits the manifest shape can be loaded.
* Good, because the manifest carries everything an isolated load needs, so a load requires no secondary parse or out-of-band lookup.
* Good, because reading declared fields is robust where recovering the same facts from compiled output would be sensitive to minification and bundler-version drift.
* Good, because producer and consumer share one versioned shape, keeping the publication and load paths symmetric.
* Bad, because every microfrontend must publish a conforming manifest, so the contract is a precondition for loadability and an obligation on the producer.
* Bad, because the manifest shape becomes a versioned compatibility surface that must evolve under the platform's evolvability rule rather than changing freely.

### Confirmation

A continuous-integration check confirms manifest conformance and the discovery path. A schema/contract check confirms that a microfrontend's published manifest carries the required locating fields — asset base location, per-entry backing file and stylesheet assets, and the shared-dependency declarations in the enumeration order the completeness driver fixes — and rejects a manifest missing them. An automated runtime test confirms that a load resolves its asset base location and per-entry backing file from the manifest alone and completes without fetching or parsing a compiled remote-entry module. The grounding mechanisms in the present concrete instantiation are the manifest type `MfManifest` (`packages/mfes/src/manifest/mf-manifest.ts`) with its `metaData.publicPath` asset base (`packages/mfes/src/manifest/mf-manifest.ts`) and its `shared[]` declarations in that enumeration order (`packages/mfes/src/manifest/mf-manifest.ts`), the per-entry `exposeAssets` asset record carried on the entry, and the runtime load path in `MfeHandlerMF` that derives the base location from `manifest.metaData.publicPath` (`packages/mfes/src/handler/MfeHandlerMF.ts`) and the backing file from `exposeAssets.js.sync[0]` (`packages/mfes/src/handler/MfeHandlerMF.ts`). The handler carries no remote-entry parsing on or beside the load path.

## Pros and Cons of the Options

### Enriched-manifest-driven discovery

The runtime locates and loads a microfrontend from a published, enriched manifest carrying the asset base location, per-entry backing file and stylesheet assets, and the shared-dependency declarations in the enumeration order the completeness driver fixes.

* Good, because it sources every locating fact from a stable, versioned, published contract.
* Good, because it is bundler- and substrate-neutral.
* Good, because the manifest is complete for an isolated load — no secondary parse, no out-of-band lookup.
* Good, because reading declared fields is robust against minification and bundler-version drift.
* Neutral, because it introduces a versioned manifest-shape compatibility surface.
* Bad, because every microfrontend must publish a conforming manifest as a precondition for loadability.

### Runtime remote-entry parsing

The runtime fetches a microfrontend's compiled remote-entry module at load time and recovers locating facts by parsing that bundler-emitted output.

* Good, because it needs no separately published description — the facts are recovered from the shipped bundle.
* Good, because it reuses an artifact a federated build already emits.
* Bad, because it couples discovery to a bundler's internal output shape, which changes with minification and bundler version.
* Bad, because parsing compiled output to recover structured facts is ambiguity-prone and brittle compared with reading declared fields.

### Host-maintained entry maps

The host application carries a hardcoded map from each microfrontend to its asset locations, maintained outside any artifact the microfrontend publishes.

* Good, because the host has full, explicit control over where each microfrontend's assets are located.
* Bad, because the locating information lives with the host rather than the microfrontend, so it drifts from the microfrontend it describes and must be hand-maintained as microfrontends change.
* Bad, because it defeats runtime registration of independently developed microfrontends, since each addition requires editing host-side bookkeeping rather than honoring a published contract.

## More Information

The present concrete instantiation publishes the manifest as an enriched `mfe.json` / `mf-manifest.json` whose `metaData.publicPath` gives the asset base, whose per-entry `exposeAssets` gives each entry's synchronous backing chunk and its stylesheet assets, and whose `shared[]` lists the shared dependencies in the enumeration order the completeness driver fixes (how a load builds its isolated graph from those declarations, including how it handles circular ones, is decided in `cpt-frontx-adr-mfe-load-isolation`); the runtime derives the base location from `publicPath` and the backing file from the entry's `exposeAssets`, with no fetch or parse of a compiled remote-entry module on the load path. The specific manifest filenames, field names, and the asset-record shape are descriptive of the current instantiation and non-binding; the durable decision is that discovery is driven by a published, versioned manifest contract rather than by parsing compiled remote-entry output. Handler selection for a given entry is cross-referenced to `cpt-frontx-adr-mfe-handler-resolution`; this decision constrains only the discovery source, not which handler is chosen. The manifest shape's compatibility follows `cpt-frontx-nfr-evolvability`.

**Scope of impact.** Decides the source of the information the runtime uses to locate and load a microfrontend's assets — a published, versioned manifest contract. It does not decide which handler services a given entry (decided in `cpt-frontx-adr-mfe-handler-resolution`), nor how a lazily reached chunk is resolved into a load's isolated graph (decided in `cpt-frontx-adr-lazy-import-resolution`), nor how the manifest's type identifiers are validated (the type-system plugin's responsibility).

**Review trigger.** Revisit if a published, versioned discovery contract can no longer carry everything an isolated load needs, if a backward-incompatible change to the manifest shape is required (handled under `cpt-frontx-nfr-evolvability`), or if a substrate emerges for which a declared manifest cannot be produced.

**Checklist applicability.**

* ARCH — applicable and addressed above (the discovery-source decision affects every microfrontend load and the runtime's coupling to build output, and is hard to reverse once microfrontends publish to the contract).
* ARCH-ADR-008 (supersession) — Not applicable because this is a standalone, forward-looking decision with no live superseded record to link.
* INT — applicable and addressed above (INT-ADR-001/002): the manifest is the integration contract between a microfrontend and the runtime; its shape is the versioned interface, its compatibility follows `cpt-frontx-nfr-evolvability`, a backward-incompatible change is a contract change governed by that rule, and conformance is the consumer-testing requirement confirmed by the schema/contract check. This anchors `cpt-frontx-contract-template-manifest`.
* SEC — Not applicable as a primary concern: this decision selects the source of locating information; code-admission trust and isolation are decided in `cpt-frontx-adr-mfe-load-isolation`.
* REL — Not applicable because it governs the discovery contract, not service availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema definition is owned here; the manifest is an integration contract, not a stored data schema.
* PERF — Not applicable as a primary concern: avoiding a compiled-output parse is a robustness and neutrality decision; the runtime-performance targets are anchored in `cpt-frontx-adr-lazy-import-resolution`.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-fr-mfe-runtime-registration` — manifest-driven discovery is how a registered microfrontend is located and loaded on demand without depending on a particular bundler's compiled output.
* `cpt-frontx-contract-template-manifest` — this decision makes the published manifest the runtime's discovery contract, the bidirectional shape produced at publication and consumed at load.
* `cpt-frontx-component-mfe-runtime` — this decision shapes how the MFE Runtime component discovers and locates a microfrontend's assets for loading.
