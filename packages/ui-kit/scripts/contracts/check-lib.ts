// Pure logic for the contract checks (compat, guard, enrollment): everything
// here takes already-loaded JSON or file lists and returns a decision - no
// filesystem, no git, no gts-ts. check.ts is the thin, impure shell that
// loads inputs (git show, fs.readFileSync, GTS.checkCompatibility) and hands
// them to these functions; keeping the split lets the decision rules be unit
// tested with in-memory fixtures instead of a checked-out git ref.

// Structural JSON diff, order-independent for objects (JSON.stringify would
// report two schemas that only differ in property insertion order as
// unequal, which a freshly compiled schema and its committed copy have no
// reason to guarantee). Used both for contract, instance and element-surface
// freshness (committed vs a fresh compile) and would read the same way for
// any other "does A still equal B" check in this tool.
export function jsonDiff(committed: unknown, fresh: unknown, path = '$'): string[] {
  if (committed === undefined && fresh === undefined) return [];
  if (committed === undefined) return [`${path}: missing from the committed artifact`];
  if (fresh === undefined) return [`${path}: missing from the fresh compile`];
  if (committed === fresh) return [];
  if (typeof committed !== typeof fresh) {
    return [`${path}: ${JSON.stringify(committed)} !== ${JSON.stringify(fresh)}`];
  }
  if (Array.isArray(committed) || Array.isArray(fresh)) {
    if (!Array.isArray(committed) || !Array.isArray(fresh)) {
      return [`${path}: array/non-array mismatch`];
    }
    if (committed.length !== fresh.length) {
      return [`${path}: length ${committed.length} (committed) vs ${fresh.length} (fresh)`];
    }
    const diffs: string[] = [];
    for (let i = 0; i < committed.length; i += 1) {
      diffs.push(...jsonDiff(committed[i], fresh[i], `${path}[${i}]`));
    }
    return diffs;
  }
  if (typeof committed === 'object' && committed !== null && typeof fresh === 'object' && fresh !== null) {
    const keys = new Set([...Object.keys(committed as Record<string, unknown>), ...Object.keys(fresh as Record<string, unknown>)]);
    const diffs: string[] = [];
    for (const key of keys) {
      diffs.push(...jsonDiff((committed as Record<string, unknown>)[key], (fresh as Record<string, unknown>)[key], `${path}.${key}`));
    }
    return diffs;
  }
  return [`${path}: ${JSON.stringify(committed)} !== ${JSON.stringify(fresh)}`];
}

export interface ElementSurfacePropertyLike {
  type?: string;
  enum?: string[];
  // Declared so the diff below can be seen NOT to read it. A property that
  // asserts nothing carries prose naming its TypeScript type (compile.ts's
  // describeUntypeableProperty), and prose is documentation: adding,
  // rewording or dropping it rejects nothing a consumer used to pass, so it
  // is not a compatibility signal in either direction.
  description?: string;
}

export interface ElementSurfaceSchemaLike {
  properties?: Record<string, ElementSurfacePropertyLike>;
  required?: string[];
  // The pattern families a surface admits by shape rather than by name
  // (`^aria-`, `^data-`, `^on[A-Z]`). A family is part of the surface in
  // exactly the way a declared name is: it is what makes the surface accept
  // a name, so both the reconciliation in diffOwnPropsSchema and the
  // compatibility comparison below read it.
  patternProperties?: Record<string, unknown>;
}

export interface ElementSurfaceDiff {
  added: string[];
  removed: string[];
  // The pattern families that arrived and that vanished. A family is a
  // source string, and dropping one stops the surface accepting every name
  // it matched at once - roughly 150 React event handlers for `^on[A-Z]` -
  // so a removal is read exactly as a removed property is, and an addition
  // exactly as an added one: it only widens.
  addedPatterns: string[];
  removedPatterns: string[];
  narrowed: { prop: string; reason: string }[];
  // An host element surface is a separate type the contract NAMES
  // (see its own $comment) - gts-ts's flat property/required/enum comparison
  // never sees it, because it follows no reference of any kind. This is the
  // check that closes that gap: an added forwarded prop only widens what a
  // consumer may pass (backward compatible), while a removed prop or a
  // narrowed enum/type can reject something that used to validate.
  compatible: boolean;
}

// The name-level half of the forwarded-surface comparison: which forwarded
// props vanished, which arrived, and which became mandatory. Split out from
// the shape checks below because the two answer different questions and a
// reader of either should not have to skip the other.
function compareElementSurfaceNames(
  oldSchema: ElementSurfaceSchemaLike,
  newSchema: ElementSurfaceSchemaLike,
): { added: string[]; removed: string[]; addedPatterns: string[]; removedPatterns: string[]; newlyRequired: string[] } {
  const oldProps = oldSchema.properties ?? {};
  const newProps = newSchema.properties ?? {};
  // A surface accepts a name two ways - by declaring it, and by matching it
  // with a pattern family - so both halves are compared. A family present at
  // the base and gone now removes every name it matched, which is the same
  // event as a removed property and larger: deleting `^on[A-Z]` from a
  // <button>'s surface drops roughly 150 event handlers at once, and
  // comparing declared names alone reported nothing at all.
  const oldPatterns = new Set(Object.keys(oldSchema.patternProperties ?? {}));
  const newPatterns = new Set(Object.keys(newSchema.patternProperties ?? {}));
  // A prop the new schema requires and the old one did not rejects a props
  // object that used to validate (the prop simply absent) - the same
  // "changed shape" the type/enum checks in diffElementSurface treat as
  // narrowing, just on the required list rather than on one property's own
  // constraints. Whether the prop already existed as optional or arrives
  // with the schema makes no difference to the caller: both reject the same
  // old call site, and `added` alone never fails a check because adding an
  // OPTIONAL forwarded prop is the widening direction. A name listed in
  // `required` that the new schema does not declare at all is a different
  // defect (a malformed schema, not an incompatible one) and is left to
  // whoever validates the schema itself.
  const oldRequired = new Set(oldSchema.required ?? []);
  return {
    added: Object.keys(newProps).filter((name) => !(name in oldProps)),
    removed: Object.keys(oldProps).filter((name) => !(name in newProps)),
    addedPatterns: [...newPatterns].filter((source) => !oldPatterns.has(source)).sort(),
    removedPatterns: [...oldPatterns].filter((source) => !newPatterns.has(source)).sort(),
    newlyRequired: (newSchema.required ?? []).filter((name) => name in newProps && !oldRequired.has(name)),
  };
}

