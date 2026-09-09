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

// The contract major a component carries when its overlay states none - the
// number a compatibility check requires a component to move when its props
// schema stops being backward compatible with what shipped before.
//
// A DEFAULT, not a kit-wide setting, and that distinction is the whole point
// of the constant's name. It used to be read directly by every call site, so
// the one escape hatch the compatibility gate offers - "move the major and
// the narrowing is accepted" - could only be taken by rewriting the
// identifier of every contract, every instance and every reference in the
// kit at once. A gate whose escape hatch costs that much is a gate people
// route around. The major now comes from the component's own overlay
// (`major:`), threaded through the three id builders below, so moving one
// component's major moves that component's own identifiers plus every
// reference to it - a reference carries the target's major - rather than
// every identifier in the kit.
export const DEFAULT_CONTRACT_MAJOR = 1;

// Semver of the overlay vocabulary itself (the fields an author may write),
// independent of any component's contract major - typical_uses/dont_use_when
// gaining a new required shape is a metamodel version bump; Button's props
// changing is a contract major bump. An instance's `metamodel` field is
// validated as a const equal to this, so a contract compiled against a
// stale metamodel fails loudly instead of silently degrading.
export const METAMODEL_VERSION = '1.0.0';

// GTS type id of ui-component.meta.json. Its own major (v1) is the grammar
// of the metamodel TYPE - a different axis from METAMODEL_VERSION above,
// which versions the field vocabulary a contract is compiled against.
export const METAMODEL_TYPE_ID = `gts.${VENDOR_PACKAGE}.meta.component.v1`;

// GTS type id of base.component.json, the abstract parent every component
// props schema derives from. Fixed major, independent of CONTRACT_MAJOR:
// it is the root every component chains from, not any one component's own
// contract.
//
// Two spellings, because GTS uses two: the URI form is what a JSON Schema
// `$id`/`$ref` has to carry, the bare form is what an id-VALUED field
// holds. gts-ts parses only the bare form (Gts.isValidGtsID rejects the URI
// prefix outright), so every reference value - an instance's props_schema,
// a `dont_use_when` alternative, a composition kind - is spelled bare, and
// only schema keywords carry `gts://`.
export const BASE_TYPE_ID_BARE = `gts.${VENDOR_PACKAGE}.base.component.v1~`;
export const BASE_TYPE_ID = `gts://${BASE_TYPE_ID_BARE}`;

