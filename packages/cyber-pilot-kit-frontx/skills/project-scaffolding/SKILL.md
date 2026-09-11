---
name: frontx-project-scaffolding
description: "Applies when a developer wants a new FrontX project created from what they say they want built, rather than from a reference they already hold - for example a console with a stated number of screens. Matches the stated intent against what the locally installed inventory declares about itself, drives the frontx executable to apply the chosen set, and then realizes each unit the intent names inside the applied ground."
---

# Create a FrontX Project from a Stated Intent

The developer says what they want built. This capability delivers a project that
holds it.

Nothing in this document knows the name of any template. Everything it chooses
among is read from the inventory installed on this machine, at the moment of
use, through the `frontx` executable. A conforming template installed after this
document shipped becomes selectable immediately, with no change here.

## Boundaries you must not cross

- **Drive the executable, never the package.** Every application of a template
  happens by running `frontx`. Do not import `@gears-frontx/cli`, do not call
  into it, and do not read its inventory storage on disk. What the inventory
  holds reaches you as the output of a command you ran, and by no other means.
- **Reproduce nothing the CLI owns.** Resolution, assembly, the pre-flight
  conflict check and provenance writing belong to the CLI. Do not re-implement
  them, pre-empt them, or work around a refusal any of them issue.
- **Write no project file yourself while applying.** Until the applications are
  finished, every file under the target directory is one the CLI wrote.
- **No correction loop.** When a command exits non-zero, stop there. Relay the
  reason that command itself reported, unreinterpreted. Do not retry it, do not
  adjust the arguments and run it again, and do not run the next command.
- **Refuse rather than guess.** When you cannot tell what to apply, say so and
  write nothing. A project the developer did not ask for is worse than no
  project.

## Step 1 - Read the selectable set

```bash
frontx list --json
```

One JSON line: `{ "ok": true, "templates": [ ... ] }`. Each record carries

- `name` - the template's identity, and **the argument the apply commands take**;
- `ref` - the reference the entry is pinned at, taken from the source-spec's
  `@ref` segment. Report it in the plan so the developer sees which pinned
  reference will be applied. It is **not** the manifest's `version` field: the
  two need not agree in form or value, so do not present it as the version and
  do not derive one from the other;
- `source` - the address it was resolved from;
- `description` - the template's own statement of what it establishes and what
  it contributes. **The key is absent when the template declares none**;
- `manifestUnreadable` - present, and only ever `true`, when the entry's stored
  manifest no longer satisfies the manifest contract, so no description could be
  read from it. The listing reports the rest of the inventory rather than failing
  over one bad record, and marks the bad one this way. **Neither entry is
  selectable, but they are not the same problem and must not be reported as the
  same one**: a template that declares none is working as intended and simply
  cannot be chosen from an intent, whereas an unreadable manifest is a broken
  installation the developer can fix by reinstalling that template.

This command is the only source for the selectable set. Do not consult any
remote registry, any list built into this document, or the CLI's storage.

## Step 2 - Read what the target directory already holds

Read `<targetDir>/.frontx/provenance.json`. It is a JSON array, one record per
already-applied template, each carrying `templateIdentity`,
`scaffoldedFromVersion`, `sourceSpec` and `occupiedOwnershipBoundary`.

Absent or unreadable file means the directory holds no applied template. A
directory that already holds records gets no seed - only further templates added.

**Absent provenance is not by itself a licence to seed.** Seeding writes a whole
repository and the CLI refuses it against a target that already holds content, so
also check what the path holds. Use exactly the CLI's own rule, so your plan and
its answer cannot disagree:

- **does not exist**, **exists and is empty**, or **holds only** the closed set
  `.git`, `.DS_Store`, `Thumbs.db` - the plan begins with a seed. A freshly
  initialized repository holds exactly `.git` and is seedable; treating it as
  populated would refuse the most common way to start.
- **exists and is not a directory** - a regular file at the target path. Neither
  seed nor add can use it. Report it and stop; do not offer add.
- **holds any other entry, with no provenance** - this is someone's existing
  work, not a project this flow started. Do not plan a seed against it. Report
  what was found and put the choice to the developer: a fresh directory to seed
  into, or `frontx add` applied to the directory as it stands - saying, when you
  offer add, that it writes only the ground the template declares and refuses,
  naming the paths, if any of that ground already holds content, so the existing
  work is either left alone or reported, never overwritten.
  **Wait for their answer before running anything**; the choice of what happens
  to their existing work is theirs, and a refusal you could have put to them
  first reads as the flow having tried and failed.
  Planning the seed anyway only earns the CLI's refusal one step later, after you
  have already shown a plan that could not run.

## Step 3 - Select what to apply

Work from the intent, the records from step 1, and the identities from step 2.

1. **Nothing installed.** If `templates` is empty, refuse: selection has nothing
   to choose from. Tell the developer to install a template first (`frontx
   install <source-spec>`) and stop. Run no command that writes files.
2. **Partition by declared description.** Only records carrying a `description`
   are candidates. Set the rest aside, keeping the two causes apart - you will
   report them, and they call for different actions:
   - carries neither key: the template declares no description. It offers nothing
     to match an intent against and stays reachable by its exact reference
     through the direct CLI path.
   - carries `manifestUnreadable`: the template's stored manifest is broken.
     Report it as such and name reinstalling it as the fix. Do not report it as
     declaring no description - that sends the developer looking for a
     better-described template instead of repairing the one they have.
3. **No candidates.** If no record declares a description, refuse: nothing
   matched. List every installed template with the reason it was skipped, using
   each entry's own cause from step 2. Write nothing.
4. **Match.** Compare the intent against each candidate's `description`, reading
   it as the template's own statement of what it establishes and contributes.
   Special-case no identity, no namespace, no naming pattern - the description is
   the whole basis, and a name that looks promising is not evidence.
5. **No match.** If no candidate's description answers any part of the intent,
   refuse: nothing matched. Name the candidates you considered and those skipped,
   each with its own reason from step 2. Choose no nearest match, and write
   nothing.
6. **The seed.** If step 2 found no applied template, the seed is the single
   candidate whose description matches the project-establishing part of the
   intent - the part that says what kind of project this is.
7. **Nothing establishes the project.** If step 2 found no applied template and
   no candidate's description matches the project-establishing part - even though
   some candidate matches a supplemental part - refuse. Name the supplemental
   candidates that matched, and say that none of them claims to establish a
   project: a plan built from them carries no seed and lays no ground, and a
   supplemental template contributes *to* a project, so there would be nothing
   for it to contribute to. That is the whole reason - do not claim the CLI would
   refuse such a directory, because it would not. Ask the developer to install a
   template that establishes a project, or to restate the intent. Write nothing.
8. **A tie is a question, not a coin flip.** If two or more candidates match the
   project-establishing part indistinguishably, refuse: a choice is required.
   Name each tied candidate with its declared description and ask the developer
   to choose. Guessing here writes a project they did not ask for.
9. **Further templates.** For each remaining part of the intent, select at most
   one candidate whose description matches it, skipping any candidate already in
   the plan. **A template contributes to a project once.** A part of the intent
   that repeats a unit inside ground the plan already covers adds no second
   application - see Step 7 (Realize the units the intent names) below.
   **A tie here refuses exactly as an establishing tie does**: if two or more
   candidates match one supplemental part indistinguishably, refuse with a choice
   required, naming that part of the intent and each tied candidate with its
   description. This is not a lesser decision - the identity you pick is the one
   the project carries in its provenance from then on.
