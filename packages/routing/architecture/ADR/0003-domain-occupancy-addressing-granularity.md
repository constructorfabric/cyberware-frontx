---
status: accepted
date: 2026-08-28
decision-makers: German Bartenev
---

# Domain Occupancy Addressing Granularity

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Key Composition Grammar](#key-composition-grammar)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [One uniform compound-key mechanism for every domain](#one-uniform-compound-key-mechanism-for-every-domain)
  - [Three separate mechanisms — axial pathname, single-entry parallel axis, bolted-on compound-key mode](#three-separate-mechanisms--axial-pathname-single-entry-parallel-axis-bolted-on-compound-key-mode)
  - [Pluggable URL codec over one internal model](#pluggable-url-codec-over-one-internal-model)
  - [Value-nested subtree encoding](#value-nested-subtree-encoding)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`

## Context and Problem Statement

The routing DESIGN's own addressing model, before this record, encodes three concerns through three separate, independently governed mechanisms: hierarchy, expressed by continuing the pathname — but only one domain per zone may do this, the "axial" one (§1.1, "Axes within a zone"); occupancy fan-out across sibling domains, expressed by a dedicated query-string key per domain, capped at one entry — a "parallel axis" (§1.1, same subsection; §3.1, Axis row); and per-occupant parameters, encoded two different ways depending on which of the first two mechanisms an occupant's domain uses — matrix-params-shaped bare query keys for an axial or single-occupant-parallel domain, nested percent-encoded values for a compound-keyed one (§3.1, Axis and Compound Key rows; §4, Worked Example: Concurrent Occupancy And Same-Entry Instances, mechanic 3). This trichotomy is why projecting more than one occupant of one domain had no room to exist without inventing a fourth, bolted-on mode — the compound-key mode §1.1 itself describes as "a new axis-composition mode alongside the existing single-entry parallel axis" — the real problem discovered in review of PR #585 (constructorfabric/gears-frontx) on this same package. Should hierarchy, occupancy fan-out, and per-occupant parameters continue to be governed by separate, independently specialized mechanisms — axial pathname continuation, a single-entry parallel-axis query key, and a bolted-on compound-key mode reserved for the multi-occupant case — or should all three be expressed as outputs of one uniform mechanism?

## Decision Drivers

* Closing the PR #585 gap at its root, not with another special case — the review that surfaced this problem flagged that the addressing model had no room for more than one occupant of one domain; adding a fourth mode alongside three existing ones treats the symptom, not the trichotomy that produced it.
* One encoding for every occupant's own parameters — matrix-params for an axial occupant and nested percent-encoded values for a compound-keyed one is two rules for the identical concern, and PR #585's second finding was a namespace collision this split already invites.
* No privileged domain per zone — "at most one axial domain per zone" (§1.1, "Axes within a zone") is a constraint with no principled basis beyond needing someone to own the pathname, and every mechanism built on top of it inherits that arbitrariness.
* Uniform resolution across depth and occupant count — the same per-level resolution primitive already runs identically beneath an axial base and beneath a parallel-axis value (§1.1, "Axes within a zone"); the addressing mechanism that produces those bases and values should not itself fork into three cases the resolution primitive underneath never needed.

## Considered Options

* **One uniform compound-key mechanism for every domain** — every domain in the tree, any depth, any occupant count, sibling or nested, is addressed by one construct: a breadth-first traversal of the domain tree produces exactly one compound query-string key (`{domain-path}::{occupant-identity}`) per occupant, in traversal order, with per-occupant parameters always nesting inside that key's own value as a percent-encoded string.
* **Three separate mechanisms — axial pathname, single-entry parallel axis, bolted-on compound-key mode** — the model this record retracts: hierarchy through pathname continuation for one privileged domain per zone, occupancy fan-out through a capped single-entry query key for every other domain, and a fourth, bolted-on compound-key mode admitted only once a domain's occupancy strategy holds several occupants at once.
* **Pluggable URL codec over one internal model** — the mechanism resolves to one internal occupancy model as decided below, but the query-string serialization itself is a consumer-selectable codec, with the flat compound-key grammar this record adopts shipped only as the default a consumer may swap for another.
* **Value-nested subtree encoding** — one query-string key per top-level domain, whose own value recursively encodes that domain's entire subtree — nested domains, their own occupants, and those occupants' own parameters — in a rison/URLON-shaped nested serialization, rather than one compound key per occupant at every depth.

## Decision Outcome

Chosen option: **one uniform compound-key mechanism for every domain**, because it is the only option that closes the PR #585 gap by construction rather than by addition. Under this mechanism, a domain with one occupant and a domain with several are not two cases requiring two rules — a domain with N occupants simply contributes N compound keys sharing its domain-path prefix, with zero special-casing between "one occupant" and "several." Hierarchy is expressed by traversal order and domain-path naming alone, never by pathname segment nesting, so no domain needs to be "the axial one" for a zone to nest correctly — the "at most one axial domain per zone" constraint is retired along with the "axial domain" and "parallel axis" vocabulary it depended on, because there is no longer a privileged domain per zone. Every occupant's own parameters nest inside its own compound key's value as a percent-encoded string, uniformly — never matrix-params, never a different encoding chosen by which mechanism the occupant's domain happened to use — which closes PR #585's namespace-collision finding for every domain, not only the ones that already used compound keys. The pathname is retired from this library's domain-occupancy resolution model entirely: it becomes purely an application-level concern this library does not read or write for occupancy purposes. An application remains free to put something cosmetic in the pathname, but this package's own resolution primitive no longer treats any pathname segment as a declared prefix. Two further options — letting the query-string serialization itself be a consumer-swappable codec, and nesting each domain's own subtree inside a single recursively-encoded root key — were also considered and rejected without reopening this decision; both are recorded in Pros and Cons of the Options below, alongside the original two-option comparison this record's decision rests on.

### Key Composition Grammar

A compound key is composed from two distinct delimiters, not one: a path delimiter (`.`) that joins path segments together, and a boundary delimiter (`::`) that marks the single, fixed transition between a key's own domain-path portion and its own occupant-identity portion — appearing exactly once in every compound key, never zero times and never twice. A domain's own domain-path is the enclosing occupant's own full address path — that occupant's own domain-path, joined by the path delimiter to that occupant's own occupant-identity, joined again by the path delimiter to the nested domain's own locally-chosen name — never merely the enclosing occupant's own bare occupant-identity restated one level down, which is the shortened form the model this record retracts actually produced. A root-level domain's own domain-path is simply its own locally-chosen name, with no ancestor to compose from. The full compound key for one occupant is `{domain-path}::{occupant-identity}`.

This grammar makes every compound key in the tree unique from three purely local facts, none of which requires a global registry: (1) sibling domain-name uniqueness within one zone, already each zone's own consumer's own responsibility; (2) occupant-identity uniqueness within a domain across distinct registrations, guaranteed by the existing registration-time same-declared-prefix conflict check — including between two mounts of the identical microfrontend entry, since each mount is its own distinct registration with its own independently declared prefix, never one registration shared between them (DESIGN §2.3, O3b); and (3) root-zone domain-name uniqueness, the host's own single choice at the tree's root. By induction on tree depth: a root domain's own domain-path is unique by fact (3); a nested domain's own domain-path is composed from its enclosing occupant's own domain-path (unique by the inductive hypothesis), that occupant's own occupant-identity (unique within its own domain by fact (2)), and its own locally-chosen name (unique among its own siblings by fact (1)) — so two nested domains can share an identical domain-path only if every one of those three already-guaranteed-distinct components collides simultaneously, which the three facts jointly rule out, including across two domains that happen to reuse an identical locally-chosen name under two different parents. Combined with occupant-identity uniqueness within a domain (fact 2 again, at the final segment), the pair — and therefore the composed key — is unique across the whole tree.

The same two-delimiter grammar eliminates prefix shadowing structurally, not by convention. A level resolves its own keys by requiring a candidate key to begin with exactly its own domain-path immediately followed by the boundary delimiter — never by matching an arbitrary leading substring ending in the path delimiter. Because a descendant domain's own domain-path is always its ancestor's domain-path extended by at least one further path-delimiter-joined segment, the character immediately following any ancestor's own domain-path inside a descendant's key is always the path delimiter, never the boundary delimiter; an ancestor's own boundary-anchored match therefore always fails against a descendant's key, by construction, with no runtime tree lookup needed to rule it out. The single-delimiter grammar this record retracts had no equivalent guarantee: a shallower domain's own key-matching prefix could ambiguously capture a deeper domain's own key, because the one delimiter served both the path-joining and the domain-path/occupant-identity-boundary role at once.

Illustrative, using the same domain and occupant names DESIGN §4's own worked examples already use: the console-layout example's screen domain, at the root, has domain-path `screen`; its winning occupant, the Tenants screen (declared prefix `tenants`), composes the key `screen::tenants`. The tabs domain nested inside that occupant's own zone has domain-path `screen.tenants.tabs` — composed from `screen`'s own domain-path, the Tenants screen's own occupant-identity `tenants`, and the tabs domain's own locally-chosen name `tabs`, each joined by the path delimiter — not `tenants.tabs`, the shortened form the retracted model produced; its own Contacts occupant composes the key `screen.tenants.tabs::contacts`. A third level nested inside that occupant's own zone, named e.g. `panel`, would in turn compose domain-path `screen.tenants.tabs.contacts.panel` and, for an occupant declaring prefix `detail`, the key `screen.tenants.tabs.contacts.panel::detail` — three levels deep, still exactly one boundary delimiter per key, still unambiguous against every shallower level's own domain-path-plus-boundary match.

### Consequences

* Good, because multi-occupancy is no longer a special case — it is just "more than one compound key under the same domain-key prefix," already naturally supported by the one mechanism, closing the PR #585 gap without a bolt-on.
* Good, because per-occupant parameters use one encoding everywhere, closing the namespace-collision gap PR #585 also flagged, uniformly rather than only for the compound-keyed case.
* Good, because there is no longer an arbitrary "at most one axial domain per zone" constraint, and no domain needs to be selected as a zone's privileged one.
* Bad, and stated plainly rather than hidden: this loses pretty, human-readable pathname URLs. `/tenants/ABC/contacts?m=create-contact` — the existing pre-this-redesign worked example's URL (DESIGN §4, Worked Example: A Console Layout And Its URL) — becomes something like `?screen::tenants=tenantId%3DABC&screen.tenants.tabs::contacts=&modal::create-contact=`: a flat, less legible, less SEO-friendly address. This is a genuine trade-off, not a free win. DESIGN §4 re-expresses both its existing worked examples (the console-layout one and the concurrent-occupancy one) under this new model, in the same staged changeset as this record.
* Bad, because every existing or future consumer of this package that relied on pathname-based routes — for bookmarking habits, or for an external link assuming a path shape — needs to migrate; this is a breaking change to the URL shape this package produces, not merely an additive one.

### Confirmation

Confirmed by a design/code review of whatever implements this mechanism: no code path in the routing core's resolution primitive treats a pathname segment as a declared prefix; every domain in a composed tree, regardless of occupant count or tree position, resolves and back-projects through the identical breadth-first compound-key construct, composing its own domain-path from its enclosing occupant's own full address path rather than from a shortened, ancestry-dropping form; and no code path branches on "is this domain the axial one" or "does this domain have one occupant or several." The two worked examples DESIGN §4 already re-expresses under this mechanism are the acceptance scenarios this confirmation is checked against, the same role the existing worked examples already play for the model this record retracts; both express their own key strings under the two-delimiter grammar this record's own amendment adopts (§ Key Composition Grammar), so the confirmation above is checked against those key strings as they stand.

## Pros and Cons of the Options

### One uniform compound-key mechanism for every domain

Every domain in the tree — any depth, any occupant count — contributes one compound query-string key per occupant, composed breadth-first; every occupant's own parameters nest inside its own key's value, uniformly; the pathname carries nothing this library reads or writes for occupancy.

* Good, because multi-occupancy requires no special case beyond "more compound keys under the same prefix."
* Good, because per-occupant parameters have exactly one encoding, everywhere, closing a namespace-collision class of bug rather than only its compound-keyed instance.
* Good, because no domain needs to be selected as a zone's privileged, pathname-continuing one.
* Neutral, because it requires DESIGN's own worked examples to be re-expressed under the new addressing shape before implementation can be checked against them.
* Bad, because it gives up human-readable, SEO-friendly pathname URLs for every domain, not only the ones that previously used compound keys.
* Bad, because it is a breaking change to the URL shape for any existing pathname-based consumer.

### Three separate mechanisms — axial pathname, single-entry parallel axis, bolted-on compound-key mode

Hierarchy through pathname continuation for one axial domain per zone; occupancy fan-out through a capped single-entry query key for every other domain; a fourth, bolted-on compound-key mode admitted only for a domain whose occupancy strategy holds several occupants at once.

* Good, because it keeps human-readable pathname URLs for the one axial domain per zone.
* Good, because it requires no migration for whatever already relies on the axial pathname shape.
* Neutral, because the single-entry parallel axis and the compound-key mode were already, before this record, two different rules a maintainer had to know when to apply.
* Bad, because it requires a different rule for every combination of "is this domain the axial one" and "does this domain have one occupant or several," which is exactly the gap that motivated this redesign: no room for more than one occupant without inventing a fourth mode.
* Bad, because "at most one axial domain per zone" has no principled basis beyond needing someone to own the pathname.
* Bad, because per-occupant parameters carry two different encodings — matrix-params for an axial occupant, nested percent-encoded values for a compound-keyed one — leaving the namespace-collision finding PR #585 raised closed only for the compound-keyed case, not for the axial one.

### Pluggable URL codec over one internal model

One internal occupancy model, exactly as this record already decides, but the query-string serialization a consumer's own URL actually carries is a swappable codec per deployment, with the flat two-delimiter compound-key grammar shipped only as the default a consumer may replace with another.

* Good, because a consumer with an unusual legibility or length constraint could, in principle, supply its own encoding without this package's own internal occupancy model changing underneath it.
* Bad, because an addressing scheme that varies per deployment is not actually a shared addressing scheme: two consumers running two different codecs cannot read each other's URLs, defeating the point of the uniform mechanism this record adopts.
* Bad, because it is premature abstraction for a single known encoding with no second implementation ever named or requested — this record collapses three mechanisms into one, not one mechanism into an open-ended set a consumer configures.
* Bad, because it multiplies the Confirmation surface above by however many codecs a consumer could plug in, with no bound on that number and no second, real encoding to confirm against.

### Value-nested subtree encoding

One query-string key per top-level domain, whose own value recursively encodes that domain's entire subtree — nested domains, their own occupants, and those occupants' own parameters — in a rison/URLON-shaped nested serialization, rather than one compound key per occupant at every depth.

* Good, because the query string carries fewer top-level keys: one per top-level domain rather than one per occupant at every depth.
* Bad, because it breaks per-slot independence: mutating any subtree requires a read-modify-write of the whole root key, forcing every level to parse, preserve, and rewrite ancestors' and siblings' own subtrees it does not own — directly contradicting the URL back-projection helper's own per-slot-only replace guarantee, which always targets exactly one compound key and touches no sibling or ancestor key (DESIGN §3.3, URL back-projection helper).
* Bad, because a level several steps deep can no longer resolve independently against its own domain key and its own declared pairs alone; it depends on every ancestor's own root key already having been parsed correctly, reintroducing the whole-URL coupling the uniform compound-key mechanism was adopted to avoid.
* Bad, because a rison/URLON-shaped value is materially less legible in the address bar than a flat, if longer, compound-key string — trading one already-accepted readability loss (§ Consequences) for a second, different one, without recovering the first.

## More Information

Diagram note: this record's own mechanism-count decision is a single binary comparison — one uniform mechanism against the one rejected alternative of three separate mechanisms — matching the shape this repository's own root ADRs already use for a decision of this kind (`cpt-frontx-adr-core-package-boundaries`, `cpt-frontx-adr-extension-domain-occupancy`), both recorded in prose and comparison lists with no diagram. The two further options considered for that one mechanism's own key grammar — a pluggable codec, and value-nested subtree encoding — are comparisons within the chosen mechanism, not against it, and are likewise recorded in prose and comparison lists above with no diagram. No diagram is included here for either comparison, for the same reason.

**Retraction.** This record retracts and replaces the addressing model in `packages/routing/architecture/DESIGN.md` §1.1 ("Axes within a zone"), §3.1 (Domain Model — the Axis, Carrier, and Base rows, and the compound-key description of the Compound Key row), and §4 (both worked examples), wherever those sections describe hierarchy as pathname continuation reserved to one axial domain per zone, occupancy fan-out as a single-entry parallel-axis query key, or per-occupant parameters as two different encodings depending on which of those two mechanisms a domain used. It is not an addition alongside that model; the compound-key mode that DESIGN's own retracted text called "a new axis-composition mode alongside the existing single-entry parallel axis" is superseded, not supplemented, by the uniform mechanism this record adopts for every domain. DESIGN itself has been updated, in the same staged changeset as this record, to reflect this decision, including re-expressing both existing worked examples under the new addressing shape and conforming their own key strings to the two-delimiter grammar this record's own amendment adopts (§ Key Composition Grammar).

**Scope of impact.** This decision governs the addressing and composition mechanism a domain's occupancy projects into the URL — how many query-string keys a domain contributes, how those keys are named and ordered, and how an occupant's own parameters are encoded within its key. It does not decide occupant identity value source (already decided, the framework package's own `cpt-frontx-framework-adr-occupant-identity-stability`), whether the routing core imports `mfes` (already decided, this package's own `cpt-frontx-routing-adr-occupant-reference-boundary`), or the mount-trigger channel (already decided, this package's own `cpt-frontx-routing-adr-mount-trigger-ownership`). All three are cross-referenced here as still-standing, orthogonal decisions this record does not revisit.

**Review trigger.** Revisit if a requirement emerges for a human-readable, bookmarkable pathname URL that this uniform mechanism cannot express without reintroducing a privileged, pathname-continuing domain per zone.

**Checklist applicability.**

* ARCH — applicable and addressed above (an architecturally significant, hard-to-reverse addressing decision affecting every consumer that reads or constructs this package's own URLs).
* SEC — Not applicable because this decision introduces no secret, credential, or authorization concern; it only shapes how occupancy is encoded in the URL.
* PERF — Not applicable because a breadth-first traversal producing one compound key per occupant carries no different runtime cost, at this package's own operating volumes, than the three-mechanism model it replaces.
* REL — Not applicable because it governs an addressing/encoding scheme, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — applicable: this decision fixes the URL shape this package produces and expects, which every consumer that bookmarks, links to, or parses this package's own URLs must conform to; the breaking-change consequence above is the integration impact.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.
* MAINT — applicable: collapsing three mechanisms into one bounds the number of addressing rules a maintainer must hold in mind to one, at the acknowledged cost of losing readable pathname URLs.

## Traceability

- **PRD**: [../PRD.md](../PRD.md)
- **DESIGN**: [../DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-routing-fr-concurrent-occupant-projection` — the uniform compound-key mechanism this record adopts is what lets a multi-occupant domain project every occupant without a mode bolted on alongside a separate single-occupant mechanism.
* `cpt-frontx-routing-fr-per-occupant-addressable-parameters` — every occupant's own parameters now nest inside its own compound key's value through one encoding, regardless of occupant count or tree position, closing the namespace-collision gap for every domain rather than only the previously compound-keyed ones.
* `cpt-frontx-adr-extension-domain-occupancy` — that record still decides occupancy cardinality itself (which strategy a domain runs); this record decides only how whatever cardinality that strategy admits is addressed in the URL. That record's own prior deferral of concurrent-domain projection is lifted by its own amendment, which credits this record's own uniform mechanism as what now supplies a projection mechanism for every domain that record governs, of any occupant count, with no privileged domain per zone and no single-entry cap; this record owns the mechanism's own shape, and that record's own role is only to record that its deferral no longer holds.
* `cpt-frontx-routing-adr-occupant-reference-boundary` — cross-referenced as a still-standing, orthogonal decision this record does not revisit: occupant identity continues to resolve through the same opaque Occupant port, unaffected by how that identity's own compound key is composed.
* `cpt-frontx-routing-adr-mount-trigger-ownership` — cross-referenced as a still-standing, orthogonal decision this record does not revisit: which channel drives a post-boot mount is unchanged; only how the URL back-projection helper's target slot is composed changes.
