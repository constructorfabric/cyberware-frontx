---
status: accepted
date: 2026-09-09
decision-makers: German Bartenev, G S
---

# Domain Occupancy Addressing Granularity

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [URL Grammar](#url-grammar)
  - [Occupant Identity Lexical Rule](#occupant-identity-lexical-rule)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [One uniform entry grammar for every domain](#one-uniform-entry-grammar-for-every-domain)
  - [Three separate mechanisms — axial pathname, single-entry parallel axis, bolted-on compound-key mode](#three-separate-mechanisms--axial-pathname-single-entry-parallel-axis-bolted-on-compound-key-mode)
  - [Compound key with a double-colon boundary delimiter and percent-encoded nested parameters](#compound-key-with-a-double-colon-boundary-delimiter-and-percent-encoded-nested-parameters)
  - [Pluggable URL codec over one internal model](#pluggable-url-codec-over-one-internal-model)
  - [Value-nested subtree encoding](#value-nested-subtree-encoding)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`

## Context and Problem Statement

The routing DESIGN's own addressing model, before this record, encodes three concerns through three separate, independently governed mechanisms: hierarchy, expressed by continuing the pathname — but only one domain per zone may do this, the "axial" one (§1.1, "Axes within a zone"); occupancy fan-out across sibling domains, expressed by a dedicated query-string key per domain, capped at one entry — a "parallel axis" (§1.1, same subsection; §3.1, Axis row); and per-occupant parameters, encoded two different ways depending on which of the first two mechanisms an occupant's domain uses — matrix-params-shaped bare query keys for an axial or single-occupant-parallel domain, nested percent-encoded values for a compound-keyed one (§3.1, Axis and Compound Key rows; §4, Worked Example: Concurrent Occupancy And Same-Entry Instances, mechanic 3). This trichotomy is why projecting more than one occupant of one domain had no room to exist without inventing a fourth, bolted-on mode — the compound-key mode §1.1 itself describes as "a new axis-composition mode alongside the existing single-entry parallel axis" — the real problem discovered in review of PR #585 (constructorfabric/gears-frontx) on this same package. Should hierarchy, occupancy fan-out, and per-occupant parameters continue to be governed by separate, independently specialized mechanisms — axial pathname continuation, a single-entry parallel-axis query key, and a bolted-on compound-key mode reserved for the multi-occupant case — or should all three be expressed as outputs of one uniform entry grammar?

## Decision Drivers

* Closing the PR #585 gap at its root, not with another special case — the review that surfaced this problem flagged that the addressing model had no room for more than one occupant of one domain; adding a fourth mode alongside three existing ones treats the symptom, not the trichotomy that produced it.
* One encoding for every occupant's own parameters — matrix-params for an axial occupant and nested percent-encoded values for a compound-keyed one is two rules for the identical concern, and PR #585's second finding was a namespace collision this split already invites.
* No privileged domain per zone — "at most one axial domain per zone" (§1.1, "Axes within a zone") is a constraint with no principled basis beyond needing someone to own the pathname, and every mechanism built on top of it inherits that arbitrariness.
* Uniform resolution across depth and occupant count — the same per-domain resolution primitive already runs identically beneath an axial base and beneath a parallel-axis value (§1.1, "Axes within a zone"); the addressing mechanism that produces those bases and values should not itself fork into three cases the resolution primitive underneath never needed.
* Legibility and shell ownership of the pathname — a grammar that reserves the pathname for the host and expresses every domain's occupancy in the query string returns the pathname to the shell as its own private territory, and keeps every parameter's value readable in place rather than nested inside a second layer of encoding.

## Considered Options

* **One uniform entry grammar for every domain** — every domain in the tree, any depth, any occupant count, sibling or nested, is addressed by one construct: the query string carries one entry per occupant — `domain-key=extension;param;param=value;...` — with a bare root domain name for a domain at the tree's root, a composite `parent-key.parent-extension.name` domain key only for a domain nested inside an extension's own zone, and a repeated domain key expressing multiplicity; the pathname carries no occupancy information at all and is reserved for the shell.
* **Three separate mechanisms — axial pathname, single-entry parallel axis, bolted-on compound-key mode** — the model this record retracts: hierarchy through pathname continuation for one privileged domain per zone, occupancy fan-out through a capped single-entry query key for every other domain, and a fourth, bolted-on compound-key mode admitted only once a domain's occupancy strategy holds several occupants at once.
* **Compound key with a double-colon boundary delimiter and percent-encoded nested parameters** — every occupant is addressed by a single query-string key composed of a dotted domain-path, a fixed double-colon boundary delimiter, and an occupant-identity segment, with that occupant's own parameters percent-encoded into the key's own value as a nested string.
* **Pluggable URL codec over one internal model** — the mechanism resolves to one internal occupancy model as decided below, but the query-string serialization itself is a consumer-selectable codec, with the flat entry grammar this record adopts shipped only as the default a consumer may swap for another.
* **Value-nested subtree encoding** — one query-string key per top-level domain, whose own value recursively encodes that domain's entire subtree — nested domains, their own occupants, and those occupants' own parameters — in a rison/URLON-shaped nested serialization, rather than one entry per occupant at every depth.

## Decision Outcome

Chosen option: **one uniform entry grammar for every domain**, because it is the only option that closes the PR #585 gap by construction rather than by addition, while returning the pathname to the shell and giving every occupant's own parameters one readable encoding. Under this mechanism, a domain with one occupant and a domain with several are not two cases requiring two rules — a domain with N occupants simply contributes N entries sharing its own domain key, with zero special-casing between "one occupant" and "several." Hierarchy is expressed by domain-key naming alone, never by pathname segment nesting, so no domain needs to be privileged for a zone to nest correctly — the "at most one privileged domain per zone" constraint, and the vocabulary the Context section above names it by, are retired, because there is no longer a privileged domain per zone and no longer a domain that lives in the pathname at all. Every occupant's own parameters live inside its own entry as matrix-style `;key=value` pairs, uniformly — never a second, nested encoding chosen by which mechanism the occupant's domain happened to use — which closes PR #585's namespace-collision finding for every domain, not only the ones that were previously compound-keyed. The pathname is retired from this library's domain-occupancy resolution model entirely: it becomes the shell's own private subroute, never read or written by this package for occupancy purposes. An application remains free to put something cosmetic or shell-owned in the pathname, but this package's own resolution primitive no longer treats any pathname segment as a declared prefix.

### URL Grammar

A composed application's URL has the shape:

```
<shell-subroute> ? <entry> [ & <entry> ]* [ # <hash> ]
```

The shell subroute — everything between the first `/` and `?` — is owned entirely by the shell (the host application); this package never interprets it and copies it verbatim on every write. The hash is likewise the application's own, copied verbatim and never interpreted. The query string is where this package reads and writes structure; occupants supply the payload values inside it.

**Tokens.**

```
name        = lower ( lower | digit | "-" )*         ; lower = a-z, digit = 0-9
domain-key  = name | domain-key "." extension "." name
extension   = name
param-name  = 1*( pchar-safe | pct-encoded )
param-value = *( pchar-safe | pct-encoded )
```

`pchar-safe` denotes letters, digits, and `- _ . ~ / : @ , ! ' ( ) * ?` — the same set the percent-encoding table below leaves unescaped.

`name` is deliberately narrow: no `.`, no `/`, no `;`, no `=`, no `&`, no `#`, no upper case, no percent-escapes. Comparison is character-by-character. The same alphabet applies to a root domain's own name, to a nested domain's own locally-chosen name, and to an extension token.

Source of each token: a root domain's own name is chosen by the host for each domain it projects; an extension token is the extension registration's own `presentation.route`, normalized by stripping one leading `/` — a registration whose normalized route is not a valid `name`, or that carries no route at all, is not routable and is never projected, unique among the registrations of one domain and checked at registration time by the consumer with this package's own name-equality predicate; a nested domain's own key is composed by this package from three parts the mounting level supplies — the enclosing entry's own domain key, the enclosing entry's own extension, and the nested domain's own locally-chosen name — for example `screen` + `dashboard` + `tabs` composes `screen.dashboard.tabs`. Composition validates all three of its inputs, not only the locally-chosen name: the enclosing domain key must itself already conform to the `domain-key` production (odd segment count, every segment a valid `name`), the enclosing extension must satisfy the `name` alphabet, and the locally-chosen name must as well — composition throws naming whichever of the three failed, rather than silently producing an ill-formed key from a malformed ancestor.

Uniqueness of every domain key in the tree follows from three local facts, none needing a global registry: sibling domain names are distinct within one zone; extension tokens are distinct within one domain; root names are one host's own single choice. By induction on tree depth, a root domain key is unique by the third fact alone, and a nested domain key is unique because it is composed from an already-unique parent domain key, an extension token unique within that parent domain, and a locally-chosen name unique among its own siblings — so two nested domain keys can coincide only if all three already-distinct components coincide at once, which the three facts jointly rule out.

**Entry.**

```
entry   = domain-key "=" extension *( ";" param )
param   = param-name [ "=" param-value ]
```

`domain-key "=" extension` and every `;` are written by this package from the fact of occupancy; parameter names and values are the occupant's own, encoded but never interpreted by this package. A bare `param-name` with no `=` equals an empty value — `sheet=tenant-details` is a complete entry with no parameters and no trailing `;`. A `param-name=` written with an explicit, empty value parses to that identical empty value; the two forms are indistinguishable once parsed, and the serializer always re-emits the canonical bare form — a parse→serialize round-trip is therefore byte-exact only for input that already used the canonical bare form for every empty value, not for input using the explicit `k=` form; this package's own FEATUREs do not claim "own inverse" unqualified for this reason. Parameter names are unique within one entry: serializing a duplicate is an error; parsing one keeps the first occurrence's own position but overwrites it with the last occurrence's own value, and reports a warning. Parameter order is preserved exactly as written. The same extension token twice under one domain key is a different collision, resolved oppositely: parsing keeps the first occurrence and reports a warning, because entries are an ordered list whose own order carries meaning to the domain that reads it, where parameters are a map a later value simply overwrites.

Percent-encoding inside `param-name` and `param-value`, applied by this package: the grammar delimiters `;`, `=`, and `&` are encoded as `%3B`, `%3D`, and `%26`; `#` (which would end the query) is encoded as `%23`; the escape character `%` itself is encoded as `%25`; `+` and space are encoded as `%2B` and `%20`, because `+` is ambiguous under form-encoding; any non-ASCII character is UTF-8-encoded and percent-escaped per RFC 3986. Everything else — letters, digits, and `- _ . ~ / : @ , ! ' ( ) * ?` — stays raw, so a value like `route=settings/general` reads as written. Any character not in that `pchar-safe` set and not otherwise listed above — `" < > [ ] { } | \ ^ $`, a backtick, or a control character — is percent-encoded on write, RFC 3986 style, exactly as the listed characters are. Decoding is applied once, on read; every valid percent-escape decodes, whether or not the character it decodes to is one this package itself would have escaped. a run of consecutive `%XX` escapes is assembled as a run of raw bytes and decoded together as UTF-8, so a multi-byte character split across consecutive escapes decodes as the single character it encodes. A raw `+` read from a URL is the literal character `+`; this grammar performs no form-style decoding of it, and the serializer itself never writes a raw `+` or a raw space. A malformed percent-escape (`%zz`, or a trailing `%` with fewer than two hex digits following it) or a run of escapes that does not assemble into valid UTF-8 makes the whole entry it appears in malformed, dropped with a warning exactly like any other malformed entry below — never a per-parameter failure. `URLSearchParams` is not usable for this grammar: it encodes `;` and `=` itself.

**Repetition and order.** A domain with N occupants contributes N entries sharing the same domain key, one per occupant — this is the only way multiplicity is expressed; one occupant is N = 1, not a different rule. Within one domain, an entry's own identity is its (domain key, position) pair, and every write to that domain's entries is expressed as one of five operations: `added` (a new entry, appended at the end of the full list); `removed` (an entry taken out, leaving no gap); `payload-changed` (an entry's own parameter list rewritten in place, at the position it already occupies); `replaced` (a new extension token taking the same position an old one occupied, triggering structural reset of the `<key>.<oldToken>.` subtree in the same history write as the replacement itself); and `reordered` (this domain's own entries taking a caller-given new order within the slots they already occupy, no other domain's entries touched, and no structural reset). Entry order is otherwise preserved on read and on write; this package assigns no meaning to the order itself. Entries of different domains may interleave; this package never regroups them. An entry with no `=` between its own candidate domain key and extension, a token outside the `name` alphabet, or a domain key with an even number of segments is dropped from the parsed result and reported to the host as a warning; every other entry in the same query string is kept, and parsing never throws. An empty raw entry — produced by two consecutive `&` characters (`a=b&&c=d`) or a trailing `&` — is silently ignored and dropped with no warning, unlike every other malformed case above. With zero entries across every domain, the serializer emits the shell subroute alone, with no trailing `?`; a query string that is present but empty (`/en?`) parses to that same zero-entry state and re-serializes identically to the bare shell subroute.

**Control boundary.** This package writes `/`, `?`, `&`, every `domain-key=extension;` prefix, and every `;`. An occupant writes only its own parameter names and values, through this package's own API, never by touching the raw URL directly. The shell writes only its own subroute and, if it wishes, its own entries under domains it owns. No party reads or edits another party's own part of the raw string.

**Structural reset.** Removing or changing an entry also removes every entry whose own domain key begins with that entry's domain key extended by that entry's own extension and a further path segment — a nested domain cannot outlive the extension whose zone contains it, and the prefix says which nested entries those are; this happens in the same history write as the parent's own change, whether that write is a `push` or a `replace` — the verb is the caller's own choice (§1.4/§3 of this package's own FEATUREs), never fixed by this reset rule itself. The reset triggers only when an entry is removed or its own extension token changes; a change confined to the entry's own parameters — `screen=dashboard;orientation=left` to `screen=dashboard;orientation=right` — leaves every entry under that domain key's own prefix untouched. An entry whose domain key has no live observer is inert, not an error and not removed. An entry whose extension token matches no registration in a live domain is reported to that domain's own observer as unresolved and left in place; removing it is a host policy, never a package action.

**Hash.** The hash is copied verbatim on every read and every write, regardless of how many entries the query string carries — `/en#x` is a valid URL under this grammar. The virtual location an engine-provider port hands a mounted occupant carries no hash of its own — it is a `{pathname, search}` pair — because the page's own hash stays the application's, unaffected by which occupant is currently mounted at any entry.

### Occupant Identity Lexical Rule

`cpt-frontx-routing-adr-occupant-reference-boundary` makes an occupant's own identity the extension token of a URL entry, so the routing core can no longer describe that identity as purely opaque: the routing core still never interprets what the identity *names* — that remains the glue layer's own concern — but the identity value must be lexically valid to serve as the extension token of an entry this package itself composes and parses. The accurate description is **uninterpreted but well-formed**, not opaque, and this record states the well-formedness rule normatively by pointing to the grammar's own `name` alphabet, the same alphabet the grammar gives every domain and extension token:

* Non-empty: an occupant identity is never the empty string.
* Composed of one or more characters drawn from `a`–`z`, `0`–`9`, and `-`, lower case only, with no `.` and no other separator — a single flat token, never a segmented one — and beginning with a letter (`a`–`z`), never a digit or `-`, exactly as the grammar's own `name` production requires above (`name = lower ( lower | digit | "-" )*`).
* Unique within its own domain — already guaranteed by the existing registration-time same-extension-token conflict check (`packages/routing/architecture/PRD.md` §11), not re-decided here.

The parameter bag remains opaque in the sense `cpt-frontx-routing-adr-occupant-reference-boundary` already gives it: the routing core carries it without reading any field inside it. Only the identity value's own lexical shape — never its meaning — is now a rule this record states and can check.

This package **MUST** run a validator for this lexical rule automatically, synchronously, inside every place this package's own code actually receives a consumer-supplied identity token as an argument: observer creation, where the declared registered-extensions source the consumer supplies carries each owner's own identity; the registered-extensions source's own change notification, when the source exposes one, validating the newly-current set of tokens before re-running resolution against it; the URL back-projection helper, where each delta names an entry carrying an extension token; and the domain-key-composition function's own extension-token input, the enclosing entry's own extension being one of the three parts a nested domain's own key is composed from. A malformed token at any of these input paths **MUST** be rejected synchronously with a clear error at that point — not merely documented as something the glue layer should have checked before calling in.

This validation runs on these input paths and nowhere else — **NEVER** on a value parsed out of the URL during resolution. A stale or malformed identity token encountered while resolving an existing URL — a bookmark created before this rule existed, or before a stricter character set was adopted — **MUST** resolve to "unresolved": this is not a gap the validator leaves open, but the same fully specified, already-handled outcome this package's own DESIGN already gives to any entry whose own extension token matches no registration ("An entry whose extension token matches no registration in a live domain is reported to that domain's own observer as unresolved and left in place," `packages/routing/architecture/DESIGN.md` §1.1) — never a thrown error. This is a deliberate, permanent non-extension of the validator's scope, not an oversight: a future implementer who "helpfully" adds a throw on the parse path would turn every previously-valid bookmarked URL into a crash the instant this rule tightens, which is exactly the failure this scope boundary exists to prevent.

This package also still publishes the same validator function, alongside its existing name-equality predicate, so the glue layer can check an identity proactively before ever calling into observer creation or the back-projection helper — but that publication is now a convenience for early feedback, not the extent of the enforcement itself; see `cpt-frontx-routing-adr-occupant-reference-boundary`'s own Consequences for what this package does, and does not, enforce as a result.

### Consequences

* Good, because multi-occupancy is no longer a special case — it is just "more than one entry under the same domain key," already naturally supported by the one grammar, closing the PR #585 gap without a bolt-on.
* Good, because per-occupant parameters use one encoding everywhere, closing the namespace-collision gap PR #585 also flagged, uniformly rather than only for the previously compound-keyed case.
* Good, because there is no longer an arbitrary "at most one privileged domain per zone" constraint, and no domain needs to be selected as a zone's privileged one.
* Good, because parameter readability is largely restored: a matrix-style `;key=value` pair reads in place in the address bar, rather than nested inside a second, percent-encoded layer, and the pathname is returned to the shell as its own private territory rather than being contested ground between the shell and this package.
* Bad, because bookmarks and links created under the retracted model, or a stale entry whose observer no longer exists, may carry inert entries the URL does not clean up on its own — there is no reset point for an inert entry other than the structural-reset prefix rule above.
* Bad, because every existing or future consumer of this package that relied on pathname-based routes — for bookmarking habits, or for an external link assuming a path shape — needs to migrate; this is a breaking change to the URL shape this package produces, not merely an additive one. DESIGN §4 re-expresses its worked examples under this new model, in the same staged changeset as this record.

### Confirmation

Confirmed by a design/code review of whatever implements this mechanism: no code path in the routing core's resolution primitive treats a pathname segment as a declared prefix; every domain in a composed tree, regardless of occupant count or tree position, resolves and back-projects through the identical entry grammar, composing a nested domain's own key from its enclosing entry's own domain key, that entry's own extension, and its own locally-chosen name; and no code path branches on "is this domain privileged" or "does this domain have one occupant or several." The acceptance scenarios this confirmation is checked against are examples 7.1, 7.2, and 7.7 of the grammar this record adopts:

**7.1 Reference link (the model task).** Screen `dashboard` with its own parameter; two sheets of one domain, one of them with two parameters; three widgets of one domain, two of them instances of the same entry.

```
/en?screen=dashboard;orientation=left
   &sheet=tenant-details;tenantId=456
   &sheet=user-contacts;contactId=123;view=active
   &widgets=line-a;range=7d
   &widgets=line-b;range=30d
   &widgets=pie;metric=revenue
```

Written on one line, this is exactly the URL in the address bar; the line breaks are typographic.

**7.2 The console example, re-expressed.** Tenants screen showing tenant `ABC`, its own `tabs` domain on the Contacts tab, a create-contact modal in the console's root `modal` domain.

```
/en?screen=tenants;tenantId=ABC
   &screen.tenants.tabs=contacts
   &modal=create-contact
```

`screen.tenants.tabs` is composite because the tabs domain lives inside the `tenants` extension's zone. `modal` is bare because the console declared it at the root.

**7.7 Structural reset.** From 7.2, the shell switches the screen to `settings`:

```
before: /en?screen=tenants;tenantId=ABC&screen.tenants.tabs=contacts&modal=create-contact
after:  /en?screen=settings&modal=create-contact
```

`screen.tenants.tabs` went with its parent; `modal` stayed, because it is the root's. This is a `replaced` write — the `screen` entry's own extension token changes from `tenants` to `settings` at the same position, triggering the structural reset of the `screen.tenants.` subtree in the same history write — projected with `push`, so the back button returns to the before-state.

## Pros and Cons of the Options

### One uniform entry grammar for every domain

Every domain in the tree — any depth, any occupant count — contributes one query-string entry per occupant, keyed by its own domain key and carrying its extension and parameters; the pathname carries nothing this library reads or writes for occupancy.

* Good, because multi-occupancy requires no special case beyond "more entries under the same domain key."
* Good, because per-occupant parameters have exactly one encoding, everywhere, closing a namespace-collision class of bug rather than only its previously compound-keyed instance.
* Good, because no domain needs to be selected as a zone's privileged, pathname-continuing one, and the pathname itself is freed for the shell.
* Neutral, because it requires DESIGN's own worked examples to be re-expressed under the new addressing shape before implementation can be checked against them.
* Bad, because a bookmark created under an earlier model, or an entry whose domain no longer exists, has no reset point beyond the structural-reset prefix rule.
* Bad, because it is a breaking change to the URL shape for any existing pathname-based consumer.

### Three separate mechanisms — axial pathname, single-entry parallel axis, bolted-on compound-key mode

Hierarchy through pathname continuation for one axial domain per zone; occupancy fan-out through a capped single-entry query key for every other domain; a fourth, bolted-on compound-key mode admitted only for a domain whose occupancy strategy holds several occupants at once.

* Good, because it keeps human-readable pathname URLs for the one axial domain per zone.
* Good, because it requires no migration for whatever already relies on the axial pathname shape.
* Neutral, because the single-entry parallel axis and the compound-key mode were already, before this record, two different rules a maintainer had to know when to apply.
* Bad, because it requires a different rule for every combination of "is this domain the axial one" and "does this domain have one occupant or several," which is exactly the gap that motivated this redesign: no room for more than one occupant without inventing a fourth mode.
* Bad, because "at most one axial domain per zone" has no principled basis beyond needing someone to own the pathname.
* Bad, because per-occupant parameters carry two different encodings, leaving the namespace-collision finding PR #585 raised closed only for the previously compound-keyed case, not for the axial one.

### Compound key with a double-colon boundary delimiter and percent-encoded nested parameters

Every occupant is addressed by a single query-string key composed of a dotted domain-path, a fixed double-colon boundary delimiter, and an occupant-identity segment; that occupant's own parameters are percent-encoded into the key's own value as a nested string.

* Good, because it collapses each occupant onto a single query-string key rather than one key plus a semicolon-delimited tail.
* Bad, because it nests one encoding inside another: every parameter value is percent-encoded twice over — once for the outer query-string rule, once again for the inner nested-parameter string — leaving the address bar materially less readable than a flat entry.
* Bad, because it introduces a second reserved delimiter (two consecutive colon characters) alongside the path delimiter (`.`), so a reader and an implementer must track two different boundary rules instead of one.
* Bad, because it produces long, ancestry-heavy keys for any deeply nested domain, since the whole chain of ancestors is restated inside the key itself rather than only the immediate parent's own extension.

### Pluggable URL codec over one internal model

One internal occupancy model, exactly as this record already decides, but the query-string serialization a consumer's own URL actually carries is a swappable codec per deployment, with the flat entry grammar shipped only as the default a consumer may replace with another.

* Good, because a consumer with an unusual legibility or length constraint could, in principle, supply its own encoding without this package's own internal occupancy model changing underneath it.
* Bad, because an addressing scheme that varies per deployment is not actually a shared addressing scheme: two consumers running two different codecs cannot read each other's URLs, defeating the point of the uniform mechanism this record adopts.
* Bad, because it is premature abstraction for a single known encoding with no second implementation ever named or requested — this record collapses multiple mechanisms into one, not one mechanism into an open-ended set a consumer configures.
* Bad, because it multiplies the Confirmation surface above by however many codecs a consumer could plug in, with no bound on that number and no second, real encoding to confirm against.

### Value-nested subtree encoding

One query-string key per top-level domain, whose own value recursively encodes that domain's entire subtree — nested domains, their own occupants, and those occupants' own parameters — in a rison/URLON-shaped nested serialization, rather than one entry per occupant at every depth.

* Good, because the query string carries fewer top-level keys: one per top-level domain rather than one per occupant at every depth.
* Bad, because it breaks per-slot independence: mutating any subtree requires a read-modify-write of the whole root key, forcing every domain to parse, preserve, and rewrite ancestors' and siblings' own subtrees it does not own — directly contradicting the URL back-projection helper's own per-entry-only replace guarantee.
* Bad, because a domain several steps deep can no longer resolve independently against its own domain key and its own registered extensions alone; it depends on every ancestor's own root key already having been parsed correctly, reintroducing the whole-URL coupling the uniform entry grammar was adopted to avoid.
* Bad, because a rison/URLON-shaped value is materially less legible in the address bar than a flat, if longer, entry-based string — trading one already-accepted readability loss for a second, different one, without recovering the first.

## More Information

Diagram note: this record's own mechanism-count decision is a comparison across five options — the chosen uniform entry grammar against four rejected alternatives — matching the shape this repository's own root ADRs already use for a decision of this kind (`cpt-frontx-adr-core-package-boundaries`, `cpt-frontx-adr-extension-domain-occupancy`), both recorded in prose and comparison lists with no diagram. No diagram is included here for the same reason.

**Retraction.** This record retracts and replaces the addressing model in `packages/routing/architecture/DESIGN.md` §1.1 ("Axes within a zone"), §3.1 (Domain Model — the Carrier, Base, Axis, and Basepath rows), and §4 ("Worked Example: A Console Layout And Its URL", in its pathname form), wherever those sections describe hierarchy as pathname continuation reserved to one axial domain per zone, occupancy fan-out as a single-entry parallel-axis query key, or per-occupant parameters as two different encodings depending on which of those two mechanisms a domain used. It is not an addition alongside that model; the grammar this record adopts supersedes it, not supplements it, for every domain. DESIGN itself is updated, in the same staged changeset as this record, to reflect this decision, including re-expressing its worked example under the new addressing shape.

**Scope of impact.** This decision governs the addressing and composition mechanism a domain's occupancy projects into the URL — how many query-string entries a domain contributes, how those entries are keyed and ordered, and how an occupant's own parameters are encoded within its entry. It does not decide occupant identity value source (already decided, this package's own `cpt-frontx-routing-adr-occupant-identity-stability`), whether the routing core imports `mfes` (already decided, this package's own `cpt-frontx-routing-adr-occupant-reference-boundary`), or the mount-trigger channel (already decided, this package's own `cpt-frontx-routing-adr-mount-trigger-ownership`). All three are cross-referenced here as still-standing, orthogonal decisions this record does not revisit. `cpt-frontx-adr-extension-domain-occupancy` still decides occupancy cardinality itself (which strategy a domain runs); this record decides only how whatever cardinality that strategy admits is addressed in the URL.

**Traceability.** `cpt-frontx-routing-fr-concurrent-occupant-projection` and `cpt-frontx-routing-fr-per-occupant-addressable-parameters`, cited below, are the two functional requirements the routing PRD defines (§5.2) and this grammar answers.

**Review trigger.** Revisit if a requirement emerges for a human-readable, bookmarkable pathname URL that this uniform grammar cannot express without reintroducing a privileged, pathname-continuing domain per zone.

**Checklist applicability.**

* ARCH — applicable and addressed above (an architecturally significant, hard-to-reverse addressing decision affecting every consumer that reads or constructs this package's own URLs).
* SEC — Not applicable because this decision introduces no secret, credential, or authorization concern; it only shapes how occupancy is encoded in the URL.
* PERF — Not applicable because producing one entry per occupant carries no different runtime cost, at this package's own operating volumes, than the three-mechanism model it replaces.
* REL — Not applicable because it governs an addressing/encoding scheme, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — applicable: this decision fixes the URL shape this package produces and expects, which every consumer that bookmarks, links to, or parses this package's own URLs must conform to; the breaking-change consequence above is the integration impact.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.
* MAINT — applicable: collapsing multiple mechanisms into one bounds the number of addressing rules a maintainer must hold in mind to one, at the acknowledged cost of inert entries a stale bookmark may carry.

## Traceability

- **PRD**: [../PRD.md](../PRD.md)
- **DESIGN**: [../DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-routing-fr-concurrent-occupant-projection` — the uniform entry grammar this record adopts is what lets a multi-occupant domain project every occupant without a mode bolted on alongside a separate single-occupant mechanism.
* `cpt-frontx-routing-fr-per-occupant-addressable-parameters` — every occupant's own parameters now live inside its own entry through one encoding, regardless of occupant count or tree position, closing the namespace-collision gap for every domain rather than only the previously compound-keyed ones.
* `cpt-frontx-adr-extension-domain-occupancy` — that record still decides occupancy cardinality itself (which strategy a domain runs); this record decides only how whatever cardinality that strategy admits is addressed in the URL. That record's own prior deferral of concurrent-domain projection is amended alongside this record, crediting this record's own uniform grammar as what now supplies a projection mechanism for every domain that record governs, of any occupant count, with no privileged domain per zone and no single-entry cap; this record owns the grammar's own shape, and that record's own role is only to record that its deferral no longer holds.
* `cpt-frontx-routing-adr-occupant-reference-boundary` — cross-referenced as a still-standing, orthogonal decision this record does not revisit: occupant identity continues to resolve through the same opaque Occupant contract, unaffected by how that identity's own entry is composed.
* `cpt-frontx-routing-adr-mount-trigger-ownership` — cross-referenced as a still-standing, orthogonal decision this record does not revisit: which channel drives a post-boot mount is unchanged; only how the URL back-projection helper's target entry is composed changes.
* `cpt-frontx-routing-adr-occupant-identity-stability` — cross-referenced as a still-standing, orthogonal decision: the extension token this record's grammar carries in each entry is exactly the identity value that record fixes, unaffected by how the entry around it is composed.