10. **Drop what is already applied.** Remove from the plan every identity Step 2
   (Read what the target directory already holds) recorded, and record it as already applied. Re-applying an identity
   re-claims ground it already occupies, and the CLI's conflict check refuses the
   whole operation rather than part of it.
11. **Separate the per-unit work from the residual.** Every part of the intent
    that names a unit living inside a selected or already-applied template's own
    ground is per-unit work, recorded once per unit and attributed to the
    template that owns that ground. It is **not** residual - Step 7 (Realize the
    units the intent names) realizes it.
    Only what no template's description covers and no template's ground contains
    is residual.

## Step 4 - Present the plan before writing anything

Show the developer, and do not proceed past a refusal:

- the template to seed with, with its identity and its pinned `ref`;
- each further template to add, in order, with identity and `ref`;
- each identity dropped as already applied;
- the units to be realized inside the applied ground, and which template owns
  the ground each falls in;
- the residual intent nothing covers.

## Step 5 - Apply, through the executable only

If the plan carries a seed:

```bash
frontx seed <identity> <targetDir>
```

Then, for each further template in plan order:

```bash
frontx add <identity> <targetDir>
```

`<identity>` is the record's `name` from step 1 - the identity the template's own
manifest declares - not its `ref` and not its `source`.

If any of these exits non-zero: stop at that command. Relay its reported reason
unreinterpreted, name the templates applied before it, and run no further
command. Do not retry.

## Step 6 - Report the applied set from provenance

Read `<targetDir>/.frontx/provenance.json` again and report one entry per record:
the identity, the version it was applied from, and its source address. This
record set is the authority on what was applied - report it, rather than
restating what the plan intended.

If the file is absent or unreadable after a command reported success, say the
applied set could not be confirmed and name the target directory. Do not present
an applied set you did not read.

**Then stop. Do not continue to Step 7.** Realizing units needs two things this
failure denies you: which templates are applied, and their bundles to read. With
the applied set unconfirmed both are guesses, and a unit created into ground that
may not be there is worse than a unit not created. Report what you know, point at
the target directory so the developer can establish its state, and end there.

## Step 7 - Realize the units the intent names

The plan stops short of the intent until this step runs. An intent naming two
screens is not delivered by a project with the ground for screens and no screens
in it.

Each applied template materialized its own AI-extension bundle into the project
under `.frontx/ai/<template-identity>/`. **Read those bundles from disk now** -
they are already there, written by the apply you just ran. Find each template's
bundle by its identity-scoped path and each capability inside it by the role its
bundle declares. The skills they contribute are what add a unit to that
template's ground; they, not this document, know how.

Do not wait for the framework's extension host to activate them. That activation
pass runs on the framework's *next* invocation and makes the same capabilities
available as activated resources from then on - it has not run in this session,
and the flow does not need it to have run. What you need is on disk.

**Realize the units one after another, here.** Finish each unit before starting
the next, and hand none of them to a background agent to work alongside the
others. Each unit settles conventions the next one follows, and those conventions
are in this session; a background agent holds none of them and derives them again
from the bundles per unit, arriving at its own answers for questions the previous
unit already closed.

**A unit is finished only when the checks its covering skill declares have run
green on it**, run here, before the next unit is started. Authoring every unit
first and validating once at the end collects each unit's simple errors into a
single block to debug together, when a per-unit check would have named them one
unit at a time, as each unit was written.

**Every ecosystem symbol has an address, so grep the address rather than hunt
for the symbol.** The types and symbols of every `@gears-frontx` package the
project depends on are shipped as declarations under
`<project>/node_modules/@gears-frontx/<package>/dist/`. Grep there first for any
`@gears-frontx` name whose declaration a unit needs; either that directory
carries it or the project does not have it, and the second answer is as usable
as the first. A filesystem-wide search issued from outside the project tree is a
defect, not a search strategy: a run that reached for `find / -iname` was hunting
a type that sat in `node_modules/@gears-frontx/api/dist/` the whole time.

For each unit from step 3.11, in plan order:

1. **Find the covering skill.** Look in the bundle of the template that owns the
   unit's ground for a skill whose declared role is adding a unit of that kind.
   This is the authoritative answer to which template owns the unit - the plan's
   attribution was provisional (Step 3.11), drawn from what descriptions say, and
   is corrected here by what the bundles actually carry.
2. **No covering skill?** Record the unit as residual work, naming the ground it
   falls in, write nothing into that ground, and move to the next unit. A
   template that declares no way to add a unit to its ground is not one to
   improvise into.
3. **Follow that skill, once, for this unit.** Do exactly what it instructs, in
   its order. Touch no ground it does not itself claim. It owns the conventions -
   naming, identifiers, registration, generated artifacts - and you follow them
   rather than inventing parallel ones.
4. **Put the stated content in.** The unit must end up carrying what the
   developer's intent states for *this* unit. How content enters a unit is the
   covering skill's business - follow whatever it says about where a unit's
   content lives and how it is edited; do not assume a shape it did not describe.
   What this document contributes is only the content itself, which nothing but
   the stated intent can supply. A screen the developer described as showing
   something must show that thing: a unit created but left as the scaffold shipped
   it means the unit exists and the intent was not realized.
5. **A failure stops the flow.** If realizing a unit fails, relay the failure's
   own reported reason unreinterpreted, name the applied templates and the units
   realized before it, and realize no further unit. No correction retry.

Then run the verification the covering skills declare for what they created,
exactly as they declare it - this document does not know which checks a given
template names, and must not substitute its own. Hand back a project that builds
and runs, not one that was merely written. When that verification runs across
every workspace in one command, capture it under Step 8's rule for aggregate
runs: whatever the report will quote has to be visible in the output this run
kept.

**When a declared check is performed in a browser, conduct it this way.** Which
checks exist stays the covering skill's to say, and nothing below adds one or
stands in for one. What follows is how the browser is driven and what the run
has to report - which no template declares and every browser run needs.

**`verification-checklist.md`, beside this document, is the browser walk's
definition of done.** This step is the mechanics: how the browser is driven, and
what each incident behind each rule cost the run that learned it. That file is the
accounting layer over the same mechanics - the categories a claim has to satisfy,
each with a stable id, and every item in it tracing back to a rule written out
here. It adds no requirement this step does not already carry.

**Read it in full before the browser walk begins.** It is installed beside this
document, at `skills/project-scaffolding/verification-checklist.md` under the
installed kit root, and the kit declares it as the
`frontx_verification_checklist` resource. Open that path and read it end to end,
first line to last. **A partial read does not count**: a head, a line limit, an
excerpt, a section jumped to, or the table of contents read as if it were the
items. One run read 120 of its 480 lines and asserted every category passed off
the contents list, which named the categories and not one of the items under
them. **A PASS line in the report may be written only against items this run
actually read**, so a checklist read partly is a checklist whose unread items
cannot be passed. Read it before the walk, so the walk is driven toward what will
be accounted for, and walk it again before the report is composed. Step 8 carries
its per-category status, and a category the report leaves out fails there.

**The walk runs the shipped driver.** The kit installs it as the
`frontx_verify_walk` resource, beside this document at
`skills/project-scaffolding/scripts/verify-walk.mjs` under the installed kit
root. Resolve that path from the same installed kit root this document was read
from, and run it:

