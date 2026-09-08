# Contract harness pilot notes

Cost and deviation log for the component-contract pilot (Accordion,
DataTable). English, factual, one section per pilot component. Written by
the developer who built the harness, for whoever decides whether to extend
contract coverage past the two pilot components.

How the types the harness produces relate to each other is not repeated here:
the domain model - the diagram and the relationship table - lives in section
3.1 of the package DESIGN (`packages/ui-kit/architecture/DESIGN.md`), and the
numbered instructions the code carries markers into live in the feature spec
(`packages/ui-kit/architecture/features/component-contracts/FEATURE.md`).

## A prop of the primitive is the component's API, not forwarded surface

**Observed.** Every prop declared outside the component's own file was filed
as inherited, and every inherited prop was written into a generated
passthrough type keyed by the ORIGIN of the declaration - one file per Base UI
primitive part, five of them, 224 to 233 properties each, 732 to 764 lines
each. Two things were wrong with that, and only one of them was about size.

The first is what an evaluation measured: an agent asked what Accordion's
`value` and `defaultValue` accept answered "plain strings". Those are the
root's own API - Base UI declares them in `AccordionRootProps`, the kit
forwards them, and `accordion.md` documents them as kit-level props - and they
were entry 200-something of a file whose title said "the props a kit component
forwards to an underlying `<div>`". Nine of the root's props were in there
with them: `multiple`, `onValueChange`, `hiddenUntilFound`, `keepMounted`,
`disabled`, `loopFocus`, `orientation`. A reader looking for the Accordion's
API found `className` and nothing else in `properties`.

The second is that the files were derived per component at all. React's DOM
attributes for a `<button>` are the same attributes for every component that
renders one, so five derivations produced five near-copies whose only real
differences came from the compilation that printed them - a union's member
order, an `import("...")` specifier - which is why the harness needed an origin
key, a collision check, a `generated_from` ownership list and a freshness
comparison to keep five copies of one fact from overwriting each other.

**Changed.** The extractor files a prop by its declaration site into one of
three sets (`classifyDeclarationSite`): the component's own source, the
primitive library's props for the part it wraps, or React's DOM attribute
types. The middle set reaches the contract's own `properties` next to the
declared props, with its real type where the provider-safe subset can express
one and the checker's printed type text where it cannot. React's attributes go
through one hand-written schema per host element - `passthrough/dom_button.json`,
`passthrough/dom_div.json`, about forty lines each: the common attributes, the
element's own, and the `^aria-`/`^data-`/`^on[A-Z]` patterns. A prop declared
in none of the three places is named in `unclassifiedProps` and the compiler
refuses the component, because which side of the line it falls on is a
question about that library's conventions.

Accordion's root went from 1 property to 11, and `value`/`defaultValue` now
carry `TS: AccordionValue<Value> | undefined` where the file used to carry
`{}`. Button went from 6 to 9. The five generated files, the origin registry
(`resolvePassthroughOrigin`, `baseUiOriginFromDeclarationFile`), the collision
check, `generated_from` and the generated files' freshness comparison are all
gone: with one hand-written file per element there is no ownership to track and
nothing to regenerate.

**Decisions taken along the way.**

- **The origin key is gone, but comparing the surface across a move is not.**
  The origin registry existed to keep five derivations apart; nothing keeps two
  hand-written files apart, so it went with them. The compatibility check still
  reads the host element from BOTH revisions of a contract and compares the two
  surfaces: a component re-rendered from a `<button>` over a `<div>` stops
  forwarding `type`, `form`, `name`, `disabled`, `value` and `autoFocus`, which
  is a real narrowing a consumer feels. Dropping that comparison along with the
  registry would have reopened a hole closed one commit earlier.
- **Only the element kinds the kit renders are committed.** `dom_button` and
  `dom_div` are what the three described components resolve; `dom_anchor` and
  `dom_input` are not written, because a committed schema no contract composes
  is a file nothing checks and nothing reads. A kind with no file fails the
  compile by name, which is the point at which somebody decides what that
  element accepts.
- **No overlay field for the host element.** The extractor resolves it for all
  seven contracts, and a component with forwarded DOM props and no resolvable
  element is refused naming the props - the same shape as the refusal for props
  whose declaration site cannot be placed. An authored `element:` would be a
  second writable statement of a fact the extractor owns, in the same commit
  that removed one of those from `composition.parent`.
- **`className` stays a declared prop.** Every kit component redeclares it
  narrower than Base UI's `string | ((state) => string)`, and the element
  surface declares it as a plain string. The two agree, and the contract
  carries the component's own declaration - the element surface is a shared
  statement about the element, not a claim to own the name.

## Composition: children optional, parent derived

**Observed.** `composition.children` was required, so a component with no
answer had to invent one: DataTable said `kinds: [none]` (correct - it renders
its Table internally), but a layout component that accepts whatever a consumer
puts in it had only two options, both false - enumerate a kit it does not know,
or claim `text`. And `composition.parent` was authored, which made it a claim
about somebody else's contract: AccordionTrigger stated "I go inside
AccordionItem" while AccordionItem's own `children` list was free not to
mention triggers at all. The pair could disagree, and only a conformance test
comparing them would ever notice.

**Changed.** `children` is optional; its absence means unconstrained, and
`none` keeps its exclusivity - a list that pairs it with anything else says
both that nothing may appear inside and that something may. `text` gained a
definition in the vocabulary type rather than in prose beside it: a
non-component React node - a string, a number, a fragment, a formatted inline
element - never a kit component, which would be a reference instead. `parent`
is computed at compile time from every other overlay's `children.kinds`
(`deriveParentKinds`) and an overlay that writes it is refused, pointing at
`mounts_in`. The two directions of one relationship cannot disagree any more,
because there is one statement and `parent` is a view of it.

**Decisions taken along the way.**

- **Derived from overlays, not from committed contracts.** An overlay is the
  authored source, so a derivation taken from it is right even while a
  committed contract is stale - which is the state every recompile passes
  through. It costs a directory listing and a YAML parse per described
  component; no TypeScript program is built.
- **A third widening signal for the guard.** Because a children list decides
  another component's derived parent, an overlay edit can move a contract in a
  directory the change never touched. `touchesAnyOverlay` widens the guard to
  every covered component, kept distinct from the tooling and allowlist
  signals so the guard's own output still says which reason applied.
- **A mount point outside the kit takes the external form, under its own key.**
  `composition.mounts_in` is authored and merged into the derived `parent`, the
  same `{ external, note }` shape `dont_use_when.instead` already uses. It is a
  separate key because `parent` is not authorable: DataTableSortButton's real
  mount point is a `ColumnDef`'s `header` render function, which TanStack Table
  owns, and the typed reference covers kit-to-kit nesting only.

## Assumption kinds, and the pairing they make checkable

**Observed.** `coverage.assumptions` was a `claim`/`reason` pair, and four
entries across three overlays said "JSON Schema has no notion of a generic type
parameter" in four different sentences. Nothing could tell that family of claim
apart from "this part wraps two Base UI primitives" or "its mount point is
outside the kit", so nothing could ask the question those four sentences were
answering by accident: does every prop the schema cannot type have an entry?

**Changed.** Every assumption carries a `kind` from a closed list -
`untyped_prop`, `hidden_part`, `external_mount`, `behaviour` - and
`untyped_prop` also names its `prop`, checked against the extracted prop list
the way `deprecations.props` keys are. The conformance suite then pairs the two
sides both ways (`findUntypedPropMismatches`): a property that asserts nothing
must have an `untyped_prop` assumption naming it, and an assumption naming a
property the schema DOES constrain is a claim about a different contract. The
three pilots carry 24 `untyped_prop` assumptions between them, which is the
number of properties across seven contracts that Ajv will not check.

**Decisions taken along the way.**

