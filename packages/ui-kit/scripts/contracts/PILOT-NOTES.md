# Contract harness pilot notes

Cost and deviation log for the component-contract pilot (T5 Accordion, T6
DataTable). English, factual, one section per pilot component. Written by
the developer who built the harness, for whoever decides whether to extend
contract coverage past the two pilot components.

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
