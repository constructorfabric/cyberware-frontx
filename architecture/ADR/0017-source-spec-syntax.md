---
status: accepted
date: 2026-07-28
---

# Source-Spec Syntax for Versioned Template References

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Host-prefixed token with an optional subtree segment](#host-prefixed-token-with-an-optional-subtree-segment)
  - [Full URL plus separate version and subdirectory fields](#full-url-plus-separate-version-and-subdirectory-fields)
  - [Bare name resolved against a default registry](#bare-name-resolved-against-a-default-registry)
  - [One repository per template, with no subtree addressing](#one-repository-per-template-with-no-subtree-addressing)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-source-spec-syntax`

## Context and Problem Statement

The CLI (`cpt-frontx-component-cli`, the `@gears-frontx/cli` package) resolves every template from an external source by a versioned reference rather than bundling any (the externalization decision, `cpt-frontx-adr-template-acquisition-and-location`). For that resolution to be deterministic, the reference a developer supplies must have a defined shape that names a host, a repository, and an explicit version. The source-spec contract (`cpt-frontx-contract-source-spec`) requires versioned references to templates hosted on the source registry (`cpt-frontx-actor-github`) but deliberately fixes no concrete syntax at the product-requirements level.

A repository is also not the unit of a template. Under the uniform template mechanism (`cpt-frontx-adr-uniform-template-mechanism`), a single repository is the natural home for a family of templates authored together, and a composed preset (`cpt-frontx-adr-composed-template-resolution`) references sibling templates that have no reason to live in separate repositories. Sharing a repository is a co-authorship fact and not a release fact: a family may be released as one set, and it may equally be released on per-sibling version lines when the reason the siblings were separated in the first place was so that each could version independently. The shape must therefore serve both, rather than assume the siblings move together. A shape that addresses a repository as a whole would admit exactly one template per repository and force a repository split for a packaging reason rather than an ownership reason.

What concrete shape should a versioned source-spec take, so that a reference is unambiguous, version-pinned, able to address a template occupying a subtree of a repository, and consistent with the host-prefixed reference form already established across the platform substrate?

## Decision Drivers

* **Unambiguous origin** — a reference must encode which host and which repository identify a template, so resolution is never guessed from context.
* **Explicit, mandatory version pin** — the reference must carry an explicit version selector (a tag, branch, or commit) so acquisition is reproducible (`cpt-frontx-fr-cli-template-install`), rather than defaulting to a moving target.
* **Several templates in one repository** — a reference must be able to name one template among several published from the same repository at the same version, so repository topology follows ownership rather than the addressing scheme.
* **One reference vocabulary** — the platform substrate already expresses external sources in a host-prefixed `host:owner/repo` form, and its own kit installer already addresses a subtree with a `//` segment; reusing both keeps one mental model across the ecosystem instead of introducing a second reference vocabulary.
* **One value that travels as one value** — a reference is stored and re-resolved, not only consumed once: a provenance record retains it (`cpt-frontx-adr-project-provenance-record`) and an upgrade re-resolves through it, so every part of it must travel together through every surface that carries it.
* **Deterministic parse** — every delimiter position must be fixed by rule, so any reference either splits into its parts one way only or is rejected; no input may split two plausible ways.
* **Acquisition mechanism unchanged** — subtree selection must be a filter applied to acquired content, not a second transport, so the externalized-acquisition decision (`cpt-frontx-adr-template-acquisition-and-location`) and its single shared resolver stay intact.
* **Human-writable and parseable** — the shape must be short enough to type and copy by hand yet structured enough to parse deterministically into its parts.
* **Forward compatibility** — the shape must admit additional hosts and additional version-selector kinds without a breaking change to references already in use, consistent with the platform evolvability requirement.

## Considered Options

* **Host-prefixed token with an optional subtree segment** — a single string of the form `host:owner/repo[//subtree]@ref`, where `host` names the source registry, `owner/repo` identifies the repository, the optional `//subtree` segment names the subtree the template occupies, and `@ref` is a mandatory version selector. This is the host-prefixed form already established in the platform substrate, extended with the substrate's own subtree segment.
* **Full URL plus separate version and subdirectory fields** — references are expressed as a complete repository URL accompanied by a distinct version argument and a distinct subdirectory argument, parsed as independent inputs.
* **Bare name resolved against a default registry** — references are an unprefixed name resolved against an implied default registry and an implied default version, with host and version inferred rather than stated, and any subtree declared in the template's own configuration.
* **One repository per template, with no subtree addressing** — the token names a repository only; a template that must be addressable is published from its own repository, and a family of templates becomes a family of repositories.

## Decision Outcome

Chosen option: **Host-prefixed token with an optional subtree segment**, because it resolves the unambiguous-origin, explicit-version, and one-value drivers in a single compact token while reusing the reference shape already established across the platform substrate. The complete shape is:

```text
host:owner/repo[//subtree]@ref
```

The `host:` prefix is mandatory and names the source registry generically (the established host token `github` names the GitHub source registry, `cpt-frontx-actor-github`); `owner/repo` is mandatory and identifies the repository; `//subtree` is optional and names the subtree the template occupies; `@ref` is a mandatory version selector, so acquisition is reproducible.

Delimiter positions are fixed by rule:

* the host token ends at the **first** `:`;
* the ref selector begins after the **first** `@` in the remainder;
* the repository path is what lies between them, and splits at its **first** `//`;
* `owner` and `repo` are each exactly one non-empty segment, so `//` cannot occur inside a well-formed repository path and the split point is unambiguous;
* a subtree segment must be usable as a repository-relative path and must resolve within the acquired content root;
* anything else — an empty or trailing-slash subtree segment, a repository path with a segment count other than two, a subtree that escapes the content root — is rejected rather than reinterpreted.

Absence of the subtree segment denotes the repository root; there is no second spelling of that meaning, because a present-but-empty segment is invalid rather than equivalent. The subtree is compared literally, so two references differing only in the case of a subtree segment are two references, even on a filesystem that would not distinguish them. Because the ref selector begins at the first `@`, a subtree path containing `@` is not addressable under this shape.

The `host:` prefix and the `@ref` position are extension points: additional source hosts and additional selector kinds are admitted without changing the shape of existing references.

Subtree selection is a filter applied to content already acquired by the existing mechanism: whole-repository acquisition and the single shared resolver are untouched, and only the materialization step narrows to the matched subtree, re-rooted so that the template's own paths are relative to itself and a template is unaware of where in a repository it lives.

The full-URL option splits one logical reference into inputs that can disagree, must be cross-validated, and must be carried together through every surface that stores or re-resolves a reference — provenance records and a preset's declared sibling references among them; it is also more verbose to write and copy. The bare-name option infers host and version, forfeiting the unambiguous-origin and explicit-version-pin drivers, and can only source a subtree from the template's own configuration, which is unavailable to a reference that must name one template among several before any content is fetched. The repository-per-template option answers the addressing question by forbidding the case, imposing repository proliferation as the price of packaging and leaving a composed preset's siblings spread across repositories that must then be versioned in lockstep by convention.

This decision fixes the reference shape only. Which value identifies a template once several templates share a repository is not decided here: the manifest declares a template's identity (`cpt-frontx-adr-template-manifest-contract`), and the field-level schema of that declaration belongs to the owning FEATURE per `cpt-frontx-adr-contract-schema-ownership`. Resolving a source-spec is the responsibility of the shared resolver established by the externalization decision.

### Consequences

* Good, because a single compact token unambiguously encodes host, repository, subtree, and an explicit version, making references easy to write, copy, and parse, and keeping one reference one value that can be stored and re-resolved as a unit.
* Good, because a repository can publish a family of templates addressed individually, so repository boundaries follow ownership instead of the addressing scheme.
* Neutral, because the version selector is repository-scoped while the subtree segment is template-scoped: `@ref` names one point in the repository's history, and every sibling addressed from that point is addressed at it. A family released as one set gets exactly what it needs from this and pays nothing. A family whose siblings version independently gets the same guarantee only if the refs it publishes are themselves per-sibling — a ref namespace in which a sibling's release names that sibling — because a repository-wide ref advanced for one sibling moves the address of every other sibling with it. Which ref namespace a family publishes is the family's own convention and is not fixed here; what is fixed is that independent sibling versioning is expressed in the ref, since the shape offers no second place to carry it.
* Good, because the ecosystem carries one reference vocabulary, subtree segment included, shared with the platform substrate rather than two shapes for one concept.
* Good, because the `host:` prefix and the `@ref` position are extension points that admit new hosts and new selector kinds without breaking existing references.
* Good, because acquisition is unchanged and subtree selection is confined to materialization, so the shared resolver stays the single resolution path.
* Bad, because admitting several templates per repository removes the uniqueness the registry namespace would otherwise supply for free: under one template per repository, `owner/repo` would make a template's identity unique by construction. Identity is used as a content-path segment and as a provenance and conflict-check key, so it must carry a uniqueness guarantee of its own — a requirement this shape creates and the manifest contract (`cpt-frontx-adr-template-manifest-contract`) and its owning FEATURE must satisfy.
* Bad, because filtering after acquisition means installing N sibling templates from one repository acquires that repository N times — the cost of leaving acquisition unchanged, paid exactly in the case this shape makes common. Only acquisition is duplicated: each install materializes its own subtree alone. Sparse acquisition would remove the duplicate transfer and would require revisiting this record.
* Bad, because a subtree path containing `@` is not addressable, which is the price of the ref delimiter rule.
* Bad, because a subtree path containing `:` or `\` is likewise not addressable, for a different reason: the segment is resolved against a root the CLI owns, and both characters carry a platform-dependent meaning there — `:` designates a drive on Windows, so `C:/outside` would be absolute on one platform and an ordinary relative segment on another, and `\` separates segments on one platform and is an ordinary character on the other. A control character is excluded on the same ground, since it makes the platform API throw past the result union the parser returns. The exclusion is a property of the path the segment becomes rather than of the delimiter rules, so it applies equally to the identity a manifest declares.
* Bad, because a reference can fail in ways parsing cannot detect, and those failures land on the upgrade path as well as at install: the subtree may not exist at the referenced version, may exist but declare no manifest, or may have been relocated by an ordinary repository reorganization between the applied version and the target one. Repositories reorganize far more often than they are renamed, so this is a routine upgrade failure mode rather than an edge case.
* Bad, because bounded local update accepts a new reference for an existing entry, so pointing an entry at a different subtree of the same repository substitutes one template for another without any acquisition-level failure; only the identity the substituted template declares can distinguish the two, which places the guard outside this decision.
* Bad, because a packed string carrying an optional position is less self-describing to a first-time reader than separately labelled fields would be, and a mandatory `@ref` adds friction for a developer who would otherwise omit a version and accept an implied default.

### Confirmation

Compliance is confirmed by design and code review plus parser-level and resolution-level checks on the CLI.

The reference parser MUST round-trip a valid `host:owner/repo//subtree@ref` reference into its five constituent parts (host, owner, repository, subtree, ref); MUST parse a reference carrying no subtree segment into four parts, with no subtree, so that a reference written without one keeps its meaning; MUST reject any reference omitting the `host:` prefix or the `@ref` selector; and MUST reject, rather than reinterpret, a repository path whose segment count is not two, an empty or trailing-slash subtree segment, and a subtree segment that is not usable as a repository-relative path — one carrying surrounding whitespace, a leading `/`, a backslash, a `:`, a control character, or an empty, `.`, or `..` segment. A continuous-integration test asserts each rejection and asserts that a subtree-less reference addresses the repository content root.

A resolution-level test asserts that only the matched subtree is materialized, that materialized paths are relative to the subtree rather than to the repository, and that a reference naming a subtree absent at the referenced version fails with an error identifying the subtree rather than silently materializing the repository root. A further test asserts that narrowing refuses outright when re-rooting would lift a retained path out of the subtree: an acquired path may sit inside the repository and escape only once its prefix is stripped, so the reference-side check cannot catch it and the refusal has to happen where the escape is created.

The assertion that two references differing only in their subtree segment yield two distinct tracked templates from one repository at one version is a property of template identity, not of the reference shape, and is verifiable only where identity is taken from the manifest per `cpt-frontx-adr-template-manifest-contract`. That conformance is a precondition of this assertion rather than of this decision, and it is named here so a reader of this record alone can see which other decision the assertion rests on.

## Pros and Cons of the Options

### Host-prefixed token with an optional subtree segment

A single string `host:owner/repo[//subtree]@ref` reusing the host-prefixed form and the subtree segment established in the platform substrate, with a mandatory version selector.

* Good, because origin, subtree, and version are encoded unambiguously in one compact, copy-pasteable token that can be stored, copied, and re-resolved as a unit.
* Good, because it matches the reference shapes already established in the substrate rather than introducing a second vocabulary.
* Good, because the shape has mainstream precedent beyond the substrate: Terraform module sources address a subdirectory with the same `//` segment.
* Good, because the host prefix and ref position extend to new hosts and selector kinds without breaking existing references.
* Neutral, because the `host` token vocabulary and the interpretation of a subtree are governed by the resolver rather than fixed here.
* Bad, because the position of the ref delimiter constrains what a subtree path may contain, so `@`-containing paths are excluded.
* Bad, because a packed string carrying an optional position is less self-describing than labelled fields.

### Full URL plus separate version and subdirectory fields

A complete repository URL accompanied by distinct version and subdirectory arguments, parsed as independent inputs.

* Good, because each part is explicitly labelled and self-describing, and no delimiter constrains what a subtree path may contain.
* Good, because a full URL is unambiguous about transport and host.
* Bad, because independent inputs can disagree and must be cross-validated wherever a reference is stored or re-resolved.
* Bad, because every surface that carries a reference must be widened to carry the extra values — provenance records, a preset's declared sibling references, and command arguments.
* Bad, because it diverges from the host-prefixed shape established in the substrate, introducing a second reference vocabulary.

### Bare name resolved against a default registry

An unprefixed name resolved against an implied default registry and an implied default version, with any subtree declared in the template's own configuration.

* Good, because it is the shortest possible reference to type.
* Good, because it is a working mainstream precedent rather than a hypothetical: Copier scopes a template to a subdirectory through a declared `_subdirectory` setting rather than through the reference.
* Bad, because host is inferred, failing the unambiguous-origin driver.
* Bad, because an implied default version is a moving target, failing the explicit-version-pin and reproducibility drivers.
* Bad, because a setting inside the template is unavailable to a reference that must name one template among several before any content is fetched, which is exactly the case a family of templates in one repository creates.

### One repository per template, with no subtree addressing

The token names a repository only; a template that must be addressable gets its own repository.

* Good, because it requires no subtree rule in the shape or in any parser.
* Good, because each template's version history is unambiguously its own.
* Bad, because it forces repository proliferation for a packaging reason rather than an ownership reason.
* Bad, because a composed preset's sibling templates end up in separate repositories that must be kept version-aligned by convention rather than by construction.

## More Information

The reference shapes this decision reuses are both established in the platform substrate: external sources are expressed in the host-prefixed `host:owner/repo` form in the substrate's own configuration (for example a `source = "github:constructorfabric/studio-kit-sdlc"` entry under a kit section), and the substrate's kit installer admits a subtree with `install git/<url>[//<subdir>][@<kit>]`, which a reviewer can confirm from the installed tool's own help output. Both are cited as neutral examples of established shapes, not as binding dependencies; the concrete tokens, tool, and repositories are non-binding present detail rather than part of this decision's durable identity. The mechanism that acquires the referenced content and the single shared resolver that performs resolution are decided in `cpt-frontx-adr-template-acquisition-and-location`; the source registry actor is `cpt-frontx-actor-github`.

The determinism of the repository-path split rests on a property of the admitted host set rather than on the shape alone: every admitted host's repository path must consist of non-empty segments, so that a doubled slash cannot occur inside it. Admitting a host whose identifier path may carry an empty segment, or a requirement to address subtree paths containing `@`, invalidates the split rule and triggers revisiting this decision, as would a move from post-acquisition filtering to sparse acquisition.

Integration analysis (**INT**): the source-spec is a client-supplied contract (`cpt-frontx-contract-source-spec`, direction required-from-client). Its consumer is the CLI's reference parser and shared resolver; its producer is any developer or tool that names a template. Version-compatibility intent is additive: the subtree segment is optional, so additional hosts and selector kinds are introduced without invalidating references already written, and any change to the shape that is not backward-compatible follows the platform evolvability requirement. A reference is also stored and re-resolved rather than only consumed once: a provenance record retains it (`cpt-frontx-adr-project-provenance-record`), so a reference that carries a subtree must re-resolve to the same subtree at upgrade time. No external integration partner consumes this shape beyond the source registry it addresses.

**SEC** — addressed: the subtree segment is the only developer- or third-party-supplied path fragment in a reference, and it reaches local filesystem selection and re-rooting. It arrives not only by hand but inside a third-party manifest, since a composed preset declares its sibling references (`cpt-frontx-adr-composed-template-resolution`). This decision therefore fixes as a property of the shape that a subtree segment MUST be usable as a repository-relative path and MUST resolve within the acquired content root; a segment that does not is rejected, and no path outside that root is ever written. The reference carries no secret material.

Applicability of the remaining checklist categories: **PERF** — Not applicable at decision altitude, because parsing a short reference carries no throughput or latency budget; the acquisition cost of sibling templates is recorded as a consequence rather than as a performance target. **REL** — Not applicable, because there is no service availability target for a parsed reference. **DATA** — Not applicable, because no persistent schema is defined here; the reference is a transient input shape, and the record that stores it is decided in `cpt-frontx-adr-project-provenance-record`. **OPS** — Not applicable, because no operational procedure attaches to a reference shape. **MAINT** — addressed: one addressing vocabulary shared with the substrate, and one repository able to hold a family of templates, reduce both cognitive load and repository sprawl. **UX** — addressed: the reference remains a single compact, copy-pasteable token. **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-contract-source-spec` — This decision fixes the complete `host:owner/repo[//subtree]@ref` shape for the versioned-reference contract that the contract leaves unspecified at product-requirements altitude, including the optional subtree segment that lets one repository serve several referenced templates.
* `cpt-frontx-fr-cli-template-install` — The mandatory `@ref` version selector is what makes installation by versioned reference deterministic and reproducible, and it stays so when the referenced template occupies a subtree rather than a whole repository.
* `cpt-frontx-fr-cli-template-update-local` — Bounded local update accepts a versioned reference as input, so its input surface carries this shape, including the substitution risk recorded in the consequences.
* `cpt-frontx-fr-cli-template-list` — The inventory a developer lists may hold several templates acquired from one repository. The subtree distinguishes the references that acquired them, not the identities they are listed under: identity remains what each manifest declares (`cpt-frontx-adr-template-manifest-contract`), so two references differing only in subtree yield two entries when their manifests declare different identities, and a collision when they declare the same one.
* `cpt-frontx-fr-cli-composed-template-resolution` — A preset's declared sibling references are the motivating case for addressing templates that share a repository, and they carry the shape this decision fixes.
* `cpt-frontx-contract-project-provenance` — A provenance record stores the reference that re-resolves an applied template, so a stored reference must retain its subtree for a later upgrade to re-resolve the same template rather than the repository root.
* `cpt-frontx-actor-github` — The `host:` prefix names the source registry generically, and the referenced subtree is selected from content acquired from that registry by the existing acquisition mechanism, which this decision leaves unchanged.