- **The pairing is over what asserts nothing, not over one description
  wording.** A declared slot carries `Slot: ...` and an API prop the schema
  cannot type carries `TS: ...` - two wordings because they are documented in
  two places (`x-uikit.slots` for the kit's own slots, the description plus the
  assumption for a forwarded API prop). The check reads the schema keywords
  instead, so it cannot be fooled by either wording changing.
- **Reported by the conformance suite, not by the compiler.** A missing
  assumption is a documentation gap; a compile that refused it would make a
  component uncompilable until its prose caught up, which is the wrong order.
  The suite fails on it in the run the author already executes.
- **`hidden` is one honest use, not a convenience, and it carries its own
  reason.** Accordion's root hides Base UI's `orientation`: the kit's own
  stylesheet fixes `.root` to `flex-direction: column`, so the only value it
  could add - `horizontal` - would set Base UI's keyboard axis against the
  layout the kit renders. That sentence is the entry's `reason` field: an
  entry is a prop and the reason it is not advertised, so the reason sits
  where the omission is instead of in a second claim beside it. Nothing
  else is hidden. AccordionContent's `keepMounted` and `hiddenUntilFound` were
  considered and left visible: `accordion.md` documents them on the root, but
  the panel really does accept them, and hiding a working typed boolean because
  a document is terse would remove a true fact rather than a misleading one.
  What the overlay says instead is a `behaviour` assumption naming where they
  are usually set.

## Accordion

### What Accordion is, contract-wise

`accordion.tsx` exports four components from one file - `Accordion` (root),
`AccordionItem`, `AccordionTrigger`, `AccordionContent` - each wrapping a
different Base UI Accordion primitive part. Until this point the harness
assumed one component, one directory, one overlay, one compiled contract.
Accordion is the first component that breaks that assumption three separate
ways at once: several public exports in one directory, a compound "family"
relationship between them, and one export (`Accordion<Value>`) that is
generic.

### Deviation 1: one contract per export, not a schema-chained family

An earlier plan for this work proposed chaining the family through
the GTS type system itself - `AccordionItem`'s props schema deriving from
`Accordion`'s. That was corrected before implementation: a schema-level
`root -> item` derivation would make `AccordionItem` inherit `Accordion`'s
own props (`multiple`, `hiddenUntilFound`, ...), which is factually wrong -
an item does not have those - and `GtsStore.validateSchemaAgainstParent`
would then reject item-only props (`value`, `disabled`) as undeclared
additions under a base the derivation treats as closed.

What shipped instead: **four independent contracts**, each its own derived
type from `base.component` (`allOf: [base, the host element's surface]`), with
ids kept flat via `gtsToken` (`accordion-item` -> `accordion_item`, one
token, so the "5 dot-tokens per segment" GTS grammar is unaffected by the
dash). Family membership moved out of the schema and into the metamodel
INSTANCE: a new optional `family` field (`root` ref, `role: root | part`,
`parts` on the root only), checked by a conformance test that every `family`
ref resolves to a directory that ships a compiled contract - a structural
relationship enforced by a test, not by inheritance.

Everywhere a plan or a metamodel description spoke of the compiled contract
"deriving" a family relationship, that language was replaced with the more
accurate "each export derives independently from base.component; family
membership is recorded, not inherited."

### Deviation 2: one passthrough type per DOM element kind, shared kit-wide

The harness through Button built the passthrough type as ONE FILE PER DOM
ELEMENT KIND, shared kit-wide, implicitly assuming every component that
resolves to a given kind (`div`, `button`, ...) forwards the same inherited
prop set. That held by coincidence: Button was the only `button`-kind
component, so nothing tested the assumption.

Accordion broke it twice over, confirmed by compiling both components and
diffing their generated passthrough output before deciding anything:

- `AccordionTrigger` also resolves to kind `button` (same as Button). Their
  inherited-prop sets were ALMOST identical (same underlying native
  `<button>` attributes) but not byte-identical: the checker printed the
  native `type`/`popover` attribute unions in a DIFFERENT member order
  depending on which component's own Props type led it to them - a
  pre-existing TypeScript union-printing instability the harness had never
  been exposed to before two components shared a kind.
- `Accordion`, `AccordionItem` and `AccordionContent` all resolve to `div`,
  but forwarded genuinely different sets: the root alone carried nine
  accordion-specific fields (`value`, `multiple`, `onValueChange`,
  `hiddenUntilFound`, ...) that were inherited-by-declaration-file even
  though they are the root's own domain API.

Both halves of that are now answered by the filing rule at the top of this
file rather than by a key: the root's nine fields are its API and reach its
own `properties`, and what remains - React's attributes for a `<div>` - is
one hand-written file per element kind, so there is no derivation whose
printed output could depend on which component compiled it. The
origin-keyed generated files this deviation shipped, and the collision check
and ownership list they needed, are gone; the "one file per element kind"
shape it started from is what the harness ended up with, for the reason it
could not have then: nothing is derived, so nothing can disagree.

### Deviation 3: `composition.kinds` had to become typed refs

The pre-Accordion harness's `composition.children.kinds` was a plain array of
free-form strings (Button's overlay: `kinds: [text]`) - no schema-level
connection to the GTS component-ref grammar `dont_use_when.instead` already
used. Describing a family's actual allowed children (`Accordion` -> only
`AccordionItem`; `AccordionItem` -> `AccordionTrigger` and
`AccordionContent`) as free text would have been a strictly weaker fact than
`dont_use_when` already carried for the SAME kind of claim ("point at a real
component, not a name nothing can resolve"). Fixed by typing `children.kinds`
items as `oneOf: [component_type_ref, {const: "text"}]` - the one
non-component content-kind already in real use (Button) stays valid, and any
component-shaped entry is now checked the same way `dont_use_when` is.

Accordion also needed a place for a part's allowed mount points
(`AccordionTrigger`/`AccordionContent` under `AccordionItem`, `AccordionItem`
under `Accordion`) - nothing before it was ever "only ever mounted under"
something else. That shipped as an authored `composition.parent`, and is now
derived from the children lists instead: see "Composition: children optional,
parent derived" above for why an authored mirror of somebody else's fact was
the wrong shape for it.

### Deviation 4: the generic `Value` type parameter

`Accordion<Value = unknown>` makes `value`, `defaultValue` and
`onValueChange` depend on a type parameter with no JSON Schema
representation, so `classifyProviderSafeType` can express none of the three
and each reaches the contract as a property that asserts nothing. What that
needed was not a compiler change but a place to WRITE DOWN that it is
deliberate rather than a gap: `coverage.assumptions`, a new optional
sub-field of the existing `coverage` object (additive, Button's
`coverage: { a11y, rtl }` was unaffected), asserted present by the
conformance test. No custom JSON Schema keyword was added.

Two things about those three props changed after this deviation shipped, both
recorded at the top of this file: they are the root's API and reach its own
`properties` rather than a generated forwarded surface, and their assumptions
now carry `kind: untyped_prop` and name the prop, so the pairing between "a
property Ajv will not check" and "an assumption saying why" is checkable
instead of a convention.

The same `coverage.assumptions` mechanism also documents a second, unrelated
fact about `AccordionTrigger`: it composes Base UI's `Accordion.Header` (not
separately exposed by the kit) around `Accordion.Trigger` into one exported
component, so the contract describes the exported surface, not the two-part
internal composition. That entry now carries `kind: hidden_part`.

### Deviation 5: the extractor needed no change

An earlier plan anticipated a possible extractor fix "if the extractor
cannot resolve a kind for some export." It could, for all four: a probe run
against `accordion.tsx` before any extractor changes were considered
resolved `Accordion` -> `div`, `AccordionItem` -> `div`, `AccordionTrigger`
-> `button`, `AccordionContent` -> `div`, correctly, through the SAME
generic checker walk (`walkPropsType`/`typeRefParts`) that already followed
Button's `Omit<ButtonPrimitive.Props, 'className'>` down to
`BaseUIComponentProps<'button', ...>` - `AccordionPrimitive.Root.Props<Value>`
is a qualified name (`lastEntityName` already takes the last segment) and the
checker resolves its own heritage the same way regardless of how many
namespace segments got it there. `extract.test.ts` was not extended.