```bash
node <installed kit root>/skills/project-scaffolding/scripts/verify-walk.mjs \
  --host <dev server origin> \
  --browser-cmd 'npx --yes agent-browser@<the version this run pinned>' \
  --capdir "$CAPDIR" \
  --checkpoints <name>:<destination>:<that point's ready testid>,... \
  --checkpoint-selector '<the reaching control testid, with {checkpoint} or {handle} in it>' \
  --variants registry --variant-registry <file the declared set was read into> \
  --variant-switcher <testid of the control that opens the values> \
  --variant-option '<one value option testid, with {variant} in it>' \
  --overlay-open <testid of the control that opens the overlay the walk operates through> \
  --overlay-close <testid of the control that closes it again> \
  --states <file of declared per-checkpoint interactions> \
  --coverage <targetDir>/.frontx/verification-coverage.md
```

**Only `--host` and `--capdir` are required.** Everything else describes
something this project declared, and this document holds no opinion on whether a
given project declares it. Two of those declarations are axes, and each is
declared whole or not at all: naming part of one is refused before a browser is
reached, and naming none of it is a legitimate invocation the walk performs.

**The `--checkpoint-*` flags declare the points the walk visits, and how each one
is reached.** What those flags describe is mechanical: a name, optionally a
destination the point is loaded at, optionally the handle the walk waits for to
confirm arrival, and optionally one control pattern the walk clicks to move
between the points. What the points *are* - addressable pages, tabs, steps of a
wizard, panes of one composed surface - is that project's own knowledge and
belongs with the template that carries it. **How the walk moves is derived from
what was declared and never from a default:** declare `--checkpoint-selector` and
the walk clicks its way between the points; leave it out and each point is loaded
at its own destination. There is no third reading, so no invocation of this
driver asserts that the project has URL-addressable pages, or a chrome of
controls to click between them.

**A run declaring no checkpoint axis walks whatever `--host` opens, once.** That
is the shape of a project with one surface, and of a project that mounts several
units into one surface concurrently, where there is no one active point to walk
to at all.

**The `--variant-*` flags declare one UI dimension this project varies along.** A
project may vary along none, and many do. Mechanically: a set of values, a
control to click, an option handle per value, and the switcher label each value
is confirmed from. Which dimension a project puts through them - a display mode,
a density, a locale, a layout mode - again belongs with its template.

**A run that declares neither axis is not a narrowed run and is not reported as
one.** Its coverage row records each axis as not exercised, which is a statement
about this run; it does not say the project has no such dimension, which nothing
in this walk establishes and no report may claim.

**A reaching control keyed by something other than the point's short name is
named with `{handle}`.** A host may mark each control with a whole composed
identity rather than a short label, and `{checkpoint}` cannot spell that: one run
found the pattern inexpressible, loaded each destination instead, and then owed
every click by hand. Where `{handle}` appears, the driver takes the id from the
point's fourth `--checkpoints` field when one is declared, and otherwise reads
the ids off the page and keeps the control whose id carries that point's name as
a whole segment - refusing, rather than picking, when none or several do.
`{checkpoint}` is unchanged and costs no read: a host whose controls are keyed by
the short name goes on as before.

**The two `--overlay-*` flags are for a project that draws chrome over the
surface under verification** - a tools panel, a debug drawer, an inspector - and
that declares controls to open and close it. The walk opens it to reach whatever
sits inside, closes it before the first capture, and confirms the close by the
opening control being back on the page. **A project that declares no such overlay
passes neither flag, and nothing in the walk reaches for one.**

`--browser-cmd` is what pins the browser CLI. Left out, the driver falls back to
`npx --yes agent-browser`, which resolves whatever version is newest at the
moment each run asks - so two runs of the same walk can be driven by two
different browsers, and a capture that changed has no fixed tool to be
attributed to. Name the version the run installed, and record it in the report.

An installed binary is named here too, and the value is read as a command line
rather than as one word: quote a path that carries spaces, or the driver is handed
a first word that names nothing and every browser command fails to spawn. Both
quote characters work, and an unbalanced one is refused rather than guessed at, so
`--browser-cmd '"/path/with a space/browser-cli" --headless'` reaches the child as
the path and the flag, each whole.

`node <that path> --help` prints the whole flag surface. `$CAPDIR` is the
run-unique capture directory made under the capture rule below, and the driver
refuses a directory that already holds files rather than write into another
run's captures. The driver exits 0 only when every control it was given dispatched,
every declared variant became active against its own switcher label, every
read-back agreed, and every declared capture landed; on any failure - a refused invocation, an input file
it cannot read, a browser command that stopped answering, an output path it cannot
write - it exits non-zero with the reason in its JSON result, and it never retries
on its own.

The JSON result is what the coverage table and the report are filled from: it
carries, per pass, whether the switcher label confirmed the value became active,
every capture file with the point and the state it was taken at, every
byte-compare verdict with the `cmp` exit code that produced it, every fill and
click read-back with the value read off the page afterwards, and the failure
list. It also records whether each axis was declared at all, how the walk moved
between the points, and where the variant set came from - the registry file, or a
set typed in by hand - so a claim that the set came from the project's own
registration of that dimension is a claim the result file either backs or
contradicts.

Everything from here to the end of this step is **the specification of the
mechanics** - which one exists, and what each cost the run that learned it. Read
it to know what the driver is doing on your behalf, to compose its arguments, and
to drive by hand when you have to.

**The driver performs the walk and nothing else in this step.** It carries
sub-step 1's probe, sub-step 3's native pointer sequence, sub-step 5's whole
variant walk including the byte-compare, the read-backs sub-step 6 requires after
its own clicks and loads, a readiness poll of the shape sub-step 7
prescribes, and sub-step 8's coverage file. **These it does not perform, and a run
owes every one of them itself:**

- **sub-step 4, the address exercise.** The driver never reads a URL back - no
  command in it asks for one - so deep-linking each declared destination,
  clicking the control that reaches another point, and confirming the pathname
  that results is the run's own work, and the CRITICAL addressing items are
  satisfied by nothing else. A run that read the driver as covering them would
  skip the one sub-step whose findings no capture can show.
- **sub-step 2's settling of the starting variant and the one-time handle read.**
  The driver is given its handles as arguments; learning them off the interface,
  and starting the walk from the project's declared default rather than whatever
  an attached profile persisted, happens before it runs.
- **sub-step 6's snapshot reading.** The driver reads back the elements it was
  told about; judging what is on the page at all, and what a compact snapshot's
  silence does not mean, stays with the run.
- **the dev-server rules above** - starting a server with its pid recorded,
  stopping it by that pid, and confirming the ports came back.
- **Step 8's report obligations.** The driver writes the coverage file; the
  report, the per-category checklist walk, and every disclosure this step
  requires are composed by the run from the driver's JSON result.

**Where the applied template brings a verification flow of its own, that flow
leads the design review and this walk keeps the functional side.** A template may
contribute a skill that reviews the rendered interface against a design contract
it also ships. Discover it as a capability rather than by name - a skill of that
kind among the ones the template activated under `.frontx/ai/<template-identity>/`
- exactly as a unit-adding procedure is discovered, because naming a particular
template here would put solution knowledge in the solution-agnostic base. Where
one is present it is authoritative for the question it answers: whether what
rendered is right. This step does not run those checks again, does not restate
their findings as its own, and does not read their presence either as a reason to
skip the walk or as a driver failure to fall back from.

**What stays with this walk in every case is what no design contract answers**:
that every checkpoint the project declared was actually reached, that every
declared value of every declared axis became active against its own control, that
each read-back agreed with the page, and that the coverage file and the report
state honestly what was exercised and what was not. **Neither side covers for the
other.** A design review that passed says nothing about a checkpoint the walk
never arrived at, and a walk that arrived everywhere says nothing about what the
pixels look like. The report carries both and names which produced which.

