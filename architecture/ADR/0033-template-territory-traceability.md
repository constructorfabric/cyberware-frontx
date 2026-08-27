---
status: accepted
date: 2026-08-04
---

# Which Artifact Tree Specifies Template-Territory Code, and What Its Traceability Markers Mean

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Template territory is outside the ecosystem artifact universe; markers there are non-authoritative residue, removed as files are touched](#template-territory-is-outside-the-ecosystem-artifact-universe-markers-there-are-non-authoritative-residue-removed-as-files-are-touched)
  - [Extend the ecosystem artifact tree to cover template internals](#extend-the-ecosystem-artifact-tree-to-cover-template-internals)
  - [Keep the residue markers and rely on the scan exclusion alone](#keep-the-residue-markers-and-rely-on-the-scan-exclusion-alone)
  - [Give template territory its own artifact tree now](#give-template-territory-its-own-artifact-tree-now)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-template-territory-traceability`

## Context and Problem Statement

The repository's architecture artifacts describe the FrontX ecosystem — the published packages, the CLI, and the AI tooling kit — while the template subtrees — the top-level directories carrying a `frontx-template.json` manifest, which is how the repository defines a template — hold template payload the CLI resolves and applies into a developer's repository, not ecosystem contract. That payload still carries `@cpt-` traceability markers from the pre-ecosystem-redesign artifact generation, whose FEATUREs (`feature-request-lifecycle`, `feature-react-bindings`, `feature-state-management` and their peers) were archived and then deleted, so the markers name instruction IDs no artifact defines. Reviewers reading a marked template file reasonably infer a specified contract behind it and open a gap report when they cannot find one. Which artifact tree, if any, specifies template-territory code, and what status do the `@cpt-` markers already sitting in it have?

## Decision Drivers

* **One universe per artifact tree** — the ecosystem's PRD, DESIGN, and DECOMPOSITION describe the ecosystem's own artifacts; admitting template payload into that same tree would give one artifact set two unrelated subjects and two reasons to change.
* **Template content is not ecosystem content** — the ecosystem's tooling deliberately carries no bundled template or solution content (`cpt-frontx-principle-template-agnostic-tooling`); its specification should draw the same line, or the decoupling holds in code but not in the artifacts.
* **A marker is a claim** — a `@cpt-` marker asserts that a numbered instruction specifies the marked region; a marker that names nothing is a false claim to every reader, whether or not any validator reads it.
* **Silence must be legible** — that template internals are unspecified is a deliberate position, and it must be discoverable from the artifacts rather than inferred from a validator's exclusion list.
* **No premature specification** — writing FEATUREs for template internals now would fix contracts for code whose ownership is still moving (the template split), and it is the larger, harder-to-undo commitment of the available options.

## Considered Options

* **Template territory is outside the ecosystem artifact universe; markers there are non-authoritative residue, removed as files are touched** — the ecosystem artifact tree's subject is the ecosystem's own artifacts; template subtrees are payload it does not specify. Existing `@cpt-` markers in those subtrees are declared residue of the archived generation: they bind nothing, no new ones are added, and the ones present are removed from a file when that file is otherwise modified. Behaviour of template code is documented at code altitude, where the code lives.
* **Extend the ecosystem artifact tree to cover template internals** — add DECOMPOSITION entries and FEATUREs (starting with a revived request-lifecycle feature) so every existing marker in template territory resolves to a live instruction.
* **Keep the residue markers and rely on the scan exclusion alone** — change nothing in the artifacts or the payload; the registry's exclusion of the template subtrees is the whole answer.
* **Give template territory its own artifact tree now** — author a separate, nested artifact tree owned by the template, and re-point every marker in the payload at IDs from that tree.

## Decision Outcome

Chosen option: **Template territory is outside the ecosystem artifact universe; markers there are non-authoritative residue, removed as files are touched**, because it is the only option that keeps one subject per artifact tree, retires the false claims the stale markers make, and commits to no specification the template's ownership is not yet settled enough to support.

The **ecosystem artifact tree specifies the ecosystem's own artifacts** — the published packages, the CLI, and the AI tooling kit. Template subtrees are payload the CLI resolves, applies, and upgrades through the uniform mechanism (`cpt-frontx-adr-uniform-template-mechanism`); what they contain internally is the template's own business, bounded by the ownership declaration it publishes (`cpt-frontx-adr-template-ownership-boundary-declaration`), not an ecosystem contract. Consequently **no ecosystem FEATURE is authored to back template-internal code**, and no artifact in this tree is extended to cover it.

The `@cpt-` markers presently in template territory are **residue of the archived pre-redesign generation and bind nothing**: they are not authoritative, they are not evidence that a contract was specified, and they must not be read as traceability. **No new markers are added to template territory**, and when a template file is otherwise modified, **every residue marker that file carries is removed** — the rule is uniform, needs no separate sweep, and leaves no half-covered file behind. The strip is mechanical, and review should keep marker-only deletion easy to distinguish from substantive change. Where template code has behaviour a consumer depends on — a hook's observable status lifecycle, for instance — that behaviour is documented **at code altitude, in the code and its package documentation**, which is the reader's location and carries no claim of upstream specification.

**What defines the territory is the manifest, and keeping the scan's exclusion equal to it is an authoring obligation.** A directory is template territory because it carries a `frontx-template.json`, and that is how the repository's own template discovery finds one — never by a name prefix, which a rename would silently defeat. The artifact registry, by contrast, excludes template territory by enumerating the directories it presently holds, because the registry's exclusion form takes path patterns and not a content predicate. The two agree only for as long as someone keeps them equal. The obligation this creates is therefore stated here rather than left to be discovered: **creating, renaming, or relocating a template directory extends or corrects that enumeration in the same change.** A template directory absent from the enumeration is not a benign omission — its payload enters the ecosystem scan, where every file is judged against a universe this decision put it outside of, and the failure lands on the next validation run rather than on the change that caused it. The rule holds in the other direction too: an enumerated pattern for a directory that no longer exists silences a scan nobody is watching, so a removed template's pattern goes with it. Neither direction is a matter of judgement, and neither becomes one as the number of templates grows.

The scope of this decision is which artifact tree specifies template-territory code and the standing of `@cpt-` markers found there. It does not decide the boundary a template declares (`cpt-frontx-adr-template-ownership-boundary-declaration`), how the CLI applies or upgrades a template (`cpt-frontx-adr-uniform-template-mechanism`, `cpt-frontx-adr-project-upgrade-mechanism`), nor whether the template will eventually carry an artifact tree of its own — that is deliberately deferred (see More Information).

### Consequences

* Good, because each artifact tree keeps one subject: the ecosystem's artifacts are described by the ecosystem's artifacts, and template payload is not smuggled into them.
* Good, because a `@cpt-` marker recovers its meaning inside the specified universe: there it names a live instruction; residue in paths the registry ignores is retired by the rule above.
* Good, because the position is now stated in the artifacts, so the next reviewer who finds a marked-but-unspecified template file reads a decision instead of filing a gap.
* Good, because it commits to no specification of code whose ownership is still moving, leaving the template's own artifact tree available as a later, deliberate step.
* Bad, because template territory keeps residue markers until each file is otherwise touched, so the payload stays in a mixed state for as long as that takes.
* Bad, because behaviour documented only at code altitude is easier to change without review than behaviour fixed by a numbered instruction, so a consumer-visible change in template payload rests on code review alone.
* Bad, because the scan's exclusion is an enumeration of directories while the territory is defined by manifest presence, so the two are kept equal by an authoring rule rather than by construction, and the cost of that rule is paid once per template directory created, renamed, relocated, or removed.

### Confirmation

Compliance is confirmed by the artifact registry and by review. The registry admits only the ecosystem's own source paths to traceability scanning and excludes the template subtrees, so no template file is scanned for markers and no marker there is validated; `cfs validate` passing therefore never depends on template payload. Review confirms that no FEATURE in this tree names a path under a template subtree, that a change adding a `@cpt-` marker to template territory is refused, and that a change modifying an already-marked template file removes every residue marker that file carries while keeping the mechanical marker deletion easy to distinguish from substantive change and documenting any consumer-visible behaviour at code altitude in the same change. Review additionally confirms that every directory carrying a template manifest appears in the registry's exclusion and that every excluded pattern still addresses one, so a change that creates, renames, relocates, or removes a template directory carries the corresponding registry change with it.

## Pros and Cons of the Options

### Template territory is outside the ecosystem artifact universe; markers there are non-authoritative residue, removed as files are touched

The ecosystem tree specifies ecosystem artifacts only; template payload is unspecified by it, residue markers bind nothing and are removed as files are modified, and template behaviour is documented in the code.

* Good, because one artifact tree keeps one subject, matching the tooling's own template-agnostic separation.
* Good, because it retires false traceability claims rather than preserving them.
* Good, because the removal rule is uniform and needs no repository-wide sweep to be consistent.
* Neutral, because it leaves the template's own artifact tree as an open, deferred option.
* Bad, because the payload stays mixed until files are touched, and code-altitude documentation is weaker protection than a numbered instruction.

### Extend the ecosystem artifact tree to cover template internals

Revive the archived feature areas as live FEATUREs, with DECOMPOSITION entries and DESIGN components, so every existing marker resolves.

* Good, because every marker in the repository would resolve to a live instruction.
* Good, because consumer-visible template behaviour would be fixed by numbered instructions.
* Bad, because it re-imports template payload into an artifact tree whose subject is the ecosystem, giving one tree two subjects and two reasons to change.
* Bad, because it is the largest and least reversible option, fixing contracts for code whose ownership is still in motion.
* Bad, because doing it for one hook, rather than for every archived feature area at once, produces an arbitrary island of specified code inside unspecified payload.

### Keep the residue markers and rely on the scan exclusion alone

Change nothing; the registry's exclusion of the template subtrees is the whole answer.

* Good, because it costs nothing and breaks no validation, which already ignores those paths.
* Bad, because the false claims stay in the payload and keep misleading readers — the exclusion is invisible from the file a reviewer is reading.
* Bad, because it leaves the position recorded only in tool configuration, where an architectural decision is not discoverable.

### Give template territory its own artifact tree now

Author a separate nested artifact tree owned by the template and re-point the payload's markers at its IDs.

* Good, because it would specify template behaviour without mixing subjects, and would give the markers a legitimate home.
* Neutral, because it is the natural destination if template internals ever need specified contracts.
* Bad, because it is premature while template ownership is still moving, and it is a large authoring commitment ahead of any demonstrated need.

## More Information

**Deferred deliberately**: whether template territory gets an artifact tree of its own is **not decided here**. It is deferred until template ownership has settled and template internals present a contract a consumer depends on across versions — at which point this decision must be revisited through the repository's ADR lifecycle, markers may be reintroduced against IDs from that tree, and the registry's scanning scope is revisited in the same step. Deciding it now would fix contracts for code whose ownership is in motion.

The uniform mechanism by which the CLI treats any template is decided in `cpt-frontx-adr-uniform-template-mechanism`; the boundary a template declares over what it owns in `cpt-frontx-adr-template-ownership-boundary-declaration`. These are non-binding pointers and do not form part of this decision's durable identity.

Applicability of the remaining checklist categories: **REL** — Not applicable, because this decision changes no runtime behaviour and introduces no failure mode; it fixes what the artifacts specify and what a marker asserts. **PERF** — Not applicable, because no latency or throughput budget is bound to artifact scope. **SEC** — Not applicable, because no secret material or authentication surface is introduced. **DATA** — Not applicable, because no schema is fixed. **INT** — addressed: the integration surface a consumer relies on is the template's declared ownership boundary and its published payload, not an ecosystem instruction for template internals. **OPS** — Not applicable, because there is no running service. **MAINT** — addressed: markers regain a single meaning, and the touch-it-remove-it rule keeps residue retirement uniform without a repository-wide sweep. **COMPL** — Not applicable. **UX** — addressed for the developer-as-reader: a marked file inside the specified universe resolves to a live instruction, and template payload no longer implies specification it does not have. **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-principle-template-agnostic-tooling` — The ecosystem's tooling bundles no template or solution content; this decision draws the same line through the artifacts, keeping template payload outside the specification of the ecosystem's own artifacts.
* `cpt-frontx-principle-ownership-bounded-composition` — What a template contains internally falls inside the boundary that template declares and owns; this decision keeps that content out of the ecosystem tree rather than specifying it from outside the owner.
* `cpt-frontx-adr-uniform-template-mechanism` — Templates are payload the tooling resolves, applies, and upgrades uniformly without branching on type; this decision is the artifact-side consequence: the ecosystem specifies the mechanism, not any template's internals.
* `cpt-frontx-nfr-evolvability` — Retiring markers that bind nothing, and declining to fix contracts for code whose ownership is still moving, keeps the artifacts an accurate description of what is specified and leaves the template free to evolve on its own cadence.