### Text changes to Button's committed artifacts

Two of Button's committed files changed content in this same commit for
reasons unrelated to Accordion's own facts:

- `scripts/contracts/ui-component.meta.json` - regenerated from
  `buildMetamodel()` after the `family`, `coverage.assumptions` and
  `composition.parent` additions (all additive/optional; Button's own
  compiled contract properties were unaffected).
- Button's own generated passthrough type, whose description was rewritten
  to describe the general per-export mechanism rather than the "one file per
  kind, no exceptions" wording Accordion falsified.

Both were required by the harness's own freshness invariant (a committed
artifact must equal a fresh compile) - not scope creep, the direct
consequence of the compiler producing different output for the SAME inputs.
The second file no longer exists: the forwarded surface is hand-written per
element kind and nothing regenerates it.

### What a compound component forced in the harness

A file-by-file inventory used to stand here. It is struck rather than
corrected: two of its entries named machinery the harness has since replaced,
and a list of function names in a log goes stale the moment the code moves.
What the shape change was:

- Every entry point that produces or compares an artifact takes an optional
  export stem beside the directory it already took, defaulting to the
  directory, so a compound directory's part resolves its own overlay,
  extraction and committed artifacts while every earlier call site keeps
  working unchanged.
- The guard and the compatibility check moved from one unit per directory to
  one per `(directory, stem)` pair, and a covered directory needs EVERY
  export described rather than one; the coverage report gained its
  per-directory "n of m exports" breakdown.
- The overlay vocabulary gained `family` and `coverage.assumptions`, both
  optional, so no instance is required to state them.
- The CLI entry point changed from "compile one component" to "compile every
  `*.contract.yaml` overlay directly under this directory".
- The per-component forwarded surface these deviations started from is gone
  entirely; the first section of this file records the hand-written
  per-element surface that replaced it, and `composition.parent` went the
  same way - derived from every other overlay's children rather than
  authored, see "Composition: children optional, parent derived".

### Effort

Roughly two focused working days (~14-16 hours) end to end: reading the
existing harness and Base UI's prop-declaration conventions, probing the
extractor and passthrough generation against real `accordion.tsx` output
before writing any overlay content (this is what surfaced Deviation 2 before
it became a silent bug), the metamodel/compiler/check.ts changes themselves,
authoring four overlays with real invariants and examples (not placeholders),
and the 22-assertion conformance suite. The single largest cost was NOT
Accordion's own facts - the four overlays took about the time Button's one
did - it was discovering and fixing the passthrough-sharing assumption
before it shipped a non-deterministic build.

## DataTable

### What DataTable is, contract-wise

`data-table.tsx` exports eight names; two are React components
(`DataTable`, `DataTableSortButton`), the other six are a fixed
TanStack-features const, a type alias for it, two helper functions and a
small labels interface. Unlike Accordion, DataTable and DataTableSortButton
are NOT a compound family - they are two independent top-level exports that
happen to share a directory, so neither overlay sets `family`. Both props
types are from-scratch interfaces with no `Omit<...>`/`ComponentProps<...>`
heritage at all - `DataTableProps` extends nothing, `DataTableSortButtonProps`
extends nothing - so both compile with `allOf: [base.component]` only, no
forwarded surface at all, confirmed by `resolveTargetExtraction(...)`
reporting no host element and no forwarded or API props for either (asserted
directly in `data-table.contract.test.ts`).

### Forced change 1: coverage must count components, not exports

Before this pilot, `componentExportCoverage` counted `extractComponent(...).length`
against `overlayStems(...).length` and called the first number "total
exports" - accidentally correct through Accordion because Button and every
Accordion export IS a component, so "extracted" and "exported" never
diverged. DataTable's directory exports six non-component names alongside
its two components, and NONE of them should ever need an overlay or count
against coverage. The extractor's own `isReactComponentCandidate` (uppercase
name, JSX-returning body) already excluded them correctly from
`extractComponent`'s result - the actual gap was that coverage had no way to
SHOW which names were excluded and why, leaving "2 of 6" reading as an
ambiguous fraction instead of "2 components, 4 correctly not-components".
Fixed with a new `extract.ts` export, `listExportedDeclarationNames` (every
top-level exported name in a file, component or not, gathered by the same
program/checker `extractComponent` already builds), and a
`skippedNonComponents` field on `DirectoryExportCoverage` that
`check.ts`'s `runCoverage` now prints alongside the n-of-m count.

### Forced change 2: extension_points