**Hand-authored browser calls are the fallback, and only when the driver itself
fails.** Not when it is inconvenient, not when its flags need working out, and
not when a hand-written batch looks quicker. Three separate agent hosts driven
from these same sources each wrote a browser driver of their own rather than
follow the prose, and each broke the discipline somewhere different; the driver
exists so the mechanics stop depending on which host is reading.

**Every driver failure and every retry is disclosed in the report** - the number
of attempts, and one line per attempt saying what failed and why. Retrying a
harness failure is legal. Retrying it in silence is not: it turns a run that
needed three attempts into a report that reads like a run that needed one. That
applies to a hand-authored fallback too - state that the driver failed, with its
own reported reason, before the report shows anything the fallback captured.

**The escape hatches this step carries, indexed.** Each is written out in full
at the rule or sub-step named. A run that hits one of these failures goes
straight to it rather than deriving a replacement:

- a click that lands and changes nothing - the native pointer sequence,
  sub-step 3
- text that never arrives, or a wait that times out on text already on the page -
  the shadow-descending poll, sub-step 7
- `Element is covered`, or a capture with host chrome drawn over it - the
  overlay rule, sub-step 5.3
- a snapshot listing none of the text expected - the compact-snapshot rule,
  sub-step 6
- `Element not found` on a selector that reads perfectly well - the
  selector-form rule under "Address every control by the stable handle" below,
  which names the forms this runner resolves and the ones it rejects
- a batch line that blocks for a full timeout, or a wait that matches nothing -
  the argument-vector rule in that same list: a flag-shaped token inside a batch
  line is read as a selector
- a batch that bails on its first click after an `open` - the settle rule in
  that same list

The index exists because these are read once and needed later, mid-failure.
Three separate runs re-derived the native pointer sequence from scratch, one of
them authoring throwaway scripts to do it, while the helper sat in a sub-step
none of them was re-reading at the time.

**Narrow no declared scope without stating the reason in the visible output
text.** The scope this verification declares - every value of a declared variant
axis, every point of a declared checkpoint axis, every state the declared checks
call for - is covered in full. When something forces a narrowing anyway, write into the text the
developer reads, not only into the coverage file, which part of the scope is
being narrowed, what is left out of it, and why. The coverage file records what
was covered and cannot carry the reason, so a narrowing recorded only there
reaches the developer as a bare gap they have no way to judge. An unexplained
narrowing is a verification failure and is reported as one, not a scope decision
this flow was free to make.

**A scope change is declared in both directions, and widening is declared exactly
as narrowing is.** Where the set actually walked is wider than what the
developer's own phrasing asked for - more variant values than the intent named, points
the intent did not mention, states nobody asked to see - the report says so in
one sentence of the same form: asked X, declared set Y, walked Y. Nothing about
walking more is wrong, and everything about walking more in silence is: the
developer reads the coverage table as the answer to the question they asked, and
a table answering a wider question without saying so is a table they cannot size.
The sentence costs one line and it is the only thing that keeps the declared set
and the asked-for set distinguishable in the report.

**The reason has to answer the axis the narrowed check verifies.** A check is
narrowed along the axis it covers, and only a reason on that axis closes it.
The variant walk and the captures under it ask a visual question - what each
state looks like once that value is applied - so no argument about behavior
closes them, however true the argument is. One run drove the interactive states
under the starting value alone and justified it by the state logic never reading
that dimension. That was correct and beside the point: what the walk was there to
establish is whether success, error and added states render differently across
the axis, and only those states rendered under each value can show it. A reason
that argues the wrong axis is an unexplained narrowing.

**Start every dev server with its process id recorded, and stop it by that id.**
Keep the pid the start reports, or use the runner's own stop mechanism where it
declares one, and address the process that way for the rest of the run.
**Stopping by pattern is forbidden.** A pattern matches every process whose
command line happens to contain it, and the shell issuing the kill is one of
them: one run's `pkill -f` matched its own dev server and took down the
environment in the middle of the verification it was running, which then had to
be rebuilt before the run could carry on. A server whose pid the run never
captured is stopped by finding that pid first, not by widening the match.

**A stopped parent is not a stopped server: after the kill, verify the ports are
free.** The recorded pid is the process this run started, not the children it
spawned, and killing it can leave those children running and still bound. One
run killed its recorded pid, reported the server stopped, and left three orphans
holding the ports. So ask the ports themselves, once per port this run started:

```bash
kill <recorded pid>
lsof -ti tcp:<port>
```

Every pid `lsof` prints is a survivor still holding that port. Kill each one **by
that printed pid**, never by pattern, exactly as the rule above requires, and
re-run the `lsof` until it prints nothing. The run is finished with a server when
its ports come back, not when a kill command exits zero.

**Capture into a directory this run created, never a shared fixed path.** Make
it once, before the first capture, with this command:

```bash
CAPDIR="<targetDir>/.frontx/verify-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$CAPDIR"; echo "$CAPDIR"
```

**Every capture path in this walk starts with `$CAPDIR`.** The batch heredocs
below are quoted (`<<'JSON'`), which is what keeps their escaped quotes intact
and also means `$CAPDIR` does not expand inside them - that is why the command
prints the directory: each `screenshot` line is written with the resolved path
in it. Prose describing a run-unique directory was not enough on its own, and a
run under it wrote into a fixed shared path anyway.

A path reused across runs leaves the previous run's files exactly where
this one goes looking: one run found 16 screenshots left by an earlier run in
the shared `/tmp` path it was about to write to, and they were captures of the
very states it had decided not to take. It cited none of them, and nothing
about the path stopped it from doing so. **A claim satisfied by another run's
capture is a false report even when nobody intended it**, because the
byte-compare in sub-step 5.5 and the states-captured cells in sub-step 8 both
address capture files by name, and neither can tell which run wrote them.

**Address every control by the stable handle the interface puts on it, and
drive a whole pass in one invocation.** A run that clicks by accessibility
reference pays for it twice: those references are re-issued on every
navigation and every variant switch, so each interaction costs a fresh snapshot
taken for no reason but to learn the handle again. One measured run spent 24 of
its 87 browser calls that way. Six things make the difference, and all six were
established against this runner rather than assumed:

- **`[data-testid="<value>"]` is the selector form to write, and the pseudo
  forms are not.** Plain attribute and id selectors resolve for `click`, `fill`
  and `get`. `button:has-text('...')`, `text=...` and `role=...[name=...]` each
  come back `✗ Element not found` and exit non-zero - and it was exactly that
  rejection, read as "this control cannot be addressed", that pushed the
  measured run onto accessibility references to begin with. The runner does
  offer the semantic locators as their own subcommands (`find role ... click
  --name ...`), which work; what does not work is folding them into a selector
  string. An `@eN` reference stays valid inside one page lifetime and is
  void after a reload, which is what the variant walk performs at every boundary.
- **Learn the handles once, from the interface itself.** Which controls a host
  marks, and what it calls them, is the host's business - this document names
  no handle and must not. Take one accessibility snapshot at the start of the
  run, locate the controls the declared checks and the sub-steps below reach
  for - whatever control reaches each point, whichever controls open and close a
  declared overlay, the variant switcher and its per-variant options - and read
  each one's `data-testid` off the page. Every command afterwards is written
  against those values, and no further snapshot is taken to re-find a control.
  **The controls inside the surface under verification are learned the same way,
  but not off that snapshot**: its content renders inside a shadow root, so read
  their handles
  with one `npx --yes agent-browser eval` that descends into every `shadowRoot`
  and collects what the scaffold marked:

  ```js
  (() => {
    const found = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('[data-testid]')) {
        found.push(`${el.tagName.toLowerCase()} ${el.getAttribute('data-testid')}`);
      }
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return found;
  })()
  ```

  Every value it returns is written as `[data-testid="<value>"]` from then on,
  exactly as the host's own controls are. A control inside that surface which the
  scaffold marks with nothing is reached by a reference from a snapshot taken at that point,
  and that is the only reason to take a further one.
  **A host that marks nothing has no handles to learn**: fall back to accessibility
  references, say in the report that the interface exposed none, and expect the
  snapshot-per-interaction cost this rule exists to remove.
