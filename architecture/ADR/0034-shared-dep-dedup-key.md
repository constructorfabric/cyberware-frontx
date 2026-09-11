---
status: proposed
date: 2026-09-10
---

# What Identity Should the Cross-MFE Shared-Dependency Source-Text Cache Key On?

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Key on a producer-published content hash of the emitted chunk, with a resolved-chunk-URL fallback](#key-on-a-producer-published-content-hash-of-the-emitted-chunk-with-a-resolved-chunk-url-fallback)
  - [Key on the resolved absolute chunk URL only](#key-on-the-resolved-absolute-chunk-url-only)
  - [Keep the version-based key and require every producing build to bundle a shared dependency identically](#keep-the-version-based-key-and-require-every-producing-build-to-bundle-a-shared-dependency-identically)
  - [Key on a hash of the bundling parameters rather than of the emitted bytes](#key-on-a-hash-of-the-bundling-parameters-rather-than-of-the-emitted-bytes)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-shared-dep-dedup-key`

## Context and Problem Statement

The runtime keeps a cross-microfrontend cache of shared-dependency source text so that loading a second microfrontend which declares the same shared dependency need not fetch it again. A shared-dependency chunk, however, is not a published package artifact: it is produced per consuming microfrontend, and which of the dependency's own transitive requirements are left inside it, versus externalized, is a function of the consuming microfrontend's own declared shared list at the time it was built. Two microfrontends can therefore declare the same package at the same version and legitimately ship structurally different chunks. A deduplication key built from the package name and version identifies the build's *input*, not its *output*, so whichever microfrontend's load reaches the cache first can hand its chunk's source text to every later microfrontend that declares the same name and version — even when that later microfrontend's own declared shared list never authorized the externals the first chunk assumed. The evaluating microfrontend then meets an unrewritten reference it cannot resolve, and it fails to mount. What identity should the cache key use so that reuse only ever happens between loads that agree on what is actually being reused?

## Decision Drivers

* Correctness must not depend on a convention the runtime cannot verify about third-party producing builds — the runtime consumes published descriptions from origins it does not control and cannot assume they were produced identically.
* Already-deployed microfrontends must not have to change for the runtime to become correct — a fix that requires every existing producing build to be rebuilt before the defect is closed is not a fix the runtime controls.
* Cross-microfrontend reuse of identical source text is worth preserving where it is sound — the caching mechanism exists to avoid duplicate fetches of a genuinely shared, byte-identical dependency, and a correct key should not discard that benefit unconditionally.
* A wrong reuse decision must fail safe, not fail silent — when the runtime cannot establish that two chunks are the same build, it must choose no reuse over reuse, because the alternative is foreign code evaluated inside a microfrontend that never declared it.
* The published manifest contract evolves additively — producing builds and the runtime ship on independent release trains, so a fix that only takes effect once every producer adopts a new required field cannot be the runtime's sole remedy.

## Considered Options

* Key on a producer-published content hash of the emitted chunk, with a resolved-chunk-URL fallback
* Key on the resolved absolute chunk URL only
* Keep the version-based key and require every producing build to bundle a shared dependency identically
* Key on a hash of the bundling parameters rather than of the emitted bytes

## Decision Outcome

Chosen option: **key on a producer-published content hash of the emitted chunk, with a resolved-chunk-URL fallback**, because it is the only option that ties reuse to a verifiable statement about the build actually being reused, requires no coordinated adoption to become correct, and preserves cross-microfrontend reuse exactly where it is sound rather than forfeiting it everywhere.

The published manifest **may** carry, for a given shared-dependency entry, an optional content hash of that entry's emitted chunk. When the loading microfrontend's manifest declares this hash, the runtime reuses cached source text for that entry only across loads whose declared hash matches — the hash stands for the identity of the emitted build, not for the package name and version that fed into it, so name and version alone no longer authorize reuse. When the hash is absent, the runtime **fails safe**: it scopes reuse to the resolved absolute chunk URL, which is unique per microfrontend because the microfrontend's own asset base location is unique, so an absent hash limits reuse to repeated loads of the same microfrontend and never serves one microfrontend's chunk to another. Because the hash is optional and additively declared, the runtime is correct with or without any given producing build's adoption of it: an adopting producing build recovers cross-microfrontend reuse, and a non-adopting one degrades to the always-safe, same-microfrontend scope rather than to the unsafe prior behaviour.

This decision fixes the identity the cache key must express and the fail-safe posture when that identity is not available; it does not fix the hash's algorithm, its field name, or where it is declared, which are contract-shape choices for the FEATUREs that own the manifest's concrete schema and the runtime's load path.

### Consequences

* Good, because reuse becomes provably safe rather than coincidentally safe: source text is shared only between loads that agree on the identity of the emitted chunk being reused.
* Good, because the runtime is correct with or without producer adoption of the optional hash, so no coordinated release across producing builds and the runtime is required to close the defect.
* Good, because the fallback preserves same-microfrontend reuse and leaves the browser's own URL-keyed caching unaffected; nothing is made unsafe by the fallback path.
* Bad, because cross-microfrontend reuse is recovered only for shared-dependency entries whose producing build publishes the hash — until adoption is widespread, a microfrontend's first load of a given shared dependency costs one fetch per remote rather than one fetch across all remotes.
* Bad, because the published manifest gains an optional field that must be declared consistently everywhere the shared-dependency shape is declared, adding a small, permanent surface to that contract.
* Neutral, because whether two independently produced builds of the same dependency at the same version emit identical bytes is a property to be measured for each producing build, not assumed from this decision; where it does not hold, the remedy is to make the producing build's output deterministic, never to weaken the key back toward the package name and version.

### Confirmation

Compliance is confirmed by contract and by runtime behaviour. A schema-conformance check on the published manifest confirms that a per-shared-dependency content hash, where present, is declared as an optional field rather than a required one, so a producing build that omits it remains a conforming manifest. A runtime test confirms that two loads whose manifests declare a matching hash for the same shared-dependency entry share cached source text, that two loads whose manifests declare differing hashes for the same name and version do not, and that a load whose manifest omits the hash reuses cached text only against a prior load resolving the identical absolute chunk URL. A further test confirms that an unrewritten reference is never masked: when the surviving specifier is one the manifest declared, even a coincidental cross-microfrontend match on a resolved URL still surfaces as a diagnosed load failure naming the chunk and the microfrontend, and otherwise it surfaces as a diagnostic naming the chunk and the microfrontend alongside the browser's own instantiation failure.

## Pros and Cons of the Options

### Key on a producer-published content hash of the emitted chunk, with a resolved-chunk-URL fallback

The published manifest may declare a content hash of the emitted shared-dependency chunk; the runtime keys reuse on that hash when present, and on the resolved absolute chunk URL when it is not.

* Good, because the key expresses the identity of the build actually being reused, not the package version that fed into it.
* Good, because it needs no coordinated adoption across producing builds and the runtime to become correct.
* Good, because it preserves cross-microfrontend reuse for adopting producing builds while degrading safely for the rest.
* Neutral, because it adds one optional field to a contract that already evolves additively.
* Bad, because full cross-microfrontend reuse is only realized once producing builds broadly adopt the optional hash.

### Key on the resolved absolute chunk URL only

Drop the content hash entirely and key every shared-dependency cache entry solely on the resolved absolute chunk URL the microfrontend's own manifest declares.

* Good, because it is unconditionally safe: an absolute chunk URL is unique per microfrontend, so reuse never crosses a build boundary it should not.
* Good, because it needs no change to the published manifest contract at all.
* Bad, because a microfrontend's own asset base location is unique to it, so this option forfeits cross-microfrontend reuse entirely rather than preserving it where it is sound — every microfrontend refetches every shared dependency regardless of whether an identical build already exists in cache.

### Keep the version-based key and require every producing build to bundle a shared dependency identically

Retain the package-name-and-version key, and instead constrain every producing build to bundle a given shared dependency the same way, so that any two chunks sharing a key are guaranteed to be byte-identical by construction.

* Good, because it would recover safe reuse without adding any field to the published manifest.
* Bad, because the runtime cannot verify that a third-party producing build actually followed the convention — the manifest gives it no way to check, so a violation reproduces exactly today's defect.
* Bad, because it obliges a transitive-closure change to every consuming microfrontend's declared shared list, since a dependency's externals depend on that list.
* Bad, because it cannot repair already-deployed microfrontends, which keep shipping whatever they externalized before the convention existed.

### Key on a hash of the bundling parameters rather than of the emitted bytes

Fingerprint the inputs to the build step — the dependency's declared version and the consuming microfrontend's declared shared list — rather than hashing the bytes the build emits, and key reuse on that fingerprint.

* Good, because it can be computed without needing access to the emitted chunk's bytes.
* Bad, because what a build actually inlines depends on the producing build's own resolved dependency tree, which a fingerprint of declared parameters does not capture — two chunks can share a parameter fingerprint while differing in inlined transitive code.
* Bad, because that mismatch fails silently: the runtime reports a cache hit and evaluates foreign code with no error, trading a loud failure for a silent one.

## More Information

The optional hash's algorithm, its field name and declaration site within the published manifest's shared-dependency entry, and how the runtime's load path derives and compares it are contract-shape and implementation choices left to the FEATUREs that own the manifest's concrete schema and the runtime's shared-dependency load behaviour; this decision fixes only the identity the key must express and the fail-safe posture when that identity is unavailable. Byte-level agreement between independently produced builds of the same dependency and version is not guaranteed by this decision — it is an obligation on each producing build, confirmed by measurement, and the correct response to its absence is to make that build's output deterministic rather than to weaken the key.

This decision does not amend `cpt-frontx-adr-mfe-asset-discovery`: that decision declares the published manifest's field names and shapes descriptive and non-binding, and one of its review-trigger conditions is a backward-incompatible manifest change; an additive optional field is not that. It does not amend `cpt-frontx-adr-mfe-load-isolation` either: that decision governs per-load module isolation, which is unaffected here, since every load continues to mint its own isolated module graph regardless of whether its shared-dependency source text came from cache or from a fresh fetch. The producing build that emits the content hash is template territory, so how that build computes and publishes the hash is governed by `cpt-frontx-adr-template-territory-traceability` and ships on the template's own release train, independent of this decision's adoption by the runtime.

**Open question, recorded rather than resolved here**: the published manifest's concrete field-level schema has no FEATURE that owns it, unlike other contracts whose ownership `cpt-frontx-adr-contract-schema-ownership` assigns by name. This decision does not assign that ownership; closing that gap is a separate decision.

**Review trigger.** Revisit if measurement shows that independently produced builds of the same dependency and version cannot be made to agree on emitted bytes at a rate that makes the optional hash worth publishing, if a mechanism to verify fetched bytes against the declared hash is later brought into scope, or if the published manifest's shared-dependency shape changes backward-incompatibly.

**Checklist applicability.** ARCH — applicable and addressed above: this decision fixes the identity a cross-microfrontend cache mechanism keys on, and reversing it after broad producer adoption of the optional hash would be costly. INT — applicable and addressed above: the optional hash is an additive field on the published manifest's shared-dependency entry, the integration contract between a producing build and the runtime; its compatibility follows the platform's evolvability rule. SEC — applicable and addressed above: the fail-safe fallback exists precisely to prevent one microfrontend's declared trust boundary from being widened by evaluating another microfrontend's chunk. REL — applicable and addressed above: the fail-loud invariant confirmed alongside this decision ensures a wrong reuse surfaces as a diagnosed load failure rather than as silently evaluated foreign code. PERF — applicable and addressed above: the fallback's cost is bounded to one extra fetch per remote per shared dependency until producer adoption, never a correctness cost. DATA — Not applicable, because no persistent data store or complete schema definition is fixed here; the hash is one optional field on an existing integration contract. OPS — Not applicable, because no deployed-service operational procedure is governed by this decision. COMPL — Not applicable. UX — Not applicable, because this decision has no end-user-facing surface; its consequence is a microfrontend mounting correctly rather than failing to mount, which is addressed under REL. BIZ — Not applicable, because product requirements live in the PRD and are cited here by ID.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-nfr-runtime-performance` — the cross-MFE shared-dependency source-text cache this NFR's mechanism describes is the mechanism this decision corrects: its key must identify the producing build being reused, not merely the package name and version, to keep the cache's performance benefit safe.
* `cpt-frontx-nfr-security` — the fail-safe fallback to same-microfrontend scoping is the concrete instance, for this cache, of the default-deny posture this NFR requires: a microfrontend gains no capability to receive another microfrontend's chunk text without a verifiable declared match.
* `cpt-frontx-fr-mfe-runtime-registration` — on-demand loading reads locating facts exclusively from the published manifest's declared fields; this decision extends that same manifest-sourced posture to the source-text reuse decision, rather than inferring build identity from package name and version.
* `cpt-frontx-component-mfe-runtime` — this decision constrains how the MFE Runtime component's shared-dependency cache establishes the identity of what it is reusing.