const NEWLY_REQUIRED_REASON = 'became required where it was optional (or absent) before';

// Whether one property's shape got stricter between two revisions. The rule
// is the same wherever a property lives - a component's own properties or the
// surface it forwards - so it is one function rather than two that have to be
// kept in step.
//
// A type constraint that changes, OR that appears where none existed, both
// reject a value the old (unconstrained, or differently typed) prop used to
// accept. Same reasoning for an enum: a dropped value out of an existing
// enum, or a whole enum appearing where the prop previously accepted any
// value of its type. The reverse of each - a constraint lifted entirely -
// accepts a strict superset and is not checked here at all.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-shape
function shapeNarrowings(name: string, oldProp: ElementSurfacePropertyLike, newProp: ElementSurfacePropertyLike): { prop: string; reason: string }[] {
  const narrowed: { prop: string; reason: string }[] = [];
  if (oldProp.type !== undefined && newProp.type !== undefined && oldProp.type !== newProp.type) {
    narrowed.push({ prop: name, reason: `type changed from "${oldProp.type}" to "${newProp.type}"` });
  } else if (oldProp.type === undefined && newProp.type !== undefined) {
    narrowed.push({ prop: name, reason: `type constraint added: "${newProp.type}" where none existed before` });
  }

  if (oldProp.enum !== undefined && newProp.enum !== undefined) {
    const newEnumValues = new Set(newProp.enum);
    const droppedValues = oldProp.enum.filter((value) => !newEnumValues.has(value));
    if (droppedValues.length > 0) {
      narrowed.push({ prop: name, reason: `enum value(s) removed: ${droppedValues.join(', ')}` });
    }
  } else if (oldProp.enum === undefined && newProp.enum !== undefined) {
    narrowed.push({ prop: name, reason: `enum constraint added: ${newProp.enum.join(', ')} where none existed before` });
  }
  return narrowed;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-shape

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-element-surface
export function diffElementSurface(oldSchema: ElementSurfaceSchemaLike, newSchema: ElementSurfaceSchemaLike): ElementSurfaceDiff {
  const oldProps = oldSchema.properties ?? {};
  const newProps = newSchema.properties ?? {};
  const { added, removed, addedPatterns, removedPatterns, newlyRequired } = compareElementSurfaceNames(oldSchema, newSchema);
  const narrowed: { prop: string; reason: string }[] = [];
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-element-surface

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-element-surface
  for (const name of Object.keys(oldProps)) {
    if (!(name in newProps)) continue;
    narrowed.push(...shapeNarrowings(name, oldProps[name], newProps[name]));
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-element-surface

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-element-surface
  for (const name of newlyRequired) narrowed.push({ prop: name, reason: NEWLY_REQUIRED_REASON });
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-element-surface

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-element-surface
  return {
    added,
    removed,
    addedPatterns,
    removedPatterns,
    narrowed,
    compatible: removed.length === 0 && removedPatterns.length === 0 && narrowed.length === 0,
  };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-element-surface

// gts-ts's own `checkCompatibility(..., 'backward')` diffs a component's OWN
// properties/required the same shallow way `diffElementSurface` diffs the
// forwarded surface - but it does not see everything a consumer would feel.
// Measured against the real library rather than read off its source (see
// check-lib.compat-e2e.test.ts, which pins each of these):
//
//  - a prop that gains `required` status, and a prop that simply vanishes
//    without having been required, are both invisible to its BACKWARD
//    direction; they only show up in the FORWARD direction's
//    `forward_errors`, which this tool never reads. For a component's PROPS
//    SCHEMA - the shape a consumer's call site must satisfy - "does an old
//    caller's props object still validate" is exactly what
//    `is_backward_compatible` claims to answer, so a newly required prop (or
//    a rename, which looks exactly like a vanished one) is a real backward
//    break the library misses.
//  - an ENUM appearing on a prop that already carried its type is compatible
//    to it. `{type: 'string'}` -> `{type: 'string', enum: [...]}` is the
//    shape this compiler produces the day a plain `string` prop becomes a
//    literal union, and it rejects every value outside the union. (The
//    neighbouring case - a constraint appearing where the prop asserted
//    nothing at all - IS caught, as "type changed from any to string", so
//    the gap is narrower than "narrowing is unverified" and is closed here
//    with the same rule the forwarded surface already used.)
//
// A prop that leaves `properties` is not always gone, either: a component
// whose own declaration of `className` is dropped still forwards `className`
// through the surface its host element declares, and a consumer passing it
// notices nothing. `movedToForwardedSurface` is that reconciliation - a
// removal the surface still accepts, with a compatible shape, is not a
// removal. gts-ts's own decision is computed over the flat schema and cannot
// make that distinction either, but it also does not flag an optional prop
// vanishing, so the two answers do not fight.
export interface OwnPropsSchemaLike {
  properties?: Record<string, ElementSurfacePropertyLike>;
  required?: string[];
}

export interface OwnPropsDiff {
  removedProps: string[];
  newlyRequiredProps: string[];
  narrowedProps: { prop: string; reason: string }[];
  // Props that left `properties` and are still accepted by the forwarded
  // surface the current revision names. Reported so the move is visible,
  // and left out of `removedProps` so it does not force a major bump.
  movedToForwardedSurface: string[];
  compatible: boolean;
}

// Whether the forwarded surface accounts for a name at all: declared
// outright, or matched by one of its pattern families (`aria-*`, `data-*`,
// `on*`).
function forwardedEntry(
  surface: ElementSurfaceSchemaLike | undefined,
  name: string,
): { accepted: boolean; shape: ElementSurfacePropertyLike | undefined } {
  if (surface === undefined) return { accepted: false, shape: undefined };
  const declared = (surface.properties ?? {})[name];
  if (declared !== undefined) return { accepted: true, shape: declared };
  const patterns = Object.keys(surface.patternProperties ?? {});
  // A pattern family asserts nothing about a value, so a name it matches is
  // accepted with no shape to compare.
  return { accepted: patterns.some((source) => new RegExp(source).test(name)), shape: undefined };
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own
export function diffOwnPropsSchema(
  oldSchema: OwnPropsSchemaLike,
  newSchema: OwnPropsSchemaLike,
  forwardedSurface?: ElementSurfaceSchemaLike,
): OwnPropsDiff {
  const oldProps = oldSchema.properties ?? {};
  const newProps = newSchema.properties ?? {};
  const oldRequired = new Set(oldSchema.required ?? []);
  const newRequired = new Set(newSchema.required ?? []);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own
  const removedProps: string[] = [];
  const movedToForwardedSurface: string[] = [];
  const narrowedProps: { prop: string; reason: string }[] = [];

  for (const name of Object.keys(oldProps)) {
    if (name in newProps) {
      narrowedProps.push(...shapeNarrowings(name, oldProps[name], newProps[name]));
      continue;
    }
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own-forwarded
    const { accepted, shape } = forwardedEntry(forwardedSurface, name);
    if (!accepted) {
      removedProps.push(name);
      continue;
    }
    movedToForwardedSurface.push(name);
    // The surface accepts the name; whether it accepts the same VALUES is a
    // separate question, and the same rule answers it.
    if (shape !== undefined) narrowedProps.push(...shapeNarrowings(name, oldProps[name], shape));
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own-forwarded
  }

  const newlyRequiredProps = [...newRequired].filter((name) => !oldRequired.has(name));

  return {
    removedProps,
    newlyRequiredProps,
    narrowedProps,
    movedToForwardedSurface,
    compatible: removedProps.length === 0 && newlyRequiredProps.length === 0 && narrowedProps.length === 0,
  };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own

// Which forwarded-surface comparison a contract's two revisions admit. The
// host element is read from EACH revision's own reference rather than from the
// new one alone: a contract that dropped its host-element reference outright
// has no element to look up, so reading only the new side skipped the whole
// block and reported "compatible" for a change that removed every forwarded
// prop at once. Four shapes, and only the last is the ordinary one:
//  - neither revision forwards anything: nothing to compare;
//  - only the new one does: a forwarded surface appeared, which only widens
//    what a consumer may pass, so there is nothing to report;
//  - the new revision forwards nothing at all: compare against the empty
//    surface, which reports every forwarded prop as removed;
//  - both forward: the shape comparison, with the element move named when the
//    two are different elements. The surfaces are hand-written and shared
//    kit-wide, so the props two element kinds have in common carry the same
//    declarations by construction and a shape difference between them is a
//    real difference rather than an artefact of comparing two derivations -
//    which is why the move does not need a comparison of its own.
// A skipped signal is still reported as skipped rather than left to read as
// agreement, and only for what genuinely cannot be compared: no committed
// file for the element this contract names now, or none at the base ref for
// the element it named there.
export interface ElementSurfaceComparisonInput {
  component: string;
  // The host element each revision's own reference names, undefined when that
  // revision names no element surface at all.
  oldElement?: string;
  newElement?: string;
  // The schema for that revision's element - at the base ref for the old one,
  // as committed here for the new one - undefined when the file is absent.
  oldSchema?: ElementSurfaceSchemaLike;
  newSchema?: ElementSurfaceSchemaLike;
}

export interface ElementSurfaceComparison {
  diff?: ElementSurfaceDiff;
  note?: string;
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-element-surface-both
export function compareElementSurfaces(input: ElementSurfaceComparisonInput): ElementSurfaceComparison {
  const { component, oldElement, newElement, oldSchema, newSchema } = input;

  if (oldElement === undefined) return {};
  if (oldSchema === undefined) {
    return {
      note: `${component}: forwarded-surface signal skipped - the base ref carries no committed surface for element "${oldElement}"`,
    };
  }
  if (newElement === undefined) {
    return {
      diff: diffElementSurface(oldSchema, {}),
      note: `${component}: the contract no longer names the forwarded surface it carried at the base ref (element "${oldElement}")`,
    };
  }
  if (newSchema === undefined) {
    return {
      note: `${component}: forwarded-surface signal skipped - no committed surface for element "${newElement}"`,
    };
  }
  return {
    diff: diffElementSurface(oldSchema, newSchema),
    note:
      oldElement === newElement
        ? undefined
        : `${component}: host element moved "${oldElement}" -> "${newElement}"`,
  };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-element-surface-both

export interface CompatDecisionInput {
  component: string;
  oldMajor: number;
  newMajor: number;
  gtsBackwardCompatible: boolean;
  gtsBackwardErrors: string[];
  elementSurfaceDiff?: ElementSurfaceDiff;
  ownPropsDiff?: OwnPropsDiff;
}

export interface CompatDecision {
  decision: 'pass' | 'fail';
  notes: string[];
}

// The decision rule T4 specifies: a contract that is backward-incompatible
// (by any signal - gts-ts's own schema-body comparison, the element-surface
// structural diff above, or the own-props diff above) is only acceptable
// when the contract major in its $id moved, because that is the one visible
// acknowledgement that consumers built against the old major are expected to
// break. An unchanged major carrying an incompatible change would ship a
// props schema that silently rejects code that used to validate.
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-compatibility:p1
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1
export function decideCompat(input: CompatDecisionInput): CompatDecision {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-combine
  const { component, oldMajor, newMajor, gtsBackwardCompatible, gtsBackwardErrors, elementSurfaceDiff, ownPropsDiff } = input;
  const elementSurfaceIncompatible = elementSurfaceDiff !== undefined && !elementSurfaceDiff.compatible;
  const ownPropsIncompatible = ownPropsDiff !== undefined && !ownPropsDiff.compatible;
  const incompatible = !gtsBackwardCompatible || elementSurfaceIncompatible || ownPropsIncompatible;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-combine

  // A prop that moved from the contract's own properties to the surface it
  // forwards is reported whichever way the decision goes: nothing a consumer
  // passes stops validating, so it is not a reason to fail, but it IS the
  // component's own declaration disappearing and a reviewer should see it.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own-forwarded
  const moved = (ownPropsDiff?.movedToForwardedSurface ?? []).map(
    (prop) => `${component}: own prop "${prop}" is no longer declared here but is still accepted by the forwarded surface`,
  );
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own-forwarded

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-pass
  if (!incompatible) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-pass-return
    return { decision: 'pass', notes: [`${component}: backward compatible`, ...moved] };
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-pass-return
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-pass

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-combine
  const reasons = [
    ...gtsBackwardErrors,
    ...(ownPropsDiff?.removedProps.map((prop) => `own prop "${prop}" removed`) ?? []),
    ...(ownPropsDiff?.newlyRequiredProps.map((prop) => `own prop "${prop}" became required`) ?? []),
    ...(ownPropsDiff?.narrowedProps.map((entry) => `own prop "${entry.prop}" ${entry.reason}`) ?? []),
    ...(elementSurfaceDiff?.removed.map((prop) => `element surface: prop "${prop}" removed`) ?? []),
    ...(elementSurfaceDiff?.removedPatterns.map(
      (source) => `element surface: pattern family "${source}" removed - every name it matched is no longer accepted`,
    ) ?? []),
    ...(elementSurfaceDiff?.narrowed.map((entry) => `element surface: prop "${entry.prop}" ${entry.reason}`) ?? []),
  ];
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-combine

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-major
  if (newMajor > oldMajor) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-major-return
    return {
      decision: 'pass',
      notes: [`${component}: backward-incompatible, but the contract major moved v${oldMajor} -> v${newMajor}: ${reasons.join('; ')}`, ...moved],
    };
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-major-return
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-major

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-fail
  return {
    decision: 'fail',
    notes: [`${component}: backward-incompatible at contract major v${oldMajor} (unchanged) - ${reasons.join('; ')}`, ...moved],
  };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-fail
}

// Extracts the major version off the LAST segment of a component contract's
// $id (…component.<name>.v<major>~ or, for a synthetic compat id, the same
// with a trailing minor token: …v<major>.<minor>~). ids.ts's propsSchemaId
// never emits a minor, so this only ever needs to look at the token
// immediately before the trailing `~`.
export function extractContractMajor(id: string): number {
  const match = /\.v(\d+)(?:\.\d+)?~?$/.exec(id);
  if (!match) {
    throw new Error(`extractContractMajor: "${id}" does not end in a GTS version segment`);
  }
  return Number.parseInt(match[1], 10);
}

// Rewrites a component contract's $id with a synthetic minor version before
// the trailing `~`, so two contracts that share the same real $id (the
// normal case: same component, same major, base ref vs working tree) can be
// registered in one GTS store under distinct ids. ids.ts never emits a
// minor itself, so this never collides with a real id.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-register
export function synthesizeVersionedId(id: string, minor: number): string {
  if (!id.endsWith('~')) {
    throw new Error(`synthesizeVersionedId: "${id}" is not a type id (does not end in "~")`);
  }
  return `${id.slice(0, -1)}.${minor}~`;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-register

// Maps a list of changed file paths (package-relative, as `git diff
// --relative` reports them) to the component directories under
// src/components/ they touch. A file outside src/components/ - a fixture, a
// test - maps to nothing here, which is the correct answer for THIS
// function: it only ever answers "which directory's own files changed",
// never "which components does this change affect" - a change under
// scripts/contracts/** that reshapes every compiled contract (the compiler,
// the extractor, the metamodel, a committed element surface) is a
// DIFFERENT question, answered by touchesSharedContractTooling below, not by
// widening this regex.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-map
export function mapChangedFilesToComponents(changedFiles: string[]): Set<string> {
  const components = new Set<string>();
  for (const file of changedFiles) {
    const match = /^src\/components\/([a-z][a-z0-9-]*)\//.exec(file);
    if (match) components.add(match[1]);
  }
  return components;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-map

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen
const CONTRACTS_TOOLING_PREFIX = 'scripts/contracts/';
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen

// Files under scripts/contracts/ that are neither shared build/extraction
// logic nor a hand-authored input to it: the guard's own entry point (a bug
// fix in check.ts cannot change what any component compiles to, and
// re-checking every enrolled component because check.ts changed would be
// circular, since check.ts is what performs that check), its unit tests,
// and prose. Everything else directly under scripts/contracts/ (compile.ts,
// extract.ts, ids.ts, freshness.ts, testing.ts, check-lib.ts,
// base.component.json, ui-component.meta.json, every committed element
// surface) participates in producing or comparing EVERY enrolled component's
// compiled output, so a change to any of it invalidates the "only the
// touched directory needs re-checking" assumption mapChangedFilesToComponents
// makes (M6 - the review's own name for exactly this blind spot).
//
// check-lib.ts belongs on the participating side despite holding the guard's
// own decision rules, and was wrongly excluded here: freshness.ts imports
// jsonDiff from this module, so every freshness decision for every enrolled
// component runs through this file. A jsonDiff change can flip all of them
// while touching no component directory - exactly the blind spot the widening
// exists to close. The circularity argument covers check.ts alone, which
// nothing in the comparison path imports.
//
// Only three entries, and every one of them is REACHABLE: a `.test.ts` suffix
// is already excluded above, so naming one here said nothing. An unreachable
// entry in a set like this is worse than no entry - it reads as a decision
// somebody took about that file, and the next person to add a test file has
// to work out whether the omission was deliberate.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen
const NON_TOOLING_CONTRACTS_FILES = new Set(['check.ts', 'enrolled.json', 'PILOT-NOTES.md']);
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen

// Whether any changed file is shared contract-compiling machinery (see
// NON_TOOLING_CONTRACTS_FILES above for what is deliberately excluded).
// check.ts's guard treats "yes" as a reason to re-evaluate freshness for
// EVERY entry in enrolled.json, not just the components whose own directory
// changed - a compiler/extractor/metamodel edit can silently reshape a
// component's compiled contract without touching that component's own
// files at all.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen
export function touchesSharedContractTooling(changedFiles: string[]): boolean {
  return changedFiles.some((file) => {
    if (!file.startsWith(CONTRACTS_TOOLING_PREFIX)) return false;
    const rest = file.slice(CONTRACTS_TOOLING_PREFIX.length);
    if (rest.startsWith('__fixtures__/')) return false;
    if (rest.endsWith('.test.ts')) return false;
    return !NON_TOOLING_CONTRACTS_FILES.has(rest);
  });
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen

// The enrolled set is not compile-or-compare tooling - editing it
// changes no component's compiled output - but it decides WHICH components
// the guard holds to the full standard, so a change to it has to put every
// entry it now names back in scope. Without this the file could be edited
// freely: an entry added for a directory with no overlay, or left behind for
// a directory that no longer exists, was checked by nothing until some
// unrelated change happened to touch that directory. Its own signal rather
// than a widening of touchesSharedContractTooling, so the two reasons stay
// distinguishable in the guard's own output and in the rule above.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist
const ENROLLMENT_FILE = `${CONTRACTS_TOOLING_PREFIX}enrolled.json`;

export function touchesEnrollmentList(changedFiles: string[]): boolean {
  return changedFiles.includes(ENROLLMENT_FILE);
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist

// A third widening signal, and the one the filled `mounted_in` made
// necessary: a component's mount points are computed from every OTHER
// overlay's `accepts.components`, so editing one overlay's accepted list
// changes the compiled contract of whatever component that list names - a
// component in a different directory, which no change-set mapping would put
// in scope. The guard would then report the edited directory as fresh and
// never look at the contract the edit actually moved.
//
// Its own signal rather than a widening of touchesSharedContractTooling, for
// the same reason the allowlist has one: the two reasons stay distinguishable
// in the guard's own output, and this one is about authored content rather
// than about the machinery that compiles it.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-overlay
export function touchesAnyOverlay(changedFiles: string[]): boolean {
  return changedFiles.some((file) => /^src\/components\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\.contract\.yaml$/.test(file));
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-overlay

// A fourth widening signal, and the one that is not about this repository's
// own code at all. A committed contract embeds the CHECKER's printed type
// text for every property the provider-safe subset cannot express - the
// primitive library's `AccordionValue<Value>`, React's `CSSProperties` - so a
// dependency bump reshapes every described component's artifacts while no
// file under src/components or scripts/contracts changes. Nothing in the
// guard's scope would have noticed, and the lockfile is not even visible to
// the package-relative diff the change set is otherwise collected from, which
// is why this signal takes both listings.
//
// Two paths, and they answer two different questions: the package's own
// `package.json` says which version range is asked for, and the repository's
// lockfile says which version is installed. A bump can move either one
// alone - a range widened without reinstalling, a lockfile refreshed inside
// an unchanged range - and both change what the checker prints.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-deps
export function touchesDependencyManifest(packageRelativeFiles: string[], repoRelativeFiles: string[]): boolean {
  if (packageRelativeFiles.includes('package.json')) return true;
  return repoRelativeFiles.some((file) => file === 'package-lock.json' || file.endsWith('/package-lock.json'));
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-deps

// A base-ref contract file `resolveRenameSource` can compare a "not found at
// this path" unit against - `path` is package-relative (matches
// `checkCompatForUnit`'s own relPath convention), `id` is the contract's own
// `$id`, `stem` is the filename with `.contract.json` stripped (the same
// "stem" `ContractUnit` uses).
export interface BaseRefContractEntry {
  path: string;
  id: string;
  stem: string;
}

// Which base-ref contract path (if any) is the right thing to diff a
// contract unit's CURRENT compiled JSON against, when the unit's own path
// did not exist at the base ref (M7). Three escalating signals:
//  1. git's own rename detection named an old path for this exact new path
//     (the ordinary case: a plain `git mv` plus content edits within git's
//     similarity threshold);
//  2. a base-ref contract's own $id matches the unit's current $id - the id
//     survives a directory rename even when the accompanying content change
//     drops file similarity below git's rename threshold, so `-M` alone
//     would call it a delete+add;
//  3. a base-ref contract shares the unit's stem under a different path - a
//     directory rename with enough content churn that neither of the above
//     caught it, but the two are still "the same component" by name.
// Undefined means genuinely new: nothing at the base ref plausibly is this
// contract's prior version, so treating it as new (no baseline to compare
// against) is the honest answer, not a masked breaking change.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
export function resolveRenameSource(input: {
  currentPath: string;
  currentId: string;
  currentStem: string;
  renamedFrom?: string;
  baseContracts: BaseRefContractEntry[];
}): string | undefined {
  if (input.renamedFrom) return input.renamedFrom;
  const byId = input.baseContracts.find((entry) => entry.id === input.currentId && entry.path !== input.currentPath);
  if (byId) return byId.path;
  const byStem = input.baseContracts.find((entry) => entry.stem === input.currentStem && entry.path !== input.currentPath);
  return byStem?.path;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve

// A contract that shipped at the base reference and is compared against
// nothing here: no committed contract found it by path, by rename record, by
// identifier or by name. Every unit on disk is compared against its own past;
// a contract that is only in the past is visited by no unit at all, so a
// deletion - and a rename whose two halves neither git nor resolveRenameSource
// could pair up - used to leave the whole comparison silent.
export interface ContractRemoval {
  // The package-relative path the contract had at the base reference.
  path: string;
  stem: string;
  // The component directory the removed contract described.
  directory: string;
  acknowledged: boolean;
}

// A removal is backward-incompatible on its face: a consumer holding a
// reference to that contract's identifier now resolves nothing, and unlike a
// narrowing there is no surviving contract whose major could move to say so.
// The one acknowledgement the harness records is the one the guard already
// demands of a removed directory - the enrolled set no longer naming
// the component - so the two rules stay the same rule: while enrolled.json
// still names it, a vanished contract is a refusal; once it does not, the
// removal is reported and accepted.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1:inst-cr-find
export function findRemovedContracts(input: {
  baseContracts: BaseRefContractEntry[];
  comparedBasePaths: string[];
  enrolled: string[];
}): ContractRemoval[] {
  const compared = new Set(input.comparedBasePaths);
  const enrolledSet = new Set(input.enrolled);
  const removals: ContractRemoval[] = [];
  for (const entry of input.baseContracts) {
    if (compared.has(entry.path)) continue;
    const directory = /^src\/components\/([^/]+)\//.exec(entry.path)?.[1] ?? entry.stem;
    removals.push({ path: entry.path, stem: entry.stem, directory, acknowledged: !enrolledSet.has(directory) });
  }
  return removals;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1:inst-cr-find

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1:inst-cr-decide
export function decideRemoval(removal: ContractRemoval): CompatDecision {
  if (removal.acknowledged) {
    return {
      decision: 'pass',
      notes: [
        `${removal.stem}: contract removed (${removal.path} at the base ref) - "${removal.directory}" is no longer in enrolled.json, so the removal is acknowledged`,
      ],
    };
  }
  return {
    decision: 'fail',
    notes: [
      `${removal.stem}: contract removed (${removal.path} at the base ref) while "${removal.directory}" is still listed in enrolled.json - a removed contract resolves to nothing for a consumer holding it; drop the enrolled.json entry to acknowledge the removal, or restore the contract`,
    ],
  };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1:inst-cr-decide

export interface GuardEvaluationInput {
  component: string;
  enrolled: boolean;
  overlayExists: boolean;
  artifactsFresh: boolean;
  // False when the component's own directory no longer exists on disk -
  // touched (git still lists its deleted files) but gone, not merely edited.
  // Optional and defaulted true so every pre-existing call site (and test)
  // keeps meaning exactly what it meant before this field existed.
  componentExists?: boolean;
  // Whether the directory ships a `*.contract.test.ts`. The freshness
  // comparison a enrolled component is held to is asserted in TWO runs on
  // purpose - the guard's, and the component's own unit run - and the second
  // one only happens if the suite exists. Without it, staleness reaches the
  // developer who caused it only when continuous integration says so, which
  // is the slower half of the pair the design is built on.
  contractTestExists?: boolean;
  // Whether the enrolled set named this component at the base
  // reference. A component dropped from the list is out of scope from the
  // next change onward, so the change that drops it is the last one that can
  // say anything about it.
  wasEnrolled?: boolean;
}

export interface GuardResult {
  component: string;
  status: 'enrolled-ok' | 'enrolled-violation' | 'unenrolled-info' | 'component-removed' | 'enrollment-dropped';
  message: string;
}

// A component touched but not (yet) in enrolled.json is informational, never
// a failure - enrolled.json is an opt-in allowlist growing one component at a
// time (T5, T6, ...), not a floor every touched directory must already meet.
// Once a component IS in enrolled.json, the guard holds it to what T4
// promises for Button: an overlay must exist, and the committed artifacts
// must be exactly what a fresh compile produces.
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-guard-scope:p1
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-guard:p1
export function evaluateGuard(input: GuardEvaluationInput): GuardResult {
  const {
    component,
    enrolled,
    overlayExists,
    artifactsFresh,
    componentExists = true,
    contractTestExists = true,
    wasEnrolled = enrolled,
  } = input;
  // A deleted directory is a designed outcome (M10), not a crash: only a
  // problem when enrolled.json still names a component that no longer
  // exists - an unenrolled deletion is exactly as uninteresting
  // as any other unenrolled change.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-removed
  if (!componentExists) {
    return enrolled
      ? {
          component,
          status: 'component-removed',
          message: `${component}: directory removed but still listed in enrolled.json - remove it from enrolled.json`,
        }
      : { component, status: 'unenrolled-info', message: `${component}: directory removed - nothing to check` };
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-removed
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-unenrolled
  if (!enrolled) {
    // Dropped from the allowlist by THIS change: reported rather than
    // failed, because de-listing is a legitimate act (it is the one
    // acknowledgement the harness records for a removed contract), but it is
    // also the last moment anything says the component's artifacts stop
    // being guarded. Silence here is how a component left the enrolled set
    // with no line in any run's output.
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-delisted
    if (wasEnrolled) {
      return {
        component,
        status: 'enrollment-dropped',
        message:
          `${component}: dropped from enrolled.json by this change - its committed contract artifacts are no longer ` +
          `guarded for freshness or compatibility from here on`,
      };
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-delisted
    return {
      component,
      status: 'unenrolled-info',
      message: `${component}: touched, not in enrolled.json - no contract required yet`,
    };
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-unenrolled
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-enrolled
  if (!overlayExists) {
    return {
      component,
      status: 'enrolled-violation',
      message: `${component}: enrolled but has no ${component}.contract.yaml overlay`,
    };
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-enrolled
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-suite
  if (!contractTestExists) {
    return {
      component,
      status: 'enrolled-violation',
      message:
        `${component}: enrolled but ships no ${component}.contract.test.ts - the freshness ` +
        `comparison would then only ever run in continuous integration, never in the unit run of whoever changed it`,
    };
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-suite
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-enrolled
  if (!artifactsFresh) {
    return {
      component,
      status: 'enrolled-violation',
      message: `${component}: enrolled but its committed contract artifacts are stale - run npm run contracts:compile -- ${component}`,
    };
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-enrolled
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-enrolled
  return { component, status: 'enrolled-ok', message: `${component}: enrolled and fresh` };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-enrolled
}

export interface EnrollmentReport {
  total: number;
  enrolledCount: number;
  unenrolled: string[];
  // Allowlist entries that name no component directory at all. Counted out
  // of enrolledCount rather than into it: the number is meant to say how much
  // of the kit is described, and an entry pointing at nothing describes
  // nothing - it used to be indistinguishable from a real one, so a typo or
  // a deleted directory quietly inflated the figure the report exists to
  // give.
  unknownEnrolled: string[];
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-count
export function buildEnrollmentReport(allComponents: string[], enrolled: string[]): EnrollmentReport {
  const componentSet = new Set(allComponents);
  const enrolledSet = new Set(enrolled);
  const unenrolled = allComponents.filter((component) => !enrolledSet.has(component)).sort();
  const unknownEnrolled = enrolled.filter((component) => !componentSet.has(component)).sort();
  return { total: allComponents.length, enrolledCount: enrolled.length - unknownEnrolled.length, unenrolled, unknownEnrolled };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-count

export interface DirectoryExportEnrollment {
  directory: string;
  // How many of the directory's exported components (extractComponent's
  // result for its .tsx) have a `<stem>.contract.yaml` overlay directly
  // under it, out of how many are exported in total. A directory with one
  // export (the norm) is either 0 of 1 or 1 of 1 - the interesting case T5
  // adds is a compound directory partway through being described.
  totalExports: number;
  enrolledExports: number;
  // Exported names the extractor did not generate a contract for because
  // they are not a React component - a helper function, a feature-set
  // const, a type/interface (T6: data-table.tsx's dataTableColumnHelper,
  // dataTableFeatures, dataTableSelectionColumn, DataTableSelectionColumnLabels).
  // Reported so "2 of 6 exports" reads as "4 correctly excluded", not "4
  // undescribed gaps".
  skippedNonComponents: string[];
}

// What a props object looks like against one contract: which names the
// contract or the element surface it names accounts for, which nothing
// accounts for, and which of those are one edit away from a real kit prop.
//
// This is the report that replaces `unevaluatedProperties: false`. Closing
// the schema made Ajv answer "invalid" to two different things - a typo'd kit
// prop, and a name this harness has not classified yet (a new React
// attribute, a prop of a primitive part nobody has described) - and only the
// first is a mistake. Splitting them needs a comparison the schema cannot
// make: `variannt` is an error because `variant` exists, while `tooltip` is
// merely unchecked. So the schema admits everything and annotates the
// classification (compile.ts's OPEN_UNEVALUATED), and this is where the
// classification is decided.
//
// The consumer this exists for - a plan validator that reads a component's
// props before anything renders - is out of scope here; what is in scope is
// that the harness owns the rule rather than each caller reinventing an edit
// distance.
export interface ContractPropsLike {
  properties?: Record<string, unknown>;
}

export interface ElementSurfacePropsLike {
  properties?: Record<string, unknown>;
  patternProperties?: Record<string, unknown>;
}

export interface PropsClassification {
  // Declared by the contract itself, or by the element surface it names,
  // or matching one of that surface's patterns (aria-*, data-*, on*) without
  // being one edit from a prop the contract declares - see classifyProps for
  // why that order matters.
  known: string[];
  // Accounted for by nothing. Not an error on its own: the schema admits it
  // and says so.
  unchecked: string[];
  // The subset of `unchecked` within one edit of a prop the CONTRACT declares
  // - the kit's own API, not the DOM surface underneath it, because a
  // near-miss of `className` is a typo in a DOM attribute and a near-miss of
  // `variant` is a typo in the thing this contract exists to describe. Each
  // entry names what it is probably meant to be, so a caller can say it.
  nearMiss: { prop: string; probably: string }[];
}

// Levenshtein distance, bounded at 2 - the only question asked of it is
// "exactly one edit apart", and a full matrix over two prop names is cheap
// enough that the bound is for clarity rather than for speed.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-distance
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-distance

// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-classify
export function classifyProps(
  props: Record<string, unknown>,
  contract: ContractPropsLike,
  surface?: ElementSurfacePropsLike,
): PropsClassification {
  const contractProps = Object.keys(contract.properties ?? {});
  const elementProps = new Set(Object.keys(surface?.properties ?? {}));
  const patterns = Object.keys(surface?.patternProperties ?? {}).map((source) => new RegExp(source));
  const declared = new Set(contractProps);

  const known: string[] = [];
  const unchecked: string[] = [];
  const nearMiss: { prop: string; probably: string }[] = [];

  for (const name of Object.keys(props).sort()) {
    // An exact declaration on either side accounts for the name outright.
    if (declared.has(name) || elementProps.has(name)) {
      known.push(name);
      continue;
    }
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-near-miss
    // The near miss is decided BEFORE the patterns, because a pattern cannot
    // tell one from a name it was written for: `^on[A-Z]` matches
    // `onValuechange` exactly as readily as `onValueChange`, so a pattern
    // consulted first answered "known" to a typo in the one half of the
    // contract this report exists to protect.
    const probably = contractProps.filter((candidate) => editDistance(name, candidate) === 1).sort()[0];
    if (probably !== undefined) {
      unchecked.push(name);
      nearMiss.push({ prop: name, probably });
      continue;
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-near-miss
    if (patterns.some((pattern) => pattern.test(name))) {
      known.push(name);
      continue;
    }
    unchecked.push(name);
  }

  return { known, unchecked, nearMiss };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-classify

// The prop names one JSX snippet passes to one component, once per opening
// tag it contains. A scanner rather than a parser: the snippets this reads
// are a contract's own `examples`, which are fragments, not modules - no
// TypeScript program can be built over them, and the question asked of them
// is only "which names were written here".
//
// It walks the tag rather than matching attributes with a pattern, because
// an attribute value can contain anything a JSX expression can - `icon={<X
// />}`, `onClick={() => {}}`, a string holding a `>` - and a pattern over
// the raw text reads names out of those too.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-usage
export function propsPassedTo(code: string, componentName: string): string[][] {
  const usages: string[][] = [];
  // The lookahead keeps `<Accordion` from matching `<AccordionItem`: an
  // example for the root routinely contains its parts.
  const opener = new RegExp(`<${componentName}(?![A-Za-z0-9_])`, 'g');
  let match = opener.exec(code);
  while (match !== null) {
    const names: string[] = [];
    let index = opener.lastIndex;
    let braceDepth = 0;
    let quote: string | undefined;
    while (index < code.length) {
      const char = code[index];
      if (quote !== undefined) {
        if (char === quote) quote = undefined;
        index += 1;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        index += 1;
        continue;
      }
      if (char === '{') {
        braceDepth += 1;
        index += 1;
        continue;
      }
      if (char === '}') {
        braceDepth -= 1;
        index += 1;
        continue;
      }
      // Only outside an expression value is an identifier a prop name; a
      // `{...rest}` spread and everything inside a value are skipped.
      if (braceDepth === 0 && char === '>') break;
      if (braceDepth === 0 && /[A-Za-z_]/.test(char)) {
        const name = /^[A-Za-z0-9_:.-]*/.exec(code.slice(index))?.[0] ?? '';
        names.push(name);
        index += name.length;
        continue;
      }
      index += 1;
    }
    usages.push(names);
    match = opener.exec(code);
  }
  return usages;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-usage

// One near miss, with everything a caller needs to fix it: which usage it
// was found in, the name that was written, and the kit prop it is one edit
// from.
export interface NearMissFinding {
  component: string;
  source: string;
  prop: string;
  probably: string;
}

// The near misses in a set of usages of one component. This is the
// enforcement path the annotated open schema needs: the schema admits every
// name and records the classification, so `variannt="ghost"` is rejected by
// nothing unless something runs the classification and derives a failure
// from it. classifyProps decides what a near miss IS; this is what turns one
// into an exit code, and it lives beside the classification rather than in
// each caller so a fourth enrolled component is protected without its test
// author remembering to ask.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce
export function nearMissesIn(
  component: string,
  usages: readonly { source: string; props: readonly string[] }[],
  contract: ContractPropsLike,
  surface?: ElementSurfacePropsLike,
): NearMissFinding[] {
  const findings: NearMissFinding[] = [];
  for (const usage of usages) {
    const props: Record<string, unknown> = {};
    for (const name of usage.props) props[name] = true;
    for (const { prop, probably } of classifyProps(props, contract, surface).nearMiss) {
      findings.push({ component, source: usage.source, prop, probably });
    }
  }
  return findings;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce

// Which props a component forwards to its host element that the committed
// surface for that element declares by neither name nor pattern. The
// surfaces are hand-written, and their completeness is deliberately
// unverified: nobody enumerates React's attributes for an element, so an
// attribute the file does not name is not an error - it is a prop that
// reaches a consumer as unchecked instead of as known. What was missing was
// any way to SEE that set, which is what this is: a report the enrollment
// command prints and no exit code is derived from.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-forwarded
export function undeclaredForwardedProps(forwarded: readonly string[], surface?: ElementSurfacePropsLike): string[] {
  const declared = new Set(Object.keys(surface?.properties ?? {}));
  const patterns = Object.keys(surface?.patternProperties ?? {}).map((source) => new RegExp(source));
  return [...forwarded]
    .filter((name) => !declared.has(name) && !patterns.some((pattern) => pattern.test(name)))
    .sort();
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-forwarded