- **Chain the commands with `batch --bail`, fed as JSON on stdin.** One
  `batch` invocation carries a whole sequence in a single process, which is
  what turns a variant's pass from a dozen round trips into one. Feed it JSON
  rather than quoted argument strings: argument mode re-parses each string and
  strips the quotes inside it, so a handle carrying dots or tildes arrives at
  the runner as an unquoted attribute value and stops resolving, while a handle
  that happens to be a bare word keeps working - which is the worst kind of
  breakage, one that passes on the simple case and fails on the real ids. In
  JSON stdin mode each command is its own argument vector and nothing is
  re-parsed. `--bail` stops at the first failing command and exits non-zero, so
  a pass that broke halfway through cannot be read as one that ran.
- **A batch line is an argument vector, so every argument in it is positional
  and bare.** A flag-shaped token is not read as a flag: `["wait", "--ms",
  "800"]` hands `--ms` to `wait` as the *selector* to wait for, and the line
  then sits out the full 25s default timeout before failing. **A wait is written
  `["wait", "800"]`** - the
  milliseconds as a bare string, nothing else - and every other line reads the
  same way: what follows the op name is its operands, and a token starting with
  `-` becomes one of them rather than a switch.
- **After an `open`, the next line settles the page; it does not interact with
  it.** A batch that chains `["open", "<destination>"]` straight into a click on
  a handle inside the page bails on that click: the load is still in flight, the
  handle is not in the document yet, and `--bail` stops the pass on a page that
  was about to be fine. Follow every `open`, and every other load, with
  `["wait", "800"]` or an `["is", "visible", "[data-testid=\"<a handle that page
  shows>\"]"]`, and put the first interaction after that. The addressing
  batch in sub-step 4 carries its `snapshot` line in exactly that position; a
  batch composed here needs the settle written in.
- **`get` prints, `is` enforces, and `fill` does neither.** A `get text` line
  hands its answer back for the run to read, and the run has to read it,
  because the batch carries on either way. An `is visible` line exits non-zero
  when the element is absent, so under `--bail` the runner itself stops the
  pass when that confirmation fails - which is why the confirmations below are
  written as `is visible` wherever the expected state is an element being
  there. `fill` reports `✓ Done` even when its selector matched nothing, typing
  into whatever held focus instead; confirm every fill with a `get value` on
  the same handle rather than believing its exit code.
  **A plain CSS selector aimed at that content is that case by
  construction.** The fields live in a shadow root and an outside selector
  does not see in, so `fill input[name=...]` matches nothing, types into
  whatever held focus, and still reports success - one run filled a form that
  way and read the report as proof the form worked. Fill those controls by the
  testids read in the handle-learning rule above, and let the `get value` this
  bullet already requires be what establishes the text landed where it was
  aimed. Where a control carries no testid, drive it by a reference from a
  snapshot taken at that point, and read it back the same way.

Carry the run out in this order:

1. **Probe before launching.** Ask `http://localhost:9222/json/version` once.
   When it answers, attach to the browser already listening there with
   `npx --yes agent-browser connect 9222`. When it does not, launch one with
   `npx --yes agent-browser`. The probe is a single request, and it is worth
   making every time: a self-launched browser has hung mid-run where an attached
   one returned every capture asked of it.
2. **Read the interface's active variant before verifying anything, and switch to
   the host's default variant before the first capture.** An attached browser
   brings its profile's persisted selection with it, so the interface can open in
   a variant nobody in this run chose, and every capture after that silently
   belongs to that variant. Read the active variant off the variant switcher's own
   label, by the rule the variant walk states below: a screenshot's file name
   records what the run assumed, not what was on the page.

   **This is also where the run learns its handles.** The snapshot taken to find
   the switcher is the one snapshot the selector rule above allows for locating
   controls, so locate the rest of them from it in the same pass - the controls
   that reach each point, a declared overlay's two controls, the switcher's
   per-variant options - and read each one's `data-testid`. Everything after this
   sub-step is written against those values, and settling a declared overlay's
   closed state here is what lets each variant's block run without a branch.
3. **Dispatch native pointer events when a click changes nothing.** A synthetic
   `.click()` arrives at the element carrying none of the pointer sequence around
   it, so a control listening for `pointerdown` sees nothing at all and the page
   stays as it was. Do not retry the synthetic click, and do not record the
   control as broken. Re-issue that one click as the full native sequence through
   `npx --yes agent-browser eval`:

   ```js
   (() => {
     const el = document.querySelector('<selector>');
     if (!el) return 'not found';
     const box = el.getBoundingClientRect();
     const init = {
       bubbles: true, cancelable: true, composed: true,
       clientX: box.left + box.width / 2, clientY: box.top + box.height / 2,
       pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
     };
     const up = { ...init, buttons: 0 };
     el.dispatchEvent(new PointerEvent('pointerdown', init));
     el.dispatchEvent(new MouseEvent('mousedown', init));
     el.dispatchEvent(new PointerEvent('pointerup', up));
     el.dispatchEvent(new MouseEvent('mouseup', up));
     el.dispatchEvent(new MouseEvent('click', up));
     return 'dispatched';
   })()
   ```

   Put the control's own selector in `<selector>`. When the control lives inside
   a shadow root, resolve it through that host's `shadowRoot` rather than
   `document`, which does not see in. Then confirm the outcome the way every
   other click is confirmed here, under sub-step 6: by reading the resulting
   state back off the page, never off the command's own `✓`.
4. **Where the project's points carry their own addresses, exercise them before
   the variants are walked.** Whether they do is the applied template's
   declaration and never this document's assumption: a template whose units
   declare a destination each - a `route`, a path, whatever that template calls
   it - states so in the skills it activated under
   `.frontx/ai/<template-identity>/`, and that is the only place this run learns
   it from. A project whose points carry no address of their own, or that mounts
   several units into one surface at once, has nothing here to exercise, and the
   run reports the category as not applicable naming that declaration. **No field
   named here is an ecosystem guarantee** - the runtime declares no
   extension-domain values and no addressing model, so a destination read "out of
   the manifest" is read out of a manifest the template's own conventions shaped.

   Where they do carry addresses, the address is part of the surface under
   verification: the host mounts the unit whose address matches the URL at load,
   and a click on a reaching control puts that point's address into the address
   bar. Neither fact shows up in a capture, so both are established here, in the
   variant the run is currently in. Take each realized point in turn, one batch
   each:

   ```bash
   npx --yes agent-browser batch --bail <<'JSON'
   [
     ["open", "<dev server origin><this point's declared destination>"],
     ["snapshot", "-i"],
     ["click", "[data-testid=\"<the control that reaches another point>\"]"],
     ["get", "url"],
     ["snapshot", "-i"]
   ]
   JSON
   ```

   1. **Load that destination hard** - the `open` line, a full load of the dev
      server's origin with that destination as the path, not a click - and
      confirm from the snapshot after it that this is the point that mounted. A
      deep link that lands somewhere else is a defect. The snapshot earns its
      place here under sub-step 6: the question is what mounted, and only a
      reading of the whole page answers it.
   2. **Then click the control that reaches another point and read the address
      back** - the click, the `get url`, and the snapshot after them. Confirm the
      path in the URL now equals that point's declared destination, and confirm
      from that last snapshot that it is the one mounted. `get url` is the
      reading to take rather than a scripted `location.pathname`: it is a
      command like the others, so it rides in this same batch instead of costing
      its own invocation. A point that mounts while the address stays where it
      was is a defect too - the URL is what a developer copies, bookmarks and
      reloads. **This half is skipped, and reported as not applicable, where the
      project declares no control to click between its points** - where they are
      reached from inside the content, from a command surface, or not at all
      because there is one of them.

   **A failure here is a defect to report, not a sub-step to skip.** Report the
   destination asked for, what mounted, and the pathname read back, and report
   the project as not verified for addressing. One run inherited its addressing,
   opened no deep link, read no pathname, and handed back a report that never
   mentioned it at all: an address left unexercised is reported as unexercised,
   never as absent, and a category genuinely out of reach is reported as not
   applicable with the project's own declaration named as the reason.
