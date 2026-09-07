// Every version constant and GTS id/pattern the contract tooling builds,
// in one module. Before this file the same grammar was typed out five
// times by hand - three patterns in ui-component.meta.json, two copies in
// the conformance test - and they had already drifted from each other
// (the metamodel's own `$id` used one segment count, the test's local
// regex another). One module, one place to change a version.
//
// Nothing here reads a file or does I/O: it is pure string construction, so
// both compile.ts (which builds artifacts) and any test (which checks them)
// import the same values instead of each keeping its own copy.

// Fixed vendor.package prefix every kit-owned GTS type shares.
export const VENDOR_PACKAGE = 'frontx.uikit';

// Contract major of a component's derived props schema and its instance -
// the number a compatibility check bumps when a component's props schema
// stops being backward compatible with what shipped before. Deliberately a
// parameter of propsSchemaId/instanceId below rather than baked into their
// bodies, so a future per-component major bump is a call-site change, not a
// rewrite of the id grammar.
export const CONTRACT_MAJOR = 1;

// Semver of the overlay vocabulary itself (the fields an author may write),
// independent of any component's contract major - typical_uses/dont_use_when
// gaining a new required shape is a metamodel version bump; Button's props
// changing is a contract major bump. An instance's `metamodel` field is
// validated as a const equal to this, so a contract compiled against a
// stale metamodel fails loudly instead of silently degrading.
export const METAMODEL_VERSION = '1.1.0';

// GTS type id of ui-component.meta.json. Its own major (v1) is the grammar
// of the metamodel TYPE - a different axis from METAMODEL_VERSION above.
// 1.1.0's field changes stay backward compatible for an existing instance
// shape (typical_uses replaces use_when, dont_use_when tightens), so the
// type id does not need to move for this bump.
export const METAMODEL_TYPE_ID = `gts.${VENDOR_PACKAGE}.meta.component.v1`;

// GTS type id of base.component.json, the abstract parent every component
// props schema derives from. Fixed major, independent of CONTRACT_MAJOR:
// it is the root every component chains from, not any one component's own
// contract.
export const BASE_TYPE_ID = `gts://gts.${VENDOR_PACKAGE}.base.component.v1~`;

// GTS type id of a shared per-element-kind passthrough type - one id per
// DOM tag (button, div, table, ...), independently versioned from any
// component's contract. A function, not a constant: T3 moved the kit from
// one hand-written button-only passthrough type to one generated file per
// element kind (see extract.ts's resolveElementKind), so the id has to be
// parameterized the same way the file name is.
export function passthroughTypeId(kind: string): string {
  return `gts://gts.${VENDOR_PACKAGE}.passthrough.${kind}.v1~`;
}

// GTS tokens are snake_case; kit directories are kebab-case
// (navigation-menu -> navigation_menu).
export function gtsToken(component: string): string {
  return component.replace(/-/g, '_');
}

// A component's props schema id: the base type, then this component's own
// derived segment at the given contract major.
export function propsSchemaId(component: string, major: number): string {
  return `${BASE_TYPE_ID}${VENDOR_PACKAGE}.component.${gtsToken(component)}.v${major}~`;
}

// A component's contract instance id: the metamodel type, then the same
// component segment - without the trailing `~` a TYPE id carries but an
// INSTANCE id does not.
export function instanceId(component: string, major: number): string {
  return `${METAMODEL_TYPE_ID}~${VENDOR_PACKAGE}.component.${gtsToken(component)}.v${major}`;
}

// Escapes every character special in a RegExp source, so a literal id
// (which itself is full of dots) can be dropped into a pattern string
// without its dots matching "any character".
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The segment shared by every place a component reference is spelled: the
// vendor.package prefix, `component`, the snake_case name, a version. The
// three id patterns below all chain onto this rather than restating it.
// `captureName` wraps the name token in a capture group - the conformance
// test needs the matched name back (to turn a dont_use_when.instead id into
// a directory it can check exists); the metamodel's own pattern fields do
// not, so they get the non-capturing default.
function componentSegmentPattern(captureName = false): string {
  const name = captureName ? '([a-z_][a-z0-9_]*)' : '[a-z_][a-z0-9_]*';
  return `${escapeRegExp(VENDOR_PACKAGE)}\\.component\\.${name}\\.v\\d+`;
}

// Grammar of a GTS component type reference - dont_use_when.instead, and
// the conformance test's own check that an id it wrote is grammatical.
export function componentTypeRefPattern(captureName = false): string {
  return `^gts\\.${componentSegmentPattern(captureName)}~$`;
}

// Grammar of a contract instance id (the metamodel's `id` property).
export function instanceIdPattern(): string {
  return `^${escapeRegExp(METAMODEL_TYPE_ID)}~${componentSegmentPattern()}$`;
}

// Grammar of a props schema id (the metamodel's `props_schema` property):
// the base type id, then the same component segment.
export function propsSchemaIdPattern(): string {
  return `^${escapeRegExp(BASE_TYPE_ID)}${componentSegmentPattern()}~$`;
}
