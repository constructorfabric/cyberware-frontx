# Contract harness pilot notes

Cost and deviation log for the component-contract pilot (T5 Accordion, T6
DataTable). English, factual, one section per pilot component. Written by
the developer who built the harness, for whoever decides whether to extend
contract coverage past the two pilot components.

## Passthrough key fix: keyed by origin, not DOM tag

T5's `resolvePassthroughKindKey(directory, exportStem, domTag)` (see Deviation 2
below) scoped a compound component's part to `<domTag>_<stem>` while an
ordinary single-overlay directory kept the plain `<domTag>` key unchanged.
That asymmetry was itself a latent collision, just one T5 never triggered:
the plain `<domTag>` key was keyed by WHAT ELEMENT gets rendered, not by
WHERE the forwarded props come from. Two single-overlay directories that
both resolve to `button` - Button itself, and any future component that
wraps a plain `<button>` with no Base UI primitive underneath it at all -
would have shared `passthrough.button.json` and silently overwritten each
other's generated file, exactly the defect Deviation 2 fixed for compound
parts but left open kit-wide.

**Fix**: the storage/id key is now the ORIGIN of the inherited props, not
the DOM tag they end up rendering. Extract.ts's `resolvePassthroughOrigin`
walks the same top-level heritage graph `topLevelHeritageLabels` already
built for the human-readable `x-uikit.passthrough` labels, and classifies
the outermost resolvable heritage member two ways: a declaration file under
`node_modules/@base-ui/react/<component>/<part>/...` (a real Base UI
primitive) yields `base_ui_<component>[_<part>]` - no part token when the
primitive has none, e.g. `base_ui_button` for Button, one token when it
does, e.g. `base_ui_accordion_root`/`_item`/`_trigger`/`_panel` for
Accordion's four parts; a plain `ComponentProps<'tag'>` or
`ComponentPropsWithRef<'tag'>` with no Base UI involved yields `dom_<tag>`;
a props type with no such heritage at all (DataTable's own interface, T6)
yields nothing, and the contract's `allOf` then carries only the base type.
`resolvePassthroughKindKey` and the directory/exportStem-scoped key it
computed are gone entirely - origin identity already carries whatever
uniqueness the old stem-scoping was working around, and two kit components
that really do wrap the SAME origin now share one generated file **by
construction**, not by coincidence: their inherited-prop sets come from the
same declaration, so sharing is correct rather than a residual gap to flag.

This is a compiler/extractor-only change: no overlay content, no metamodel
field, no new `coverage.assumptions` entry. The generated files themselves
were renamed (`passthrough.button.json` -> `passthrough.base_ui_button.json`;
Accordion's four analogously), and `button.contract.json`/each Accordion
contract's `allOf` ref changed to match - the only content change in either
component's compiled artifacts.

## Accordion (T5)

### What Accordion is, contract-wise

`accordion.tsx` exports four components from one file - `Accordion` (root),
`AccordionItem`, `AccordionTrigger`, `AccordionContent` - each wrapping a
different Base UI Accordion primitive part. Through T4, the harness assumed
one component, one directory, one overlay, one compiled contract. Accordion
is the first component that breaks that assumption three separate ways at
once: several public exports in one directory, a compound "family"
relationship between them, and one export (`Accordion<Value>`) that is
generic.

### Deviation 1: one contract per export, not a schema-chained family

The stage-1 plan's original T5 wording proposed chaining the family through
the GTS type system itself - `AccordionItem`'s props schema deriving from
`Accordion`'s. That was corrected before implementation: a schema-level
`root -> item` derivation would make `AccordionItem` inherit `Accordion`'s
own props (`multiple`, `hiddenUntilFound`, ...), which is factually wrong -
an item does not have those - and `GtsStore.validateSchemaAgainstParent`
would then reject item-only props (`value`, `disabled`) as undeclared
additions under a base the derivation treats as closed.

What shipped instead: **four independent contracts**, each its own derived
type from `base.component` (`allOf: [base, passthrough.<kind-key>]`), with
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

### Deviation 2: the passthrough-per-kind assumption did not survive contact with Accordion

T4 built the generated passthrough type (`passthrough.<kind>.json`) as ONE
FILE PER DOM ELEMENT KIND, shared kit-wide, implicitly assuming every
component that resolves to a given kind (`div`, `button`, ...) forwards the
same inherited-prop set. That held by coincidence through T4: Button was the
only `button`-kind component, so nothing tested the assumption.

Accordion breaks it twice over, confirmed by compiling both components and
diffing their generated passthrough output before deciding anything:

- `AccordionTrigger` also resolves to kind `button` (same as Button). Their
  inherited-prop sets are ALMOST identical (same underlying native `<button>`
  attributes) but not byte-identical: a probe compiling both in the same
  process found the checker prints the native `type`/`popover` attribute
  unions in a DIFFERENT member order depending on which component's own
  Props type led the checker to them - a pre-existing TypeScript union-
  printing instability the harness had never been exposed to before two
  components shared a kind.
- `Accordion`, `AccordionItem` and `AccordionContent` all resolve to `div`,
  but forward genuinely different sets: the root alone forwards nine
  accordion-specific fields (`value`, `multiple`, `onValueChange`,
  `hiddenUntilFound`, ...) that are inherited-by-declaration-file (they live
  in Base UI's own `AccordionRootProps`, not in the kit's `accordion.tsx`)
  even though they are conceptually the root's own domain API, not generic
  `<div>` forwarding.

Sharing one file per kind across a compound family would have made three of
Accordion's four contracts compete to overwrite the same generated file with
different, incompatible content - a non-deterministic build (whichever
export compiles last "wins") that the freshness check would have caught only
by intermittently failing depending on compile order, never diagnosing the
real cause.

**Fix**: `resolvePassthroughKindKey(directory, exportStem, domTag)` in
compile.ts. A directory's part whose export stem differs from the directory
name (every Accordion export except the root) gets a passthrough file scoped
to `<kind>_<stem>` (`div_accordion_item`, `div_accordion_content`,
`button_accordion_trigger`); the ordinary case (`exportStem === directory` -
Button, and every component through T4) keeps the plain `<kind>` filename
unchanged, so Button's own generated artifact is untouched by this except
for the description text (see "Text changes to Button's committed
artifacts" below).

**Known residual gap, out of scope for T5**: this fix is directory-scoped.
Two DIFFERENT single-overlay directories that happen to resolve to the same
kind (a hypothetical future `IconButton` alongside `Button`, say) would still
collide under a plain `<kind>` filename - that risk pre-dates T5 and was
simply never triggered before Accordion. Closing it kit-wide (e.g. keying
every passthrough file by directory unconditionally, or truly generating one
shared, unioned type per kind) is a call for whoever owns the harness past
these two pilots, not something this pilot needed to decide.

**Superseded** (see "Passthrough key fix: keyed by origin, not DOM tag"
above, done before T6): `resolvePassthroughKindKey` and the directory/stem
scoping described here are gone. The residual gap this section flagged was
exactly the case that fix closes - it is no longer open.

### Deviation 3: `composition.kinds` had to become typed refs, and gained a `parent` field

T4's `composition.children.kinds` was a plain array of free-form strings
(Button's overlay: `kinds: [text]`) - no schema-level connection to the GTS
component-ref grammar `dont_use_when.instead` already used. Describing a
family's actual allowed children (`Accordion` -> only `AccordionItem`;
`AccordionItem` -> `AccordionTrigger` and `AccordionContent`) as free text
would have been a strictly weaker fact than `dont_use_when` already carries
for the SAME kind of claim ("point at a real component, not a name nothing
can resolve"). Fixed by typing `children.kinds` items as
`oneOf: [component_type_ref, {const: "text"}]` - the one non-component
content-kind already in real use (Button) stays valid, and any future
component-shaped entry is now checked the same way `dont_use_when` is.

Also added: `composition.parent`, an optional mirror of `children` for a
part's allowed mount points (`AccordionTrigger`/`AccordionContent`'s parent
is `AccordionItem`; `AccordionItem`'s parent is `Accordion`) - nothing in T4
needed this, because nothing before Accordion was ever "only ever mounted
under" something else. Both changes are additive and optional at the schema
level (existing `properties`/`additionalProperties` shape), so Button's
overlay validates unchanged and its committed contract JSON is unaffected in
content (only in the passthrough description text, see below).

### Deviation 4: the generic `Value` type parameter

`Accordion<Value = unknown>` makes `value`, `defaultValue` and
`onValueChange` depend on a type parameter with no JSON Schema
representation. This did NOT require a compiler or extractor change: the
extractor's own/inherited split already routes these three props into the
INHERITED set (their declaration lives in Base UI's `AccordionRootProps`,
not in the kit's own `accordion.tsx`), and `classifyProviderSafeType`
already turns a non-provider-safe inherited type into an annotation-only
passthrough entry (`{}`) - so the generic collapses to "documented as a
slot" for free, the same mechanism that already handles `ReactNode` and
function props. The only addition was a place to WRITE DOWN that this is
deliberate rather than a gap: `coverage.assumptions`, a new optional
sub-field of the existing `coverage` object (`claim`/`reason` pairs,
additive, Button's `coverage: { a11y, rtl }` is unaffected), asserted
present by the conformance test. No custom JSON Schema keyword was added.

The same `coverage.assumptions` mechanism also documents a second, unrelated
fact about `AccordionTrigger`: it composes Base UI's `Accordion.Header` (not
separately exposed by the kit) around `Accordion.Trigger` into one exported
component, so the contract describes the exported surface, not the two-part
internal composition.

### Deviation 5: the extractor needed no change

The stage-1 plan anticipated a possible extractor fix "if the extractor
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
  compiled contract properties are unaffected).
- `scripts/contracts/generated/passthrough.button.json` - only its
  `description` string changed (rewritten to describe the general,
  per-directory-or-per-export passthrough mechanism rather than the old
  "one file per kind, no exceptions" wording that Accordion falsified); its
  `$id`, `title` and `properties` are byte-identical to before.

Both are required by the harness's own freshness invariant (a committed
artifact must equal a fresh compile) - not scope creep, the direct
consequence of the compiler producing different output for the SAME inputs.

### Harness files touched to fit a compound component

- `scripts/contracts/compile.ts` - `Overlay`/`ContractInstance` gained
  `family` and `coverage.assumptions`; `composition` gained `parent`;
  `buildMetamodel()` grew the matching schema (additive, `METAMODEL_VERSION`
  stayed `1.1.0` - every addition is optional, so no existing instance needed
  re-validation against a new required shape); `loadOverlay`,
  `compileInstance`, `compileContract`, `resolveTargetExtraction` all gained
  an optional second `exportStem` parameter (defaulting to `directory`, so
  every T1-T4 call site - `compileContract('button')`, one argument - keeps
  resolving exactly as before); `resolvePassthroughKindKey` is new (see
  Deviation 2); the CLI entry point changed from "compile one component" to
  "compile every `*.contract.yaml` overlay directly under this directory."
- `scripts/contracts/freshness.ts` / `testing.ts` - `checkComponentFreshness`
  / `assertContractFreshness` gained the same optional second parameter,
  same default-preserves-old-callers shape.
- `scripts/contracts/check.ts` - `guard`/`compat` moved from "one unit per
  directory" to "one unit per `(directory, stem)` pair" (a new
  `ContractUnit`/`listContractUnits`); `guard` now requires EVERY export of a
  covered directory to have a fresh overlay, not just one; `coverage` gained
  a per-directory "n of m exports" breakdown (`componentExportCoverage`)
  alongside the unchanged covered.json-based top-line count.
- `scripts/contracts/covered.json` - grew from `["button"]` to
  `["button", "accordion"]`; both parts of the growth condition (every
  export has an overlay, and `guard`/`coverage` say so) are true as of this
  commit.

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

## DataTable (T6)

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
generated passthrough type, confirmed by `resolveTargetExtraction(...).passthroughOrigin`
being `undefined` for both (asserted directly in
`data-table.contract.test.ts`).

### Forced change 1: coverage must count components, not exports

Before this pilot, `componentExportCoverage` counted `extractComponent(...).length`
against `overlayStems(...).length` and called the first number "total
exports" - accidentally correct through T5 because Button and every
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
Added `extension_points` (name/kind: prop\|helper\|feature/description/typed_by)
as an optional array on the metamodel instance, additive (not in
`required`), so `METAMODEL_VERSION` stayed `1.1.0` - Button's and
Accordion's committed contracts recompile byte-identical. `typed_by` is
free text, not a `component_type_ref`: the governing type
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
way T5's Deviation 2 was - neither is discoverable by reading the harness
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
  for "a table header cell" to put in `composition.parent`, so the
  relationship is recorded in `coverage.assumptions` prose instead of the
  typed field Accordion's parts use for the same kind of fact.

### Effort

About half a working day (~4 hours): both props types were from-scratch
interfaces with no Base UI/DOM heritage to resolve, so there was no
Accordion-scale extractor exploration needed - the actual time went into
the absolute-path defect (found, diagnosed and fixed against the real
`columns` type, not anticipated from reading the plan) and writing two
honest overlays with real invariants/assumptions rather than placeholders.
Four forced harness changes for two contracts, a higher ratio than
Accordion's one (`resolvePassthroughKindKey`, later superseded) for four -
DataTable's facts were individually smaller but touched more DIFFERENT
corners of the metamodel (coverage counting, composition vocabulary,
extension surface, and a portability bug outside the overlay vocabulary
entirely) rather than one deep problem repeated four times.

### Comparison: Button / Accordion / DataTable

| | Button | Accordion (4 contracts) | DataTable (2 contracts) |
|---|---|---|---|
| Overlay lines (yaml, all contracts in the directory) | 85 | 275 (102+58+59+56) | 219 (137+82) |
| Own props: typed vs annotation-only (slot), summed across the directory's contracts | 5 typed, 1 slot | 4 typed, 0 slots | 4 typed, 8 slots |
| Passthrough origin(s) | `base_ui_button` (one, shared by all consumers of Base UI's Button) | `base_ui_accordion_root`/`_item`/`_trigger`/`_panel` (four, one per Base UI primitive part) | none for either contract - no DOM/Base UI heritage on either props type |
| Harness/compiler changes this component forced | 0 (harness already fit it - T1-T4 were built FOR Button) | `family`, `coverage.assumptions`, `composition.parent`, `composition.kinds` typed as refs, the (later superseded) passthrough-key scoping fix | coverage counts components not exports, `extension_points`, a `none` composition child kind, absolute-path normalization in printed type text |

The typed-vs-slot ratio is the sharpest signal in that table: Button and
Accordion both wrap a Base UI primitive whose own props are mostly
provider-safe types (`boolean`, `string`, string-literal unions) inherited
through the passthrough mechanism, so their OWN props (the ones this table
counts) are a small, mostly-typeable set on top of that. DataTable has no
such inherited floor - every one of its own props is either provider-safe
(`pageSize`, `enableRowSelection`, `className`) or fully opaque (`columns`,
`data`, three `ReactNode` labels, `selectionSummary`) with nothing in
between, because there is no underlying primitive contributing a typed
baseline the way Base UI does for the other two.