5. **Establish whether this project declares a variant axis, and if it does,
   enumerate every value of it and walk them.** A variant axis is one UI
   dimension a project varies along; which dimension that is, and whether the
   project has one at all, is stated by the template the project was applied
   from and never assumed here. **A project that declares none walks its declared
   points once** - or, where it declares none of those either, whatever its host
   opens - records the axis as not exercised, and is complete at that: sub-steps
   5.2 and 5.5 below have nothing to act on, and the rest of the block runs
   unchanged. Nothing in that outcome is a narrowing, and it is never written up
   as one.

   Where an axis is declared, **the project's own registration of that dimension
   is the source of truth for the set** - not the value the browser opened in,
   and not the entries a switcher happens to show. Read the set from that
   registration - the source file where the values are declared, or the list it
   exports - and only then open the switcher, which from that point serves to
   apply each value and nothing else. A dropdown enumerates what the switcher
   chose to offer, which is not necessarily everything declared: one run took its
   set from the switcher's own entries and happened to match, a match it had no
   way to confirm and did not. This is the one thing read from source in this walk, and
   it is read for the set alone - which value is active at any moment stays the
   switcher label's to answer, under sub-step 5.2 below. **The walk covers every
   value that registration reports, and that set is not negotiable**: no sample,
   no representative subset, and no value set aside as out of scope for this run.
   The count of declared values and the count of walked values are the same
   number. A run that walks fewer has narrowed a declared scope, so it states the
   reason in its output text under the rule above and reports itself as not
   verified for every value it left out.

   **Take each declared value in turn, and drive its whole pass as one
   invocation** rather than as a click-by-click conversation. The handles come
   from the one-time read in the selector rule above; the value's own option
   handle and the points' reaching handles are the per-value and per-point parts.
   The two overlay lines below are present only where the project declares such
   an overlay, and the reaching click only where it declares a control to click:

   ```bash
   npx --yes agent-browser batch --bail <<'JSON'
   [
     ["reload"],
     ["click", "[data-testid=\"<the overlay's opening handle>\"]"],
     ["click", "[data-testid=\"<the variant switcher's handle>\"]"],
     ["click", "[data-testid=\"<this variant's option handle>\"]"],
     ["get", "text", "[data-testid=\"<the variant switcher's handle>\"]"],
     ["click", "[data-testid=\"<the overlay's closing handle>\"]"],
     ["is", "visible", "[data-testid=\"<the overlay's opening handle>\"]"],
     ["click", "[data-testid=\"<the handle that reaches a point>\"]"],
     ["screenshot", "<$CAPDIR resolved>/<variant>-<checkpoint>-fresh.png"]
   ]
   JSON
   ```

   The last two lines repeat, one pair per point under verification. The
   interactions the declared checks call for then follow as a second batch of
   the same shape - the driving clicks and fills, each state's own `screenshot`
   line after them, and a `get value` after every fill under the rule above.

   **Where an overlay is declared, the block ends with it closed, and that is
   what lets the next pass's block start with a bare opening click.** Settle the
   starting state once, before the first pass, and the walk needs no branch
   anywhere. If the block stops on its opening line, this host brought the
   overlay back open across the reload instead: drop that line, re-run the block,
   and use the shorter form for every remaining pass, because which of the two a
   host does is fixed for that host and is now known. Either way `--bail` turned
   an unknown into a stated fact at the cost of one failed invocation, and no
   capture was taken while the answer was still open.

   Packaging the pass this way changes what it costs, not what it checks. Each
   line still answers to one of the sub-steps below, and every one of them
   holds:
   1. **Reload the page and wait for it to come back** - the block's first
      line. This is the pass boundary reset. It discards every field filled,
      item added and dialog opened during the previous pass, so the captures
      below start from a state this run knows rather than from wherever the last
      pass's interactions left the app. Reload for the first pass too: the
      browser arrived carrying a profile, not a fresh application.
   2. **Switch into the value, then confirm the switch landed** - the two clicks
      that open the switcher and pick this value, and the `get text` line after
      them. That line prints the switcher's label, and the label has to name the
      value just selected. **This whole sub-step belongs to the variant axis: a
      run that declares none has no switcher to operate and no label to read, and
      skips it.** Where an axis is declared, **the switcher's label is the only
      source of truth for which value is active.** Do not probe `data-*` attributes, CSS classes or computed styles
      to detect it, and do not go reading shell or package sources for where a
      variant is applied. Host implementations vary, which is precisely why the
      check is a label check: one run lost its budget to a DOM probe that
      answered `unknown` and a source hunt after it, then fell back to the label
      this sub-step already prescribed. **This is the one confirmation the batch
      will not make for the run**: `get text` prints and moves on, so a block
      whose label line came back naming the previous value has still run every
      line after it, captures included. Read that line. A label still naming the
      previous value means this one never became active, so record it as
      not-active with that as the reason, discard what the block captured under
      it, capture nothing in it as verified, and take the next value.
      **Names it, rather than carries its name somewhere.** The value's name has
      to occupy whole words of the label: a label reading "Denser" does not
      confirm `dense`, and "Length" does not confirm `en`. A set holding such a
      pair - two names one label could name at once - is refused before the walk
      rather than resolved by guess, and `--variant-labels` is where each is given
      a label of its own.
   3. **Where the project declares an overlay the walk operates through, close it
      before the first capture in this variant** - the closing click and the `is
      visible` line after it. **Whether there is one at all is the applied
      template's declaration**, stated in the skills it activated under
      `.frontx/ai/<template-identity>/`; a project that declares none has no such
      pair of lines in its block, and the accounting reports the category as not
      applicable naming that. An open tools panel, debug drawer or inspector is
      host chrome drawn over the surface under verification, not part of it.
      **A capture taken while it covers that surface is not a valid baseline**
      and neither is a click aimed through it: one run lost its first pass's
      baseline that way, and another lost a pass aborted by `Element is covered`
      before closing the overlay and starting over. Here the confirmation
      enforces itself - the opening control is only in the document while the
      overlay is closed, so `is visible` on it exits non-zero and `--bail` stops
      the block before a single capture is taken. The line sits inside every
      pass's block, not once at the start of the walk, because the reload at each
      pass boundary can put the overlay back.
   4. **Capture every point under verification in its fresh state first** - the
      reaching click and `screenshot` pairs that close the block. This is the
      state the reload left the surface in, before anything is filled, submitted
      or added in this pass. The interactions the declared checks call for follow
      in the second batch, each with its own capture.
   5. **Byte-compare this pass's captures against the previous pass's.** This
      sub-step belongs to the variant axis too: a run that declares none takes
      one pass, has no pair to compare, and records the comparison as not made
      for that reason. Where an axis is declared, for each point and state, run
      the comparison as a command over the two capture files and read the verdict
      off what it returned:

      ```bash
      cmp -s <previous-pass-capture> <this-pass-capture>; echo "cmp exit $?"
      # or, when hashes are preferred:
      shasum -a 256 <previous-pass-capture> <this-pass-capture>
      ```

      `cmp -s` exits 0 for identical files and 1 for differing ones; two hashes
      are identical or they are not. **The coverage cell cites that result - the
      exit code, or the two hashes - and is filled from nothing else.** Opening
      the two captures and judging them different by eye is not a comparison, and
      a cell filled that way reports a fact the run never established, however
      honestly the eye judged it. A capture pair the command was never run over
      gets no verdict: record it as not-compared and say so in the report.
      Identical captures are a recorded fact, not a failure: two declared values
      can differ only in tokens the surface under verification never consumes, and
      a report that passed them as visibly distinct claimed something the run did
      not see. The first value has no predecessor to compare against.
