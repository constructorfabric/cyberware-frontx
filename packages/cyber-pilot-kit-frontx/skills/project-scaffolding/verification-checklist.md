# Scaffolding Verification Checklist

**Artifact**: the verification a scaffolding run performs in Step 7 and reports in Step 8
**Version**: 1.2
**Purpose**: the accounting layer over Step 7's browser walk and Step 8's report - what must be true for a claim to stand

This checklist states **what must hold**. The skill document beside it states **how**
each check is driven, and stays the authority on mechanics: every item below traces
to a rule already written there. When the two appear to disagree, the skill's own
rule is the wording that governs and this file is what is out of date.

Nothing here adds a check to what a covering skill declares. Which checks exist is
the covering skill's to say; this file governs only how honestly the run reports
whatever it ran. That holds for a verification flow an applied template brought
with it too: where one led the design review, this file accounts for the walk's
own coverage and the report carries that flow's findings beside it, rather than
re-accounting them here as categories this walk was ever supposed to establish.

Many of the mechanics these items account for are performed by the driver the skill
ships and runs, so several items below are satisfied by that program's own result
file rather than by anything a run has to remember to do. That does not narrow the
accounting: **the driver having run is not by itself a PASS on anything**. Each item
is judged against what this run's result file, capture directory and coverage file
actually carry, and a driver that failed, was fallen back from, or was never run
leaves every item under it to be established some other way and disclosed as such.

## Table of Contents