DataTable's growth surface is a small, fixed set of exports
(`columns`, `dataTableColumnHelper`, `dataTableSelectionColumn`,
`dataTableFeatures`) rather than a long tail of individual plugin-shaped
props - the metamodel had no field for "here is how a consumer extends this
component" as a first-class concept, only individual typed/slotted props.
`extension_points` (name/kind: prop\|helper\|feature/description/typed_by) is
an optional array on the metamodel instance, outside `required`, so a
component with no growth surface states nothing. `typed_by` is free text,
not a component reference: the governing type
(`@tanstack/react-table`'s `ColumnDef`) lives in a package this contract has
no business re-typing, so a prose pointer is the honest claim.

### Forced change 3: a `none` composition child kind

`composition.children.kinds` required at least one entry, drawn from
`component_type_ref` or the literal `"text"` - both Button and every
Accordion part have SOME notion of children (text, or a named part).
DataTable has neither: `DataTableProps` declares no `children` field at
all, and the component renders `Table`/`TableHeader`/`TableBody` internally
from `columns`/`data`. Writing `kinds: [text]` would have been a factual
lie (there is no way to pass text children to `<DataTable>` and have
anything happen). Added a third literal, `"none"`, to the same `oneOf` -
additive, existing `"text"` and component-ref values stay valid, no
metamodel version bump.

### Forced change 4 (not anticipated going in): absolute paths inside printed type text

Compiling DataTable's first overlay draft against the real extractor
surfaced a defect unrelated to anything above: `columns`' printed type text
(`checker.typeToString(..., NoTruncation)`) embedded the machine's own
ABSOLUTE FILESYSTEM PATH inside `import("...")` qualifiers -
TypeScript's printer falls back to a full `import()` path whenever
`NoTruncation` forces a structural, unnamed type to print in full and the
checker has no nominal name for it (`DataTableFeatures` traces back to an
inferred `tableFeatures(...)` return type with none). Left as committed
text, this would have made `data-table.contract.json` different on every
machine that recompiles it - the exact defect `relativeDeclarationFile`
already existed to prevent for declaration FILE paths, just not yet for
paths appearing INSIDE a printed type. Fixed by reusing
`relativeDeclarationFile`'s own normalization inside a new
`normalizeImportPathsInTypeText`, applied to every extracted prop's
`typeText` (own and inherited alike) at the point the checker prints it -
not a DataTable-specific patch, so any future component with an
unnamed/structural inherited type gets the same protection for free. This
was found only by actually compiling against the real component, the same
way Accordion's Deviation 2 was - neither is discoverable by reading the harness
or the component's source in isolation.

### What could not be expressed

- **Generics** (`TData` on both components, `TValue` on
  `DataTableSortButton`): no JSON Schema representation for a type
  parameter; every prop that depends on one collapses to an annotation-only
  slot, the same mechanism Accordion's `Value` generic already exercised -
  no new compiler code needed here, only the fact recorded in
  `coverage.assumptions`.
- **Function props** (`selectionSummary`, and every `ColumnDef`'s own
  `header`/`cell` render functions reached through `columns`): opaque past
  "a function", same treatment as any other function prop in the kit;
  `header`/`cell` specifically are never even visible to the extractor as
  named properties of `DataTableProps` - they live one level down, inside
  `columns`' element type, which is exactly why they are described as an
  `extension_point` rather than chased into deeper schema.
- **A runtime object prop** (`DataTableSortButton`'s `column: Column<...>`):
  a live TanStack instance with methods (`toggleSorting`, `getIsSorted`),
  not serializable data - annotation-only, same as Accordion's Base-UI-owned
  inherited props, just arriving through an OWN prop instead of an
  inherited one this time.
- **Internal state** (`sorting`/`rowSelection`/`pagination`): never reaches
  either props type at all, so there is nothing for the extractor to even
  see - not a gap, a non-issue, but worth stating: "DataTable is
  sortable/selectable/paginated" is not discoverable from its own compiled
  prop schema, only from `columns`' fields and `enableRowSelection`.
- **A typed composition parent for `DataTableSortButton`**: its real mount
  point is a `ColumnDef`'s `header` render function, a plain function prop
  TanStack Table owns, not a kit component - there is no `component_type_ref`
  for "a table header cell" to put in `composition.parent`. It was recorded
  in `coverage.assumptions` prose at the time; it now states the mount point
  in `composition.mounts_in`, the external form the derived `parent` merges
  in, with the assumption carrying `kind: external_mount` beside it.

### Effort

About half a working day (~4 hours): both props types were from-scratch
interfaces with no Base UI/DOM heritage to resolve, so there was no
Accordion-scale extractor exploration needed - the actual time went into
the absolute-path defect (found, diagnosed and fixed against the real
`columns` type, not anticipated from reading the plan) and writing two
honest overlays with real invariants/assumptions rather than placeholders.
Four forced harness changes for two contracts, a higher ratio than
Accordion's one (`resolvePassthroughKindKey`, since removed) for four -
DataTable's facts were individually smaller but touched more DIFFERENT
corners of the metamodel (coverage counting, composition vocabulary,
extension surface, and a portability bug outside the overlay vocabulary
entirely) rather than one deep problem repeated four times.

### Comparison: Button / Accordion / DataTable

| | Button | Accordion (4 contracts) | DataTable (2 contracts) |
|---|---|---|---|
| Overlay lines (yaml, all contracts in the directory) | 85 | 275 (102+58+59+56) | 219 (137+82) |
| Own props: typed vs annotation-only (slot), summed across the directory's contracts | 5 typed, 1 slot | 4 typed, 0 slots | 4 typed, 8 slots |
| Host element / forwarded surface | `button` (`passthrough/dom_button.json`) | `div` for the root, item and panel, `button` for the trigger - two hand-written surfaces across four contracts | none for either contract - no DOM/Base UI heritage on either props type |
| Properties in the compiled contract | 9 (2 axes, 4 declared, 3 Base UI API) | 11 root, 6 item, 4 trigger, 5 panel (1 declared each, the rest Base UI API) | 9 and 3, all declared |
| Harness/compiler changes this component forced | 0 (harness already fit it - the original harness was built FOR Button) | `family`, `coverage.assumptions`, a composition parent, `composition.kinds` typed as refs, the (since removed) passthrough-key scoping fix | coverage counts components not exports, `extension_points`, a `none` composition child kind, absolute-path normalization in printed type text |

The typed-vs-slot ratio is the sharpest signal in that table: Button and
Accordion both wrap a Base UI primitive whose own props are mostly
provider-safe types (`boolean`, `string`, string-literal unions) reaching
their contracts as API props, so their DECLARED props (the ones this table
counts) are a small, mostly-typeable set on top of that. DataTable has no
such floor underneath it - every one of its own props is either provider-safe
(`pageSize`, `enableRowSelection`, `className`) or fully opaque (`columns`,
`data`, three `ReactNode` labels, `selectionSummary`) with nothing in
between, because there is no underlying primitive contributing a typed
baseline the way Base UI does for the other two.

## The x-gts-traits hybrid (demo review follow-up)

The type-system maintainer's review of the demo asked what `x-uikit` is - not
a JSON Schema keyword, not a registered GTS trait, an undifferentiated bag
every overlay field landed in regardless of whether anything downstream
actually read it. Two follow-on proposals came out of that thread: move the WHOLE overlay into `x-gts-traits`
(validated by gts-ts itself) and drop the compiled `.instance.json`
artifact, since the trait-typed props schema would carry everything the
instance did. Implemented instead: a hybrid split, `SEMANTIC_FIELD_TARGETS`
in compile.ts.

**What moved and why.** A field a validator or lint actually reads -
`dont_use_when` (its `instead` is a typed GTS ref, checked by pattern),
`composition`, `deprecations`, `coverage` (including `assumptions`),
`family`, `extension_points` - now compiles into `x-gts-traits`, checked by
`GTS.validateEntity` against `base.component.json`'s new
`x-gts-traits-schema` (`GtsStore.validateSchemaAgainstParent` ->
`validateSchemaTraits`, plus `validateEntityTraits`'s closure check - see
button.contract.test.ts's "button contract in a GTS store" suite for both
call paths exercised directly). A field that is prose FOR A READER with no
validator on the other end - `intent`, `typical_uses`, `invariants`,
`anti_patterns`, `examples` - stays in `x-uikit`, which nothing but a human
or a doc generator ever reads. The split is what makes `x-uikit` a definite
thing rather than a bag: it is specifically the half nothing validates.

**Two gts-ts mechanics this hybrid had to work around, neither documented
anywhere gts-ts ships (no README section, no test in its own `tests/`
directory mentions traits - this was worked out by reading
`GtsStore.validateSchemaTraits`/`validateEntityTraits`/
`collectAllTraitProperties` in `node_modules/@globaltypesystem/gts-ts/src/store.ts`
and confirming against the real package, see testing.ts's
`validateContractTraits` for the confirmed API):

1. `GtsStore.resolveTraitSchemaRefs` treats ANY `$ref`/`$$ref` key as a GTS
   ENTITY id to resolve in the store - it has no concept of a local JSON
   Schema pointer into the trait schema's own `$defs`, and fails a trait
   schema carrying one with "Unresolvable trait schema reference" rather
   than a recognizable validation error. Every trait-routed field is
   therefore a reference to a registered vocabulary type
   (`gts.frontx.uikit.trait.*`, one per concept - see "The overlay
   vocabulary as GTS types" below and the domain model in the package
   DESIGN), which is the shape that resolver is built for; the local `$defs`
   the metamodel still carries are string grammars used only by fields no
   validator reads.
2. `GtsStore.validateSchemaTraits`'s "unresolved trait property" check
   demands EVERY property `x-gts-traits-schema` declares have either a
   provided value or a schema `default`, regardless of this JSON Schema's
   own `required` list - checked with the `in` operator, before Ajv ever
   sees the data. `family` and `extension_points` are optional in the
   overlay (most components set neither), so a component that omits both
   would otherwise fail this check on its own, real, committed contract -
   not a demo artifact, `GTS.validateEntity` on the shipped
   `<name>.contract.json`. `nullableTraitProperty` (compile.ts) wraps
   exactly those two fields' type with `| null` and a schema-level
   `default: null`: `properties`/`required`/`minItems`/`if`/`then` are all
   instance-type-scoped JSON Schema keywords, vacuously satisfied by a
   `null` instance, so the real shape is unchanged for a component (like
   Accordion's root) that DOES set the field.

**Instance artifact (`<stem>.contract.instance.json`) kept, the suggestion
to drop it declined.** The same thread proposed folding the instance away
once traits carried everything the metamodel described. It is kept because
the two artifacts serve different readers with different costs: the
INSTANCE is what a catalog, a plan validator, or a lint rule reads without
loading JSON Schema machinery at all - `intent`, `dont_use_when`,
`composition` and the rest as a plain typed object, one `JSON.parse` and a
metamodel-shaped Ajv check, no `allOf` chain to walk, no passthrough type to
resolve, no GTS store to register into. The PROPS SCHEMA (and its
`x-gts-traits` annotation) is what a schema-aware validator or a
structured-output projection reads - the shape `GTS.validateEntity`,
`gtsPlugin.registerSchema` and Ajv itself all expect. Merging them would
mean every instance-only reader either takes on the derived-schema
machinery it never needed, or the compiler emits a "props-schema-shaped
view with the derivation stripped out" - a THIRD artifact in substance, not
a saved one. Two artifacts, two readers, one compiler that keeps them in
sync (the freshness check) is the cheaper shape.

**What changes if ADR 0005 answers "a GTS runtime acts on traits" versus
"validate-and-store only".** This hybrid assumes the latter: `x-gts-traits`
today is checked and carried, nothing reads it at runtime to change
behavior. If ADR 0005 settles on "validate-and-store", nothing here changes
- the split already matches that answer. If it settles on "a runtime acts on
traits", the DOCUMENTATION fields currently left in `x-uikit` (`intent`,
`typical_uses`, `invariants`, `anti_patterns`, `examples`) would need to
move too, since "a runtime reads this" is exactly the bar `SEMANTIC_FIELD_TARGETS`
already uses to decide what belongs in `x-gts-traits` - at that point
`x-uikit` would carry nothing (or fold away entirely) and the whole overlay
would be traits, which is the "move everything" version the maintainer
originally proposed. The map is the single edit point either way; no other
file changes shape.

## Decisions taken from the demo review

Five questions came out of the demo review. What follows is the
call on each, for whoever extends contract coverage past these three pilot
directories - not a re-litigation, a record of what was decided and why.

**1. Source of truth stays the code; YAML holds meaning, not shape.**
The type-system maintainer proposed Option B: YAML declares props/axes,
TypeScript is GENERATED from YAML (`button.contract.d.ts`), `cva()` stays in
code but is typed against the generated union, and the extractor flips from
"read the code" to "verify the code matches the YAML". Option A - the code
stays the one place props/axes are declared, the extractor reads them, the
overlay only carries what code cannot express - was hardened instead:
`check.ts`'s `compat` subcommand diffs a component's committed props
schema against the same component at a base ref via gts-ts's
`GTS.checkCompatibility`, and fails the build on an incompatible verdict
unless the component's own contract major also moved. That is Option A's own
answer to the concern Option B was raised to solve - "a removed variant
breaks consumers silently" - without inverting which side is generated. The
answer only holds because the major is PER COMPONENT, authored in that
component's overlay: read off a kit-wide constant, as it was at first, the
one acknowledgement the gate offers could only be given by rewriting the
identifier of every contract, every instance and every reference in the kit
at once, and a gate whose escape hatch costs that much is a gate people route
around rather than a gate that catches anything. B is declined for a
narrower reason than "A already works": the compiled JSON, not YAML-derived
TypeScript, is the one artifact this contract format claims is normative -
`gtsPlugin.registerSchema`, a projection into a structured-output schema, or
a validator in another language all read the compiled JSON, never a
`.d.ts`. Other kits (should this format ever leave this pilot) would extract
their own language's types from that JSON however suits their own tooling;
generating ONE language's types here would make that one language's shape
look normative when it is not. The tradeoff B's author named honestly - "one
YAML diff plus JSON diffs of the same fact" on every prop change - is
accepted as the cost of keeping the compiled artifact the single normative
one.

**2. Vendor namespace stays `frontx.uikit`.** The harness reviewer proposed
a base type id shaped `gts.frontx.design.uikit.component.v1~`; the harness
author's reply explained the base type actually needed a segment
`frontx.uikit.component.v1` could not supply either - gts-ts's own grammar
requires 5-6 dot-tokens per segment, and that string is 4 - so the base type
shipped as
`gts.frontx.uikit.base.component.v1~`, one token longer, keeping
`frontx.uikit` rather than `frontx.design.uikit`. No reply followed on the
reviewer's side of that thread. The question stays open, not resolved by
default: `ids.ts`'s `VENDOR_PACKAGE` constant is the one place a rename
would land, and it is cheap now (three directories - button, accordion,
data-table) and gets more expensive every additional component `covered.json`
gains, since every id a renamed vendor segment appears in - base type,
every props schema, every passthrough type, every instance - would move in
the same commit. Get the call before coverage grows much further.

**3. Instance artifact kept.** See "The x-gts-traits hybrid" section above -
the instance is what a catalog, plan validator or lint reads without JSON
Schema machinery; the props schema is what a schema-aware validator or
structured-output projection reads. Different readers, different costs;
merging them would create a third, poorer-fit artifact rather than remove
one.

**4. The x-gts-traits hybrid is implemented; what ADR 0005's answer changes.**
See "The x-gts-traits hybrid" section above for the split itself and the two
gts-ts mechanics it had to work around. `ADR/0005-default-type-substrate-provider.md`
decides which component owns the default GTS-backed type-substrate provider -
it does not answer, and was never meant to answer, whether a GTS runtime
ever reads a component's traits to CHANGE behavior at runtime versus only
validating and storing them. That question is still open: it was put to the
harness reviewer in the same review thread and is unanswered as of this
pilot. Two outcomes, both already accounted for
by `SEMANTIC_FIELD_TARGETS` being the single routing switch: if the answer
is "validate-and-store" (traits are checked and carried, nothing reads them
to change behavior), nothing here changes - that is what this hybrid already
assumes. If the answer is "a runtime acts on traits", the documentation
fields currently left in `x-uikit` (`intent`, `typical_uses`, `invariants`,
`anti_patterns`, `examples`) would need to move too, since "a runtime reads
this" becomes the same bar `x-gts-traits` already uses for everything else -
at that point `x-uikit` would fold away and the whole overlay would be
traits, the "move everything" shape the maintainer's original comment
(item 2) proposed.

**5. "Block", not "higher-order component", for future template-copied
composites.** The maintainer's terminology note proposed
naming the future template-copied composite a kit-family root plus its parts
compose into - not shipped anywhere in this branch - a "block" rather than a
"higher-order component": HOC still implies an npm-consumed, versioned
artifact the way Accordion's own root/item/trigger/content family is, where
a block implies something a template copies in and the owning project then
forks and maintains itself, per DESIGN's own library-vs-template line (the
same distinction shadcn/ui draws between its library components and its
block templates). Adopted as the term for whoever picks up block/template
composite work next; no code in this branch defines, ships or tests a
block - Accordion and DataTable are both ordinary (if compound, in
Accordion's case) kit components, not blocks.

## An empty property schema is not a neutral statement

**Observed.** An agent-facing evaluation pointed an agent at the accordion
root's forwarded surface and asked what `Accordion`'s `value` and
`defaultValue` accept. It answered "plain strings." The real type is
`AccordionValue<Value>` - an array of the root's own generic parameter.
Nothing said otherwise: `value`, `defaultValue` and `onValueChange` were each
the literal `{}`, because `classifyProviderSafeType` returned `undefined` for
them and the compiler had nowhere to put the fact it had already read. `{}` in
JSON Schema means "no assertion", and a reader with no other source of truth
reads that as "anything, so probably the obvious thing."

Where those three props LIVE was the second half of the same finding, and it
is answered separately - see "A prop of the primitive is the component's API"
at the top of this file. This section is about the writing.

The gap was only ever in the WRITING. The extractor had the checker's
printed type text for every prop, own and inherited, and had had it since
the harness was built - `ExtractedProp.typeText`, already normalized by
`normalizeImportPathsInTypeText` (DataTable's forced change 4) so it carries
no machine-specific path. The own-props side had also already solved the
same problem: a slot property gets `Slot: <type>. No JSON Schema type exists
for it; ...`. That wording simply never covered the inherited side, where
the untypeable props are far more numerous - 182 of the accordion
root's forwarded props (every event handler, `style`, `children`,
`contentEditable`, `role`) were `{}`.

**Changed.** `describeUntypeableProperty` (compile.ts): a property schema
carrying none of `type`, `enum`, `const`, `$ref`, `anyOf`, `oneOf` and no
description of its own gets
`TS: <type text>. Not expressible in JSON Schema, checked by tsc.` Applied to
every API prop and as a post-condition on every declared one, where it is
deliberately a no-op - the slot branch already writes a more specific
description and a typed property already asserts something - so that the rule
holds for whatever branch is added next rather than being restated per branch.
The slot wording is untouched, and the hand-written element surfaces carry the
same wording for the two React attributes no JSON Schema type covers (`style`,
`children`).

**Decisions taken along the way.**

- **The type text keeps its `import("...")` qualifier.** The checker prints
  `import("@base-ui/react/accordion/index").AccordionValue<Value> | undefined`
  rather than the bare `AccordionValue<Value>`. Stripping the qualifier
  would read better, but it names WHERE the type lives, which is the next
  question a reader has after "what is it", and the path is already
  node_modules-relative and therefore machine-independent. Stripping it
  would also have to change `x-uikit.slots`' committed type texts to keep
  one spelling of one fact, which is a change to every described component's
  contract for a cosmetic gain.
- **A description is not a compatibility signal.** `diffPassthroughSchema`
  and `diffOwnPropsSchema` read `type`, `enum`, `required` and property
  presence, and never `description`; gts-ts's own `checkCompatibility` was
  asserted to agree rather than assumed to (see check-lib.compat-e2e.test.ts).
  This matters in both directions: adding prose to a property must not
  refuse a recompile, and the neighbouring case - an unconstrained property
  gaining a real `type` - must stay incompatible, which it does.
- **A new fixture rather than a reused one.** No existing fixture had an
  untypeable OWN prop; `untypeable-props.fixture.tsx` carries a generic
  `Value[]`, a function prop and a plain `string` in one props type, so the
  test can tell "describe what cannot be asserted" apart from "describe
  everything".

**Cost.** Under an hour. The fix is small because the fact was already
extracted; what took the time was confirming the compatibility path treats
prose as prose, since a wrong answer there would have made every existing
contract refuse its own recompile.

## Compiler coupling: one primitive library and React, for now

`extract.ts`'s `classifyDeclarationSite` recognizes exactly two families of
declaration site for a prop the component does not declare itself: the
primitive library, by the `@base-ui/react/` prefix on the already-relativized
declaration path, and React's own DOM attribute types, by `@types/react/`.
Nothing else. A prop declared by a different headless-primitive library
(Radix, react-aria, Ariakit, MUI unstyled) is filed in `unclassifiedProps`,
and `compileContract` refuses the component naming those props and their
declaration files - by design: the compiler cannot tell that library's API
from what it forwards, and either guess would be a fact the contract states
without knowing it.

The element side is a separate, narrower coupling: `walkPropsType` reads the
host element out of a `BaseUIComponentProps<'tag', ...>` or
`ComponentProps<'tag'>` generic argument, and a component whose props type
offers neither anchor resolves no element. With forwarded DOM props and no
element, `compileContract` refuses that too, because there is no honest
surface to declare them in.

This is a real, current limit of the compiler itself, not just of the three
overlays this pilot ships - the demo review's M5 finding named it precisely.
Adding a second primitive library requires, at minimum: (1) its prefix in
`classifyDeclarationSite`, and a decision about which of its declaration
files are a part's API rather than a shared helper's; (2) a
`classifyHeritageReference` shape for its own props-forwarding helper (the
same symbol + declaration-file check every other shape here uses, never
identifier text), so the host element still resolves; (3) a hand-written
passthrough schema for any element kind the kit did not already render. None
of that is designed against here - only Base UI and React were ever in scope
for this pilot's three components - so treat "add a primitive library" as new
design work on the classifier, not a config toggle.

## "Not a component of this kit" is an answer the metamodel had no way to give

**Observed.** An agent-facing evaluation pointed two agents at
`button.contract.yaml`'s navigation rule. `dont_use_when[].instead` was typed
as a component type reference and nothing else, so a rule whose honest answer
is "this kit ships no Link component" could only be satisfied by naming the
nearest kit component - `navigation_menu`, with an author comment in the YAML
admitting it was a stand-in. Both agents opened NavigationMenu, judged it far
too heavy for a single link, and fell back to a plain anchor on their own. A
weaker agent would have shipped NavigationMenu for one link; a validator
resolving `instead` finds a component the kit really ships and calls the
contract correct. `button.md` had said the honest thing all along ("for plain
navigation use the consumer app's link component"), so the contract and the
prose disagreed on the one component the contract format was piloted on.

The comment was the tell. An overlay field whose author has to write "this is
a stand-in" next to a value is a field whose vocabulary cannot express the
fact being recorded - and the comment is not in the compiled artifact, so the
only reader who ever saw the caveat was the next person to open the YAML.

**Changed.** `dont_use_when[].instead` is now a `oneOf`: the component type
reference exactly as before, or `{ external, note? }` - `external` required
and non-empty (what to use, outside this kit), `note` optional (why no kit
component fits), `additionalProperties: false`. Button's navigation rule
takes the external form and points at the consumer app's link component,
with the note carrying what `button.md` documents: an action that must read
as a button while navigating stays on Button over a real anchor
(`render={<a href="..." />}` with `nativeButton={false}`). No other overlay
needed the new form - accordion's and data-table's alternatives (Collapsible,
Tabs, Card, Button, Table) are all components the kit ships, checked rather
than assumed.

**Decisions taken along the way.**

- **An object, not a second string convention.** A prefix or sentinel string
  (`external:...`) in the same slot would keep one type and cost every reader
  a parse before it could tell a resolvable ref from prose - the ambiguity
  that made the stand-in readable as a recommendation in the first place. A
  distinct JSON shape is what makes "resolve this" and "do not try" a
  structural question: `isExternalAlternative` (compile.ts) is a `typeof`
  check, and every ref-resolving reader - the per-component conformance
  suites today, a registry check later - skips the external form instead of
  failing a grammar check on it.
- **`note` optional, `external` required.** A reason with no next move is the
  same gap a "don't" without an "instead" leaves, one level down; a pointer
  with no reason is often complete on its own.
- **The metamodel vocabulary is at `1.0.0`.** Nothing outside this repository
  reads the metamodel and the described set is three directories, so the
  version an instance carries states which vocabulary it was compiled
  against, not a compatibility promise to anyone. The metamodel's own type id
  (`...meta.component.v1`) is a separate axis: it versions the TYPE, not the
  field vocabulary.

**Cost.** Under two hours, most of it in the places the widened type
propagates rather than in the schema change itself: the trait schema (free -
`buildGtsTraitsSchema` takes whatever `buildMetamodel` states for a field, so
the object form validates in `x-gts-traits` with no edit) and the two
conformance suites that resolve references, which skip what is not one.


## The overlay vocabulary as GTS types

**Observed.** The base component type carried its whole validator-read
vocabulary inline: 296 lines in which a `don't` rule, a composition, a
coverage claim, a family membership and an extension point were anonymous
objects nested inside one schema, and a reference to another kit component
was a string with a `pattern` and a comment saying a real reference would go
here. Two consequences, both real rather than stylistic: nothing outside that
one file could name a concept the overlay is made of, and the metamodel had
to restate the same definitions locally, kept in step only because
`buildGtsTraitsSchema` copied them through an inliner.

**Changed.** Twelve types, one concept each, under a `trait` namespace: six
that are a field of the validator-read block (`dont_use_when_rule`,
`composition`, `deprecations`, `coverage`, `family`, `extension_point`) and
six the first six embed (`external_alternative`, `child_composition`,
`parent_composition`, `prop_deprecation`, `coverage_assumption`,
`coverage_verdict`). They are committed under `scripts/contracts/types/`,
written from their builders by `npm run contracts:compile -- --schemas`
together with the base type and the metamodel, and diffed against a fresh
build by the freshness comparison on every described component's run. The
base type's trait schema and the metamodel both reach a concept by reference,
so a definition exists once. A reference to a component is now that
component's own derived props-schema id
(`gts.frontx.uikit.base.component.v1~frontx.uikit.component.<name>.v1~`),
because that is the type a component IS - there is no second identifier
standing for the same thing - and it carries `x-gts-ref` naming what it must
resolve to.

**Why.** A type system's value is that a concept has one definition and an
identity anything can point at. An inline object has neither: it cannot be
referenced, cannot be validated on its own, and the second copy of it drifts
the moment someone edits one of the two. `inlineLocalRefs` existed only to
carry copies past a resolver that wanted references all along, and is gone.

**What `x-gts-ref` does and does not do here.** Inside
`x-gts-traits-schema`, `x-gts-ref` is an annotation and nothing more:
`GtsStore.normalizeSchema` strips it before any validator sees the schema,
and then drops any `oneOf`/`anyOf`/`allOf` branch that was left with nothing
else in it. A branch written the way the ecosystem's MFE schemas write one -
`{ "x-gts-ref": "..." }` alone - therefore disappears, and `instead` silently
stops accepting component ids at all. Every id-valued field consequently
carries `type` and `pattern` alongside the reference: the reference states
what the value must resolve to, the pattern is what rejects a malformed one.
Resolution against the registry happens where gts-ts actually runs its
reference validator, on the instance path
(`GtsStore.validateInstance` -> `XGtsRefValidator`), and only for a property
carrying `x-gts-ref` directly: the instance's `props_schema` is checked that
way and fails when the contract it names is not registered. A reference
nested inside a referenced vocabulary type - a `don't` alternative, a
composition kind, a family member - is not reached by that walk, so those
stay resolved by the conformance suites, which also answer a question the
registry cannot: most components a `don't` rule points at ship no contract
yet, and "the kit ships this component" is a directory, not a registration.


## Five ways the checks printed PASS on a change a consumer would feel

**Observed.** A review of `runCompat` and `runGuard` found five paths where the
harness reported success on a change it exists to catch. Each was reproduced
before it was fixed.

- **The forwarded surface could be dropped whole.** The passthrough reference
  was read off the NEW contract only. A contract that stops composing its
  passthrough type has nothing to look up, so the entire forwarded-surface
  block was skipped and the comparison reported "backward compatible" while
  every forwarded prop disappeared.
- **A deleted contract was never compared.** The comparison walks the contract
  units on disk and asks each one what it used to be. A contract that exists
  only at the base reference is walked by nobody, so a deletion - and a rename
  whose two halves neither git's rename detection nor the `$id` nor the stem
  could pair up - was not passed so much as never looked at.
- **The coverage allowlist was outside its own gate.** `covered.json` sat in
  the set of files excluded from the guard's widening, so editing it widened
  nothing: an entry could be added for a directory that does not exist, or
  left behind for one that was deleted, and nothing checked it until some
  unrelated change happened to touch that directory. The coverage report
  counted such an entry as coverage.
- **A change of forwarded surface failed nothing.** When a component was
  re-based onto a different primitive, the base reference had no file for the
  new key, so the comparison reported the signal as skipped and let the change
  through - including when props disappeared across the move. Both files were
  available the whole time, under two different names. The same rule now
  applies to a change of HOST ELEMENT, which is what a re-base changes about
  the forwarded surface once the surfaces are per-element and hand-written.
- **A base reference that does not resolve.** Reported by the reviewer as
  passing silently; measured, it was louder than that - `git diff
  base...HEAD` fails, so the run died with Node's whole spawn record around a
  one-line `fatal:`. Two lookups did swallow it, though (`ls-tree` for the
  base-ref contract list and for the generated types), and with the removal
  sweep above added, an empty contract list means "nothing was removed" as
  well as "nothing to match against" - a swallowed failure that would now be
  a wrong verdict rather than a missing hint.

**Changed.** The passthrough reference is read from both revisions and the two
answers decide the comparison: nothing when neither forwards; nothing to
report when only the current revision does, an arriving surface being the
widening direction; the shape comparison otherwise, against the empty surface
when the current revision forwards nothing and with the move named when the
host element changed. A skipped note is kept for what genuinely cannot be
compared and for nothing else. (Written against the origin-keyed generated
files; it reads the host element now, and the shape comparison covers a move
because two hand-written element surfaces share their common attributes by
construction rather than by two derivations agreeing.) Every base-reference contract no committed contract claimed
is swept up as a removal, refused while `covered.json` still names its
component and accepted, named, once it does not - the same acknowledgement the
guard already demands of a removed directory, so the two rules are one rule.
`covered.json` gets its own widening signal, distinct from the compile-path
one and printed as its own reason. Both subcommands verify the base reference
with `git rev-parse --verify <base>^{commit}` before doing anything, and every
git call whose failure is not itself an answer now raises a one-line error
naming the command instead of returning an empty list.

**Cost and coverage.** The decision rules stay in `check-lib.ts` as pure
functions. What moved is the shell: `check.ts` now names its impurities in a
`CheckContext` - the repository root, the overlay listing, the export listing,
the freshness comparison, where it logs - and `runCompat`/`runGuard`/
`runCoverage` return an exit code rather than calling `process.exit`. That is
what makes `check.e2e.test.ts` possible: twelve cases, each building a real
git repository in a temp directory with a fixed author and no global git
config, driving the real entry points over it. Every one of the five was
confirmed to print PASS, or to print a Node stack dump, before the fix.

**What is still not checked.** The e2e suite injects the compile-and-diff path
rather than compiling real TypeScript in the fixture repo - those three
functions resolve paths against this package and can only ever answer about
this package. The compile path is asserted for real by each described
component's own contract suite; what the fixture repo tests is everything the
harness says about a repository.


## The coverage report's 126 TypeScript programs

**Observed.** The contract step took 105s in CI, 92% of it `contracts:coverage`
(96.4s). That command fails no build by design: it walks 63 component
directories and prints how many are described. It was building two
`ts.Program`s per directory - one in `extractComponent` for the component
names, one in `listExportedDeclarationNames` for every exported name - 126
programs for 63 directories, sharing nothing. A program is not a parse of one
file: it is the parse, bind and module resolution of that file and its whole
transitive closure, and the kit's 63 components share nearly all of theirs.
Measured over the same entry files: 126 programs 33.5s, 63 programs 16.0s, one
program over all 63 roots 0.73s.

**The result the obvious fix would have changed.** One shared program for
every extraction is not a free substitution, and the freshness comparison said
so immediately: with all 63 components in one program, `button` and both
accordion parts reported their committed forwarded surfaces as stale (at the
time those were derived per component; the same instability would now show up
in the API props' own type text). Two things `checker.typeToString` prints are
properties of the whole compilation rather than of the file:

- the module specifier inside an `import("...")` type - the same Base UI event
  type prints as `import("@base-ui/react/types/index")` out of a one-root
  program and `import("@base-ui/react/index")` out of a 63-root one, the
  specifier being chosen from the modules the program can already reach;
- the ORDER of a union's members, which follows internal type ids and so
  follows the order the program bound its files: `"none" | "off" | "on" | ...`
  became `"off" | "none" | "on" | ...`.

Both land in a compiled contract, in the prose a property with no schema shape
carries. Sharing a program for extraction would have made a component's
committed artifacts depend on which OTHER components happened to be in the
same run - and on which subcommand ran, since the guard's root set is its
change set. That is exactly the machine-independence the prop sort (N3) and
the import-path normalization already exist to protect.

**Changed.** The split is by what an answer is used for, not by what is
convenient. Extraction that produces an artifact keeps its own program over
its own file. The two questions whose answers are only counted are moved off
that path: `listExportedDeclarationNames` builds no program at all - every
answer it gives is read off the syntax tree, so 63 programs' worth of module
resolution was being spent on a question no checker was ever asked - and a new
`listComponentExportNames` answers "which of these files' exports are
components" for every file in one program, behind its own cache so that an
extraction taken from it can never reach `compileContract`. The caller
declares its root set (`CheckContext.prepareExtraction`), because there is no
one right answer to it: a kit-wide report wants all 63 in one program, a
single-component compile wants one file.

126 programs became one.

**Numbers**, local, warm, best of two:

| Command | Before | After |
|---|---|---|
| `npm run contracts:coverage` | 38.3s | 6.8s |
| `npm run policy:contracts` (guard + compat + coverage vs `origin/develop`) | 47.5s | 11.9s |
| `extract.test.ts` | 5.1s | 5.1s |

**Identity.** Every described component was recompiled and every shared schema
rebuilt: no artifact changed. The coverage report's own JSON is identical
field for field across all 63 directories, including the per-directory export
counts and the skipped-export lists.

**Not done: one shared program for `extract.test.ts`'s fixtures.** It is the
slowest test file in the package (55s in CI) and its 16 fixtures would share
one program the same way. Left alone deliberately: the measurement above shows
the program shape moves `typeText`, and one of that file's assertions reads a
union's member order out of it. Putting the extractor's own suite on a program
shape no real run uses would point the one test that could catch a `typeText`
regression at the wrong compilation. The file is unchanged and still builds a
program per fixture.

## The compatibility gate had an escape hatch nobody could take

**Observed.** A second review of the harness found the gate's own arithmetic
wrong in two directions at once.

The escape hatch was kit-wide. Every identifier builder read one constant, so
"move the major and the narrowing is accepted" meant rewriting the identifier
of every contract, every instance and every reference in the kit - for one
component's narrowing. A gate whose only acknowledgement costs that much is
one people route around.

And the gate under-reported and over-reported at the same time. The declared
props diff read removals and newly-required props and nothing else, so a plain
`string` prop becoming a literal union passed - measured against the installed
type system, its own backward check does not report an enum appearing over an
existing type either, though it does report one appearing where the property
asserted nothing at all. Meanwhile a prop that left `properties` and was still
accepted by the element surface the contract forwards to - a component dropping
its own narrower `className` declaration - was reported as a breaking removal
and demanded a major move for a change no consumer can feel.

**Changed.** The major comes from the component's own overlay (`major:`,
default 1) and is threaded through the three identifier builders; a reference
carries the TARGET's major, read from the target's overlay, so moving one
component's major moves that component's identifiers and the references to it,
and nothing else. The shape rule that the forwarded surface already had is now
one function over both halves of a contract. And a declared prop that left
`properties` is reconciled against the forwarded surface: accepted there, by
declaration or by pattern, it is reported as moved rather than removed, with
the shapes compared where the surface declares one.

**Decisions taken along the way.**

- **The major is declared on the overlay schema, not on the metamodel.** It is
  not a field of a contract instance - it is part of every identifier the
  instance carries - so declaring it in both places would be one fact written
  twice with nothing keeping the two in step. Nothing in the compiled output
  changed when it moved: every overlay omits it, and every contract still
  carries major 1.
- **What the type system does and does not catch is pinned, not assumed.** Five
  cases in `check-lib.compat-e2e.test.ts` measure its backward verdict
  directly, including the two it reports and the three it does not. Each is a
  reason `diffOwnPropsSchema` exists, and a version that starts or stops
  reporting one fails that suite instead of quietly changing how much the gate
  catches.

## Four ways the guard's scope was narrower than the thing it guards

**Observed.** The same review found the guard in scope for less than it
protects, and one of the gaps was outside the package entirely.

- A committed contract carries the checker's printed type text for every
  property no schema shape can express - the primitive library's
  `AccordionValue<Value>`, React's `CSSProperties`. A dependency bump reshapes
  every described component's artifacts with no file under `src/components` or
  `scripts/contracts` touched, and the lockfile that decides which version is
  installed is not even visible to the package-relative change set the guard
  collects.
- Dropping a component from the coverage allowlist took it out of scope with no
  line in any output - and that same edit is the acknowledgement the removal
  sweep accepts, so the one edit that ends a component's coverage was the one
  edit nothing looked at.
- A covered component with no `*.contract.test.ts` was held to the freshness
  comparison in continuous integration only. The comparison is asserted twice
  on purpose, and the second assertion - the unit run of whoever changed the
  component - simply did not exist for such a directory.
- The exclusion set naming files that do NOT widen the scope named
  `check-lib.test.ts`, which the `.test.ts` rule already excluded. An
  unreachable entry there reads as a decision somebody took about that file.

**Changed.** Two more widening reasons, each with its own signal in the
guard's output so a reader knows which applied: a dependency manifest (the
package's own `package.json` and the repository's lockfile, read from a
repository-scoped change set added for exactly this), and the union of the
allowlist as it is with the allowlist as it was at the base reference. A
component the allowlist has dropped gets its own verdict - reported, not
failed, because de-listing is legitimate - and a covered component without a
conformance suite fails. The unreachable exclusion entry is gone.

**Decisions taken along the way.**

- **Both dependency files, not one.** The package's manifest says which version
  range is asked for and the lockfile says which version is installed; a bump
  can move either alone - a range widened without reinstalling, a lockfile
  refreshed inside an unchanged range - and both change what the checker
  prints.
- **De-listing reports rather than fails.** It has to stay possible: it is the
  only acknowledgement this harness records for a removed contract. What it
  must not be is silent.

## Two more places a fact was read from the wrong side

**Observed.** Two smaller findings from the same review, both the same shape -
a lookup that answered from one side of a set when it needed both.

The freshness comparison iterated the vocabulary BUILDER's output, so a
committed `types/*.json` the builder no longer produces was diffed by nobody
while `loadTraitTypes` went on registering it in every GTS store and every Ajv
instance: a definition the harness applies and no comparison covers.

And component-reference resolution took the FIRST component directory whose
name the identifier's stem extends. A part's stem extends its directory's name
by construction, so more than one directory can be a candidate -
`data-table-sort-button` is extended from `data-table` and would be from a
`data` alongside it - and the first one the directory listing happened to yield
would resolve a part into the wrong component in silence.

**Changed.** The freshness comparison is driven from the union of both sides,
and an orphaned type file reads as missing from the fresh compile, which is
what it is. Reference resolution takes the longest directory the stem extends
and fails by name when two of the same length could claim it.

## The builders were pure and re-run anyway

**Observed.** The metamodel, the base type and the vocabulary types are built
by pure string construction, and the vocabulary is read from thirteen files -
and all of it happened again on every validation. One covered component's
compile rebuilt the metamodel several times and re-read the whole vocabulary
directory with it; a widened guard multiplies that by the covered set. The Ajv
instance that validates an overlay was compiled per overlay for the same
reason.

**Changed.** Every builder and loader is memoized for the life of the process,
and the two validators every compile runs - the metamodel against an instance,
the trait schema against a contract's validator-read block - are compiled once.

**Decisions taken along the way.**

- **Memoized through a serialization, not by sharing the object.** Two of the
  readers mutate what they are given: a GTS store normalizes a registered
  schema in place, and Ajv keeps state against one. A structured copy of a
  small document is far cheaper than the construction and the file reads it
  replaces, and it keeps the guarantee every caller already relied on - what it
  gets is its own. `registerContractTypes` dropped its own defensive copy
  because of it.

**Numbers**, local, warm, best of two:

| Command | Before | After |
|---|---|---|
| `contracts:check -- guard --base HEAD` | 3.91s | 3.14s |
| `npm run policy:contracts` (guard + compat + coverage vs `HEAD`) | 12.31s | 11.54s |

The guard is where the saving is. The policy wrapper's remaining time is
almost entirely the coverage report's single TypeScript program over all 63
component entry files, which no amount of schema caching touches.