6. **Read state back after every click and every load, from something
   that looked at the page.** `✓ Done` is the runner reporting that it issued a
   command, and it is never the reading. Two readings qualify. When the run
   already knows which element carries the answer, a `get text`, `get value` or
   `is visible` line on that element's handle is the reading, and it costs
   nothing extra because it rides in the same batch as the click. When the run
   needs to see what is on the page at all - which controls exist now, what the
   load mounted - the reading is the accessibility snapshot, `npx --yes
   agent-browser snapshot -i`. Reach for the snapshot for that question and not
   as a reflex after every click, which is the habit that cost the measured run
   24 of its 87 calls. A text-wait qualifies as neither: it does not see into a
   shadow root, so it times out on text that was on the page the whole time. When
   a wait is what is needed, take it from sub-step 7.

   **What a compact snapshot leaves out is not evidence of anything.** It
   enumerates the interactive nodes; static text, and the list structure around
   it, are absent from perfectly sound markup by construction. Judge static
   content by a screenshot or by reading the DOM through `npx --yes
   agent-browser eval`, and never from the snapshot's silence. **A snapshot-only
   signal is not grounds for touching product source.** One run read that
   absence as broken list semantics, stopped its dev servers, added redundant
   roles to the unit's own source, and then concluded it had never been a real
   defect - by which point the edit and the lost environment were the run's only
   lasting output.
7. **Wait for text with the shadow-descending poll below, not with `wait
   --text`.** `wait --text` searches light DOM only, and this stack renders inside
   shadow roots, so it spends its whole timeout on text that was already on the
   page, and one run spent three such timeouts before reading this. Reach for
   `wait --text` only for content known to live in light DOM. For everything else, poll through
   `npx --yes agent-browser eval`:

   ```js
   (async () => {
     const needle = '<text>';
     const timeoutMs = 10000;
     const pollMs = 250;
     const holds = (root) => {
       const scope = root === document ? document.body : root;
       if (scope && (scope.textContent ?? '').includes(needle)) return true;
       for (const el of root.querySelectorAll('*')) {
         if (el.shadowRoot && holds(el.shadowRoot)) return true;
       }
       return false;
     };
     const deadline = Date.now() + timeoutMs;
     for (;;) {
       if (holds(document)) return 'found';
       if (Date.now() >= deadline) return 'not found';
       await new Promise((resolve) => setTimeout(resolve, pollMs));
     }
   })()
   ```

   Put the text to wait for in `<text>`. `holds` reads the light DOM once and
   then descends into every element's `shadowRoot` recursively, so text at any
   nesting depth is seen. `found` means the text arrived; `not found` means it
   did not arrive inside the timeout, which is a real absence to act on rather
   than a blind spot to wait out again. If the runner hands back the promise
   instead of its value, set `timeoutMs` to 0 and re-issue the helper until it
   returns `found` or the wait budget is spent.
8. **Write the coverage table to a file.** The verification's deliverable is
   `<targetDir>/.frontx/verification-coverage.md`, beside the project's provenance
   record, written **before the final report is composed** and holding one row per
   pair the walk covered - every pass of the variant axis against every point of
   the checkpoint axis - each carrying its own captures and its own byte-compare
   verdict from sub-step 5.5:

   ```markdown
   | Variant | Active | Checkpoint | States captured | Visually distinct from previous |
   |---|---|---|---|---|
   | <declared value> | verified / not-active (reason) | <declared point> | <state> (<capture file>), <state> driven, not captured | <state>: differs (cmp exit 1) / <state>: identical (cmp exit 0) / not-compared (reason) / first variant |
   ```

   **The rows are the product of the axes, not a column per point.** A column per
   point could only be written once the points were known and fixed, which is
   exactly what this walk does not assume: the points are the project's, their
   number is not this document's to predict, and a project declaring none still
   has to produce a table of the same shape.

   The distinctness cell carries the comparison command's own result, in the
   parentheses shown - the `cmp` exit code, or the differing hashes. A cell
   without one is a cell no command backed.

   **A run that declared no variant axis writes the rows its one pass earned**,
   with `(none declared)` where a value would stand and `not-exercised (no variant
   axis was declared for this run)` in the cells that axis owns; **a run that
   declared no checkpoint axis says the same about that axis** in the cell that
   would otherwise name the point. That wording is the point of the row: it says
   what this run did not do, and it does not say the project has no such
   dimension. `no` and `none` both read as the second claim, and neither this walk
   nor the report built on it establishes it.

   Every declared value gets a row per point, including each value recorded as
   not-active. A state is the moment a capture was taken at, named for what the
   surface held then: a form in its fresh state after the boundary reload and
   after it is submitted, a list fresh and after it changes. Name a state `fresh`
   only for a capture taken after that reload and before any interaction in this
   pass - calling a later capture fresh reports a state this run never saw.

   **A states-captured cell names a state only when a capture artifact of that
   state, in that pass, exists.** The test is whether there is a file or a
   snapshot to point at, not whether the interaction looked like it worked.
   Name, per state, the capture it is claimed from - the screenshot's file name,
   or the accessibility snapshot taken at that point - in the cell itself or in a
   notes line under the table. A state this pass only drove - a control clicked,
   a form submitted, and the run moved on taking neither screenshot nor snapshot
   - is listed apart from the captured ones, as `<state> driven, not captured`.
   **Listing it among the captured states is a false report**: one run wrote
   `fresh, submitted` on the row of every declared value when a post-submit
   capture existed for the first value alone, and reported screenshots and
   snapshots as confirming all of them. A state captured under one value is
   captured under that value only, and every other row is filled from that value's
   own artifacts.

   Step 8 carries this file's content verbatim. The file is the deliverable, not a
   suggestion - a run that composed a report without writing it did not complete
   the verification, whatever the report concluded.

**If a declared verification fails**, stop there. Report the project as applied
and realized but **not verified**, relay that verification's own output
unreinterpreted, and name the units it covered. Do not report scaffolding
complete, and do not attempt a correction retry - the same rule that governs a
non-zero command exit governs this. A failing type-check or lint is the whole
difference between a project that was written and one that works, so reporting
success over it would hand back the one problem this step exists to catch.

## Step 8 - Report