1. [Severity Dictionary](#severity-dictionary)
2. [Prerequisites](#prerequisites)
3. [Applicability](#applicability)
4. [MUST HAVE](#must-have)
   - [VER-SCOPE - Declared Scope](#ver-scope---declared-scope)
   - [VER-STATE - State and Capture Evidence](#ver-state---state-and-capture-evidence)
   - [VER-CMP - Capture Comparison](#ver-cmp---capture-comparison)
   - [VER-ROUTE - Address and Reachability](#ver-route---address-and-reachability)
   - [VER-NUM - Published Figures](#ver-num---published-figures)
   - [VER-ENV - Run Environment](#ver-env---run-environment)
   - [VER-REPORT - Coverage File and Report](#ver-report---coverage-file-and-report)
5. [MUST NOT HAVE](#must-not-have)
6. [Reporting](#reporting)

---

## Severity Dictionary

- **CRITICAL**: the report would state something the run did not establish. Blocks
  the verification from being reported as passed.
- **HIGH**: process broken in a way that costs the run its evidence, its
  environment or its time. Fix before reporting.
- **MEDIUM**: hygiene. Fix when feasible.

---

## Prerequisites

Before walking this checklist, confirm:

- [ ] I have read this file end to end, first line to last, before the browser walk
      began - not a head, not a line limit, not an excerpt, and not the table of
      contents read as if it were the items
- [ ] I will check every item in MUST HAVE and verify every item in MUST NOT HAVE
- [ ] I will judge each item against what this run captured, not against what it intended
- [ ] I will report a category as FAIL when its evidence is absent, rather than omit it
- [ ] I will claim PASS only against items I actually read
- [ ] I will use the [Reporting](#reporting) status walk at the end of this document

---

## Applicability

Every category applies to a run that performed a browser verification. A category
that genuinely does not apply is reported `N/A` **with the reason**, and the reason
names what about this run put the category out of reach.

An applicability rule below turns on **what the project declared**, never on what
this run found convenient. Each of them is written against a declaration the run
can point at - an axis the template states the project has or does not have, a
control it names or does not name - so an `N/A` is checkable and a skipped
category still cannot hide behind one.

- **VER-ROUTE** is N/A where the run declared no checkpoint axis, so there is no
  declared point whose address could be exercised, and where the declared points
  carry no destination to load.
- **VER-ROUTE-002 alone** is additionally N/A where the project reaches its
  checkpoints by loading each destination rather than by clicking a control -
  there is then no click for an address to follow. A project whose points are
  reached from inside the content, from a command surface, or not at all because
  there is only one, is this case.
- **VER-CMP** is N/A only where the run took a single pass - because the project
  declares no variant axis, or because the axis holds one value - so no capture
  pair exists to compare.
- **VER-STATE-001's last item and VER-STATE-002** are N/A only where the project
  declares no variant axis, so there is no switcher to operate and no label to
  confirm a value from.
- **VER-ENV-003** is N/A only where the project declares no overlay the walk has
  to operate through - no control that opens one and none that closes it again -
  so nothing is drawn over the surface for a capture to carry.
- **VER-NUM** is N/A only where the run published no figure at all.

Everything else applies whenever the browser walk ran. `N/A` is not available for a
category the run skipped: a skipped category is a narrowed scope, and it is reported
under VER-SCOPE-002 as such.

---

# MUST HAVE

---

## VER-SCOPE - Declared Scope

### VER-SCOPE-001: The Declared Set Is Covered in Full
**Severity**: CRITICAL

- [ ] Whether this project declares a variant axis was established from the template
      it was applied from, not assumed either way
- [ ] Whether it declares a checkpoint axis - the points the walk visits, and how
      each one is reached - was established the same way and from the same source
- [ ] Where either is declared, its set was read from the project's own declaration
      of it - the source file where the values or the points are declared, or the
      list it exports
- [ ] Neither set was taken from the entries a control happens to offer
- [ ] The count of declared values and the count of walked values are the same
      number, and the same holds for the declared points
- [ ] Every state the declared checks call for is covered, at every point walked
- [ ] No value, point or state was set aside as a sample or a representative subset
- [ ] A project declaring neither axis is reported as having been walked once, at
      whatever its host opens, and is not written up as a narrowed run

### VER-SCOPE-002: A Narrowing Is Stated in the Visible Output
**Severity**: CRITICAL

- [ ] Any narrowing names which part of the scope is narrowed, what is left out of
      it, and why
- [ ] That reason is written into the text the developer reads, not only into the
      coverage file, which records what was covered and cannot carry the reason
- [ ] Everything left out is reported as not verified
- [ ] An unexplained narrowing is reported as a verification failure, not as a scope
      decision this run was free to make

### VER-SCOPE-003: The Reason Answers the Narrowed Check's Own Axis
**Severity**: CRITICAL

- [ ] Each narrowing's reason argues the axis the narrowed check covers
- [ ] A visual check - what a state looks like once a variant value is applied -
      is not closed by an argument about behavior, however true that argument is
- [ ] A reason arguing another axis is recorded as an unexplained narrowing and
      handled under VER-SCOPE-002

### VER-SCOPE-004: A Widening Is Declared Exactly as a Narrowing Is
**Severity**: HIGH

- [ ] Where the walked set is wider than what the developer's own phrasing asked
      for, the report says so in one sentence: asked X, declared set Y, walked Y
- [ ] That sentence sits in the text the developer reads, beside the coverage table
- [ ] The asked-for set and the declared set stay distinguishable in the report, so
      the coverage table can be read against the question that was actually asked
- [ ] Walking wider is not itself a finding; walking wider in silence is

---

## VER-STATE - State and Capture Evidence

### VER-STATE-001: Each Pass Starts From a State This Run Knows
**Severity**: HIGH

- [ ] Every pass's block begins with a reload, the first pass included
- [ ] A state is named `fresh` only for a capture taken after that reload and before
      any interaction in that pass
- [ ] Where a variant axis is declared, the active value was read before anything was
      verified, and the project's declared default was selected before the first capture

### VER-STATE-002: The Variant Switch Is Confirmed Off the Switcher's Own Label
**Severity**: CRITICAL

- [ ] The switcher's label was read after each switch, and it names the value just
      selected
- [ ] No attribute, class, computed style or source file was used to detect which
      value is active
- [ ] The label line's output was actually read: it prints and the batch carries on,
      so every line after it ran whatever the label said
- [ ] A label still naming the previous value was recorded as not-active with that as
      the reason, its block's captures discarded, and nothing under it passed as verified

### VER-STATE-003: Every Claimed State Cites Its Own Capture
**Severity**: CRITICAL

- [ ] Every state named as captured has a capture artifact of that state, in that pass
- [ ] Each state names the capture it is claimed from - the screenshot's file name, or
      the accessibility snapshot taken at that point - in the cell or in a notes line
      under the table
- [ ] A state this pass only drove is listed apart, as `<state> driven, not captured`
- [ ] No state captured in one pass is claimed on another pass's row

### VER-STATE-004: State Is Read Back From Something That Looked at the Page
**Severity**: HIGH

- [ ] Every click and every load is followed by a reading of the page, never by the
      runner's own confirmation that it issued the command
- [ ] Each fill is confirmed by reading the value back off the same handle
- [ ] Controls inside the surface under verification were driven by the handles read
      out of the shadow roots, not by an outside selector that cannot see in
- [ ] What a compact snapshot leaves out was not read as evidence of absence
- [ ] No product source was edited on a snapshot-only signal

---

## VER-CMP - Capture Comparison

### VER-CMP-001: Distinctness Is Read Off a Command's Result
**Severity**: CRITICAL

- [ ] Each pass's captures were compared against the previous pass's by running the
      comparison as a command over the two files
- [ ] Every distinctness cell carries that command's own result - the printed exit
      code, or the two hashes
- [ ] No cell was filled by opening two captures and judging them different by eye
- [ ] A capture pair the command was never run over is recorded as not-compared, with
      the reason, and carries no verdict
- [ ] Identical captures are recorded as the fact they are, neither reported as a
      failure nor passed off as visibly distinct
- [ ] The first pass's cell says it has no predecessor to compare against

---

## VER-ROUTE - Address and Reachability

### VER-ROUTE-001: Each Checkpoint Answers Its Own Declared Destination
**Severity**: CRITICAL

- [ ] Each checkpoint's destination was read out of the template's own declaration
      of that point, and no path named by the skill, the plan or the report was
      opened
- [ ] Each checkpoint was reached by a full load of that destination, not by
      clicking a control
- [ ] The reading after that load confirms it is that checkpoint which mounted

`N/A` where the run declared no checkpoint axis, or where the declared points
carry no destination to load - a project whose points are not separately
addressable has nothing here to establish.

### VER-ROUTE-002: The Address Follows the Control That Reaches a Checkpoint
**Severity**: CRITICAL

- [ ] After clicking the control that reaches another checkpoint, the URL was read
      back with the runner's own url reading
- [ ] The pathname read back equals that checkpoint's declared destination
- [ ] The reading after that click confirms the clicked checkpoint is the one mounted

`N/A` where the project reaches its points by loading each destination rather
than by clicking a control, and where its points carry no destination for an
address to be compared against. The `N/A` names which of the two it is, and names
the project's own declaration it read that from.

### VER-ROUTE-003: Reachability Is Reported Per Checkpoint
**Severity**: HIGH

- [ ] The report carries one line per realized checkpoint: the destination it was
      deep-linked at, what mounted there, and the pathname read back
- [ ] A failure here is reported as a defect carrying those three readings, and the
      project reported as not verified for addressing
- [ ] An address left unexercised is reported as unexercised, never left unmentioned

---

## VER-NUM - Published Figures

### VER-NUM-001: Every Figure Was Printed by a Command
**Severity**: CRITICAL

- [ ] Each figure points at the captured output line that carries it verbatim
- [ ] The command each figure came from is named
- [ ] No figure was recalled from earlier in the session or carried over from an
      earlier run

### VER-NUM-002: No Total the Run Did Not Observe
**Severity**: CRITICAL

- [ ] Where no command printed a grand total, the report carries no grand total
- [ ] Where a run printed one summary line per workspace, every one of those lines is
      published as it stands and no number standing for the whole is published beside them
- [ ] No figure was obtained by adding captured lines together
- [ ] A phrase naming a total appears only beside the output line that itself contains it

### VER-NUM-003: The Run Being Quoted Was Captured Whole
**Severity**: HIGH

- [ ] The run whose figures the report quotes was captured without truncation that
      could hide a workspace's summary
- [ ] Where the output had to be reduced, it was filtered for the summary lines rather
      than sliced from either end, and the whole log kept beside it
- [ ] Every total comes from the last fully green run and from no other
- [ ] A workspace whose summary was never observed is named as uncaptured and re-run,
      neither inferred from its neighbours nor dropped in silence

### VER-NUM-004: Every Figure Postdates the Last Source Edit
**Severity**: CRITICAL

- [ ] No source file was changed after the gates whose figures the report quotes
- [ ] Where one was, the unit legs and then the aggregate gates were re-run, and the
      report drawn from that run alone

---

## VER-ENV - Run Environment

### VER-ENV-001: Captures Land in a Directory This Run Created
**Severity**: HIGH

- [ ] The capture directory was created by this run, before the first capture
- [ ] Every capture path is written with that directory resolved into it
- [ ] No capture was taken into a fixed path shared across runs
- [ ] No claim is satisfied by a file this run did not write

### VER-ENV-002: Servers Are Stopped by Recorded Process Id, and the Ports Confirmed Free
**Severity**: HIGH

- [ ] Each dev server's process id was recorded at start, or the runner's own stop
      mechanism was used where it declares one
- [ ] No process was stopped by a pattern match against command lines
- [ ] After each kill, every port this run started was asked whether anything still holds it
- [ ] Every surviving process id printed was killed by that printed id, and the port
      re-asked until it printed nothing

### VER-ENV-003: Host Chrome Is Off the Captures
**Severity**: HIGH

- [ ] Where the project declares an overlay the walk operates through, it was closed
      before the first capture in every pass, and the close confirmed rather than
      assumed
- [ ] No capture was taken, and no click aimed, while that overlay covered the
      surface under verification

`N/A` where the project declares no such overlay - no control that opens one and
none that closes it again - so nothing was drawn over the surface for a capture
to carry. That a host has a collapsible tools panel is one project's declaration,
not a property of every project this checklist accounts for.

### VER-ENV-004: An Already-Listening Browser Is Attached To
**Severity**: MEDIUM

- [ ] The debugging endpoint was probed once before any browser was launched
- [ ] Where it answered, the run attached to that browser rather than launching a second one

---

## VER-REPORT - Coverage File and Report

### VER-REPORT-001: The Coverage File Exists and Was Written First
**Severity**: CRITICAL

- [ ] The coverage file exists **on disk** beside the project's provenance record, at
      the path the skill names, and that path was read to establish it
- [ ] It was written before the final report was composed
- [ ] It holds one row per pair the walk covered - every pass of the variant axis
      against every point of the checkpoint axis - including every declared value
      recorded as not-active
- [ ] A run that declared no variant axis holds the rows its one pass earned, with
      that axis's cells reading `not-exercised` and naming the axis as not declared -
      never `no` or `none`, which read as a claim about the project
- [ ] A run that declared no checkpoint axis says exactly the same about that axis,
      in the cell that would otherwise name the point
- [ ] Each row carries its own states-captured cell and its own distinctness verdict,
      so a verdict belongs to the point it was taken at
- [ ] Nothing stood in for it: a table inside the report, a table shown in the
      conversation, and a table a driver printed and nobody kept are not this file.
      The report step is not complete while the file is absent, and a report composed
      over an absent one says so and reports the verification as not complete

### VER-REPORT-002: The Coverage Table Is Reproduced in Full
**Severity**: CRITICAL

- [ ] The report reproduces the table row for row and column for column
- [ ] The path of the file it was reproduced from follows it
- [ ] No link, file name, row count or summarizing sentence stands in its place

### VER-REPORT-003: The Report Walks Every Category of This Checklist
**Severity**: CRITICAL

- [ ] The report carries one status line per category, in the form this document's
      [Reporting](#reporting) section fixes
- [ ] Every category appears, including the MUST NOT HAVE partition
- [ ] Each FAIL names what the run did not establish, and each N/A names why the
      category was out of reach
- [ ] A category the report leaves out is treated as a failure of the report, not as a
      category that passed

### VER-REPORT-004: A Failed Verification Is Reported as One
**Severity**: HIGH

- [ ] A failing declared verification stopped the flow where it failed
- [ ] The project is reported as applied and realized but not verified, with that
      verification's own output relayed unreinterpreted
- [ ] No correction retry was attempted
- [ ] Scaffolding is not reported as complete over a failing gate

### VER-REPORT-005: This Checklist Was Read in Full Before the Walk
**Severity**: CRITICAL

- [ ] This file was read end to end, first line to last, before the browser walk began
- [ ] The read was not a head, a line limit, an excerpt, a section jumped to, or the
      table of contents read as if it were the items under it
- [ ] Every PASS in the status walk is claimed against an item this run actually read
- [ ] The read happened before the walk, so the walk was driven toward what would be
      accounted for, and this file was walked again before the report was composed

### VER-REPORT-006: Every Attempt Is Disclosed
**Severity**: CRITICAL

- [ ] The report names how many verification attempts this run made
- [ ] Each failed attempt carries one line saying what failed and the reason it reported,
      including attempts that failed in the harness rather than in the product
- [ ] A driver failure, and any fall back to hand-authored browser calls after one, is
      disclosed with the driver's own reported reason before anything the fallback
      captured is shown
- [ ] No attempt was left out: an undisclosed retry invalidates this category however
      sound the final attempt was, because a first-time pass and a fourth-time pass
      read identically without it
- [ ] Retrying a harness failure is legal here; retrying a *failing declared
      verification* to make it pass is not, and stays forbidden under VER-REPORT-004
      and VER-NO-005

---

# MUST NOT HAVE

### VER-NO-001: No Claim Resting on the Runner's Own Exit Report
**Severity**: CRITICAL

**What to check**:
- [ ] No state confirmed from the runner reporting that it issued a command
- [ ] No fill confirmed from its exit code alone
- [ ] No distinctness verdict without the comparison command's printed result

**Where the evidence belongs**: a reading of the page, or the comparison command's output

### VER-NO-002: No Figure the Run Did Not Observe
**Severity**: CRITICAL

**What to check**:
- [ ] No repository-wide total assembled by summing per-workspace lines
- [ ] No figure taken from a failed run, or from a run predating the fix
- [ ] No figure predating the last source edit

**Where the evidence belongs**: the captured output line carrying the figure verbatim

### VER-NO-003: No Capture Standing In for Another Pass or Another Run
**Severity**: CRITICAL

**What to check**:
- [ ] No state claimed on a pass's row whose own artifacts do not carry it
- [ ] No file written by an earlier run cited as this run's evidence
- [ ] No capture taken after an interaction named `fresh`

**Where the evidence belongs**: this run's own capture directory, per pass

### VER-NO-004: No Scope Narrowed in Silence
**Severity**: CRITICAL

**What to check**:
- [ ] No variant value, checkpoint or state dropped without its reason in the visible output text
- [ ] No reason arguing an axis other than the one the narrowed check covers
- [ ] No sample or subset presented as the registered set
- [ ] No set walked wider than what was asked for without the declaring sentence
      VER-SCOPE-004 requires

**Where the evidence belongs**: the report's own text, beside the coverage table

### VER-NO-005: No Source Edited to Move a Check Along
**Severity**: HIGH

**What to check**:
- [ ] No product source changed during the browser walk
- [ ] No correction retry after a failing command or a failing declared verification
- [ ] No environment torn down to chase a signal a screenshot or a DOM reading would have settled

**Where it belongs**: a defect report handed back with the run

### VER-NO-006: No Category Left Out of the Status Walk
**Severity**: CRITICAL

**What to check**:
- [ ] No category of this checklist absent from the report's status walk
- [ ] No blanket statement standing in for the per-category lines
- [ ] No PASS on a category whose evidence the report does not carry

**Where it belongs**: the [Reporting](#reporting) status walk below

### VER-NO-007: No Verdict Softening a CRITICAL FAIL
**Severity**: CRITICAL

**What to check**:
- [ ] No verdict line reporting the verification as passed while any CRITICAL item is FAIL
- [ ] No CRITICAL FAIL restated as "hygiene gaps", "minor findings", "notes for
      follow-up", or any other wording that turns it into something the run may close over
- [ ] No closing line of "residual: none", or its equivalent, over a standing CRITICAL FAIL
- [ ] No verdict written before the status walk that decides it

**Where it belongs**: the verdict line beneath the status walk, which says the
verification did not pass and names the CRITICAL items that failed. This is a
violation in its own right, recorded on top of whatever the original FAIL was: a
run that walked the categories honestly and then softened the verdict has failed
the verification twice.

---

## Reporting

The report carries one line per category, in this order and this form:

```
VER-SCOPE:  PASS | FAIL (<what was not established>) | N/A (<why out of reach>)
VER-STATE:  ...
VER-CMP:    ...
VER-ROUTE:  ...
VER-NUM:    ...
VER-ENV:    ...
VER-REPORT: ...
VER-NO:     ...
Verdict:    the verification passed | the verification did not pass (<the CRITICAL items that failed>)
```

- **PASS** means every item in that category holds and the report carries the evidence
  each one asks for.
- **FAIL** names the item that did not hold and what the run did not establish. A FAIL
  on any CRITICAL item means the verification is not reported as passed.
- **N/A** names why the category was out of reach, under [Applicability](#applicability).
  A category the run simply skipped is a FAIL, not an N/A.
- **Verdict** is decided by the walk above it and written after it. Where any CRITICAL
  item is FAIL, this line says the verification did not pass, and no rewording of the
  finding changes that - see [VER-NO-007](#ver-no-007-no-verdict-softening-a-critical-fail).

An absent line is a FAIL of the report, not a category that passed.