// Strips the `gts://` prefix off an id that carries it. One helper rather
// than the four hand-rolled copies this repeated across check.ts,
// testing.ts and each component's own contract test.
export function bareGtsId(id: string): string {
  return id.replace(/^gts:\/\//, '');
}

// Contract major of the trait vocabulary - the small GTS types the
// validator-read overlay block is built out of (one per concept:
// dont_use_when_rule, composition, coverage, family, ...). Versioned on its
// own axis: a component's props changing is CONTRACT_MAJOR, the vocabulary
// of a `don't` rule changing is this.
export const TRAIT_MAJOR = 1;

// GTS type id of one vocabulary type, from its snake_case token
// (`dont_use_when_rule` -> gts://gts.frontx.uikit.trait.dont_use_when_rule.v1~).
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-trait-type
export function traitTypeId(token: string): string {
  return `gts://gts.${VENDOR_PACKAGE}.trait.${token}.v${TRAIT_MAJOR}~`;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-trait-type

// The x-gts-ref target every component reference declares: any type derived
// from the abstract base component type. Written as a trailing-`*` prefix
// pattern, the one wildcard shape gts-ts implements (XGtsRefValidator's
// validateGtsPattern matches by prefix) and the same shape the ecosystem's
// own schemas use (packages/gts-plugin's `gts.frontx.mfes.ext.domain.v1~*`).
// A component's derived props schema is the only registered type that IS
// that component, so it is what a reference to a component resolves to.
export const COMPONENT_REF_TARGET = `${BASE_TYPE_ID_BARE}*`;

// The token a host element contributes to a passthrough type's id and file
// name. GTS tokens are snake_case and kit element kinds are HTML tag names,
// so a hyphenated custom element (`<my-custom-element>`) is the one shape
// that needs normalizing - without it the passthrough namespace would be the
// single place a hyphen leaked into an id grammar that is snake_case
// everywhere else.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-passthrough
export function domPassthroughToken(elementKind: string): string {
  return `dom_${elementKind.replace(/-/g, '_')}`;
}

// GTS type id of a passthrough type - one id per HOST ELEMENT, shared by every
// component that renders that element. Independently versioned from any
// component's contract. A function, not a constant, because the id has to be
// parameterized the same way the hand-written file name is.
//
// Two spellings for the same reason the base type has two: the bare form is
// what an id-VALUED field holds - a contract names its host element's surface
// as a value, so the value is bare - and the URI form is what the surface
// file's own `$id` carries.
export function passthroughTypeRef(elementToken: string): string {
  return `gts.${VENDOR_PACKAGE}.passthrough.${elementToken}.v1~`;
}

export function passthroughTypeId(elementToken: string): string {
  return `gts://${passthroughTypeRef(elementToken)}`;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-passthrough

// The x-gts-ref target a host-element reference declares: any type in the
// passthrough namespace. Written as a trailing-`*` prefix pattern for the same
// reason COMPONENT_REF_TARGET is - the one wildcard shape gts-ts implements.
export const PASSTHROUGH_REF_TARGET = `gts.${VENDOR_PACKAGE}.passthrough.*`;

// GTS tokens are snake_case; kit directories are kebab-case
// (navigation-menu -> navigation_menu).
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-token
export function gtsToken(component: string): string {
  return component.replace(/-/g, '_');
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-token

// What a reference to a component holds: the component's own derived
// props-schema id, bare. There is no separate "component type" to point at
// - a component IS the type derived from the base component type, so the
// id that names the derived schema is the id anything referring to that
// component resolves through.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-identifiers:p2
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-props-schema
export function componentTypeRef(component: string, major: number): string {
  return `${BASE_TYPE_ID_BARE}${VENDOR_PACKAGE}.component.${gtsToken(component)}.v${major}~`;
}

// The same id in the URI form a JSON Schema `$id` has to carry.
export function propsSchemaId(component: string, major: number): string {
  return `gts://${componentTypeRef(component, major)}`;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-props-schema

// A component's contract instance id: the metamodel type, then the same
// component segment - without the trailing `~` a TYPE id carries but an
// INSTANCE id does not.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-instance
export function instanceId(component: string, major: number): string {
  return `${METAMODEL_TYPE_ID}~${VENDOR_PACKAGE}.component.${gtsToken(component)}.v${major}`;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-instance

// Escapes every character special in a RegExp source, so a literal id
// (which itself is full of dots) can be dropped into a pattern string
// without its dots matching "any character".
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-patterns
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-patterns

// The segment shared by every place a component reference is spelled: the
// vendor.package prefix, `component`, the snake_case name, a version. The
// id patterns below all chain onto this rather than restating it.
// `captureName` wraps the name token in a capture group - the conformance
// test needs the matched name back (to turn a dont_use_when.instead id into
// a directory it can check exists); the metamodel's own pattern fields do
// not, so they get the non-capturing default.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-patterns
function componentSegmentPattern(captureName = false): string {
  const name = captureName ? '([a-z_][a-z0-9_]*)' : '[a-z_][a-z0-9_]*';
  return `${escapeRegExp(VENDOR_PACKAGE)}\\.component\\.${name}\\.v\\d+`;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-patterns

// Grammar of a component reference - dont_use_when.instead, a composition
// kind, a family member, and the instance's own props_schema, which are all
// the same thing (componentTypeRef above) and therefore the same pattern.
// Carried next to `x-gts-ref` rather than replaced by it: gts-ts strips
// x-gts-ref before validating (GtsStore.normalizeSchema), so the pattern is
// what actually rejects a malformed id.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-patterns
export function componentTypeRefPattern(captureName = false): string {
  return `^${escapeRegExp(BASE_TYPE_ID_BARE)}${componentSegmentPattern(captureName)}~$`;
}

// Grammar of a contract instance id (the metamodel's `id` property).
export function instanceIdPattern(): string {
  return `^${escapeRegExp(METAMODEL_TYPE_ID)}~${componentSegmentPattern()}$`;
}

// Grammar of a vocabulary type id (traitTypeId above).
export function traitTypeIdPattern(): string {
  return `^gts://gts\\.${escapeRegExp(VENDOR_PACKAGE)}\\.trait\\.[a-z_][a-z0-9_]*\\.v\\d+~$`;
}

// Grammar of a passthrough type id (passthroughTypeId above): the vendor
// package, `passthrough`, an element token, a version. The token has no fixed
// shape of its own to reuse - it is `dom_<tag>` for whatever tags the kit
// renders - but every GTS token is snake_case, so the grammar is the same
// `[a-z_][a-z0-9_]*` charset the metamodel already uses for a component name.
// Existed only as a hand-checked equality
// (`passthroughSchema.$id === PASSTHROUGH_TYPE_ID`) in each component's own
// test until now - a hyphenated tag (`<my-custom-element>` before
// domPassthroughToken normalizes it) would pass that equality check just as
// easily as it would fail this pattern, which is the whole point of asserting
// the grammar directly instead.
//
// Two patterns off one grammar, matching the two spellings above: the bare one
// is what a host-element reference VALUE is checked against, the URI one what
// a surface file's own `$id` is.
// `captureToken` wraps the element token in a capture group, the way
// componentSegmentPattern does for a component name: reading the token back out
// of a reference is how a surface FILE is located, and the token is that file's
// own name, so nothing has to reverse domPassthroughToken.
function passthroughGrammar(captureToken = false): string {
  const token = captureToken ? '([a-z_][a-z0-9_]*)' : '[a-z_][a-z0-9_]*';
  return `gts\\.${escapeRegExp(VENDOR_PACKAGE)}\\.passthrough\\.${token}\\.v\\d+~`;
}

export function passthroughTypeRefPattern(): string {
  return `^${passthroughGrammar()}$`;
}

export function passthroughTypeIdPattern(): string {
  return `^gts://${passthroughGrammar()}$`;
}

// The element token a passthrough reference carries, or undefined when the
// string is not one. Accepts either spelling - a reference VALUE is bare, a
// schema `$id` carries `gts://` - because both name the same type.
export function passthroughElementToken(id: string): string | undefined {
  const match = new RegExp(`^${passthroughGrammar(true)}$`).exec(bareGtsId(id));
  return match?.[1];
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-patterns