**The completion test for this step is a file on disk.** Where step 7 performed a
browser verification, this step is not complete until
`<targetDir>/.frontx/verification-coverage.md` exists at that path and holds the
coverage table. Check for it, by reading that path, before the report is
composed. A table written into the report, a table shown in the conversation, or
a table the driver printed and nobody kept is not that file and does not stand in
for it: the developer keeps the project, not the transcript, and the coverage
record has to still be there tomorrow. One run published a complete-looking
coverage table and wrote nothing to disk, and its verification ended when the
conversation scrolled. A report composed over an absent coverage file states that
the file is absent and reports the verification as not complete.

Report, in this order:

- the applied set, as read from provenance in step 6;
- the units realized, and what each carries;
- the coverage table any browser verification in step 7 wrote, **reproduced in
  full inside the report**, row for row and column for column, followed by the
  path of the file it was reproduced from. **Fenced or as rendered markdown, both
  satisfy this**: what is required is the faithful reproduction of every row, not
  the fencing around it. A link, a file name, a row count or a sentence
  summarizing what the table says is still not acceptable in its place: the
  reader is being told what was verified, and a pointer tells them where to go
  look instead;
- the outcome of step 7's address sub-step, one line per realized point: the
  declared destination it was deep-linked at, what mounted there, and the
  pathname read back after the click that reached the next one. A report silent
  on addressing reads as a surface nobody exercised, because that is what it is -
  and where the project declares no addresses, or no control to click between its
  points, the line says so and names that declaration;
- **the per-category status walk of `verification-checklist.md`**, written out
  below, and the verdict line the walk decides;
- **the attempt record**: how many verification attempts this run made, and one
  line per attempt naming what failed and why. A single clean attempt is written
  as one line saying so;
- the residual work - only the intent that no applied template's ground contains
  and no activated skill covers.

**A FAIL on any CRITICAL item decides the verdict line, and no wording gets
around it.** The report carries a verdict line, and where any CRITICAL item of
the checklist is FAIL, that line says the verification did not pass. There is no
form of words that converts it into something else. Restating it as "hygiene
gaps", as "minor findings", as "notes for follow-up", or closing the report with
"residual: none" over a standing CRITICAL FAIL is not a summary of the run - it
is the report stating something the run established the opposite of, which is the
one thing the checklist exists to stop. The checklist records that as a VER-NO
violation in its own right, on top of whatever the original FAIL was. A run that
walked the categories honestly and then softened the verdict has failed the
verification twice.

**Every attempt is disclosed, and a retry is only legal disclosed.** Verification
attempts fail for reasons that have nothing to do with the project: a driver that
could not reach the host, a browser that hung, a dev server that had not finished
starting. Retrying those is right. What is not permitted is a report shaped like
the last attempt was the only one. Name the attempt count, and for each failed
attempt name what failed and the reason it reported, before the report shows what
the successful attempt captured. **An undisclosed retry invalidates the whole
report** under VER-REPORT, however sound the final attempt was, because a reader
cannot tell a first-time pass from a fourth-time pass and the difference is
exactly what tells them how much to trust the environment. A retry meant to make
a *failing declared verification* pass is a different thing and is forbidden
outright under the no-correction-loop rule; disclosure does not make that one
legal.

**Walk every category of the checklist, one line each.** The file beside this
document partitions the browser walk into categories with stable ids, and the
report states each one's outcome in the form that file's Reporting section fixes:

```text
<ID>: PASS | FAIL (<what the run did not establish>) | N/A (<why out of reach>)
Verdict: the verification passed | the verification did not pass (<the CRITICAL items that failed>)
```

Take the categories in the order the checklist lists them and leave none out.
The verdict line follows the walk and is decided by it, not written before it.
**An unmentioned category is a failure of the report, not of the run** - the run
may well have satisfied it, and a report that does not say so has not established
that it did. A blanket sentence covering several categories at once is not a walk:
each id gets its own line, and a PASS is claimed only where this report carries
the evidence that category's items ask for. `N/A` is available only for the
categories the checklist's own Applicability section admits it for, with the
reason; a category the run skipped is a FAIL. **A PASS is also claimed only
against items this run read**, under the full-read rule in step 7: a category
whose items were never read cannot have been checked, whatever the walk asserts
about it.

Prose alone did not carry this. Two runs re-derived facts that were sitting in
this document, already read, because nothing made them account for each one by
name. Walking a fixed list of ids is what makes an omission visible - to the run
writing the report, and to the developer reading it.

**Publish only numbers a command printed.** Test counts, lint counts, file
counts: find the summary line the command printed, read the figure off that line,
and name the command it came from. Do not recall a figure from earlier in the
session, and do not carry one over from an earlier run. **Before any figure is
written down, point at the captured output line that carries it verbatim** - a
figure no captured line carries is not a figure this run measured.

**When no command printed a grand total, the report carries no grand total.** An
aggregate run that prints one summary line per workspace has printed
per-workspace figures and nothing else. Publish those lines as they stand, every
one of them, and publish no number standing for the repository as a whole. A
per-unit run is the same: publish the two per-unit lines and stop there. The
words `N tests total` may appear only beside the output line that itself contains
`N`.

**Adding the summary lines up yourself is the failure this rule exists to stop.**
Two consecutive runs teed the aggregate run correctly, grepped every workspace
summary line correctly, then summed those lines themselves and shipped a
repository-wide total no command had printed - the second reported 693 tests
total where the captured lines summed to 737. Arithmetic performed over captured
lines yields a number the run never observed, and a total the report never read
off a command's own output is a total the report invented.

**Capture the aggregate run whole, so that rule has something to read.** The run
whose figures the report quotes - the one covering every workspace at once - is
captured without truncation that can hide a workspace's summary. Do not pipe it
through `tail` or `head`: each cuts from one end, and the workspaces printed at
the other end disappear with their summary lines, which is exactly how a run
reported four of its nine figures off an earlier failed run and never observed a
ninth workspace at all. When the output has to be reduced, filter **for** the
summary lines instead of slicing the stream, and keep the whole log beside it:

```bash
<declared test command> 2>&1 | tee <targetDir>/.frontx/test-run.log \
  | grep -E '<the per-workspace result line pattern>'
```

Then, reading figures off that capture:

- **Take every total from the last fully green run and from no other.** A figure
  read off a run that failed, or off a run that predates the fix, is not this
  project's result, however unchanged that workspace looks. A green run replaces
  the earlier output entirely; it does not top it up.
- **Report no figure whose workspace summary was never observed in captured
  output.** Do not infer it from the workspaces around it and do not drop the
  workspace silently. Name it, say its result was not captured, and re-run to
  capture it.

**Every figure in the report postdates the last source edit.** A gate's numbers
describe the tree as it stood when that gate ran, so a source file changed
afterwards voids them - all of them, not only the ones covering the file that
changed. When it happens, re-run the unit legs and then the aggregate gates, and
report from that run alone. One run edited a unit's source after its final aggregate
gates, re-ran only that one unit's own checks, and published root-level numbers
that predated the source they were presented as measuring: the numbers were
real, and they were not this project's.

## Worked shape

A developer asks for a console with two screens and says what each shows.

- Step 3 selects one template whose description says it establishes a runnable
  application, and one whose description says it contributes the ground that
  isolated UI units live in. That is two applications.
- The two screens are **not** two more applications. They are two units inside
  the second template's ground, recorded as two pieces of per-unit work against
  its single application.
- Step 5 seeds with the first and adds the second. Step 7 runs that second
  template's own activated unit-adding skill twice, once per screen, and puts
  each screen's stated content into the unit it created.
- What comes back is a project with both screens in it, built and running.
