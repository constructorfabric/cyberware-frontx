// Pure logic for the contract checks (compat, guard, coverage): everything
// here takes already-loaded JSON or file lists and returns a verdict - no
// filesystem, no git, no gts-ts. check.ts is the thin, impure shell that
// loads inputs (git show, fs.readFileSync, GTS.checkCompatibility) and hands
// them to these functions; keeping the split lets the decision rules be unit
// tested with in-memory fixtures instead of a checked-out git ref.

// Structural JSON diff, order-independent for objects (JSON.stringify would
// report two schemas that only differ in property insertion order as
// unequal, which a freshly compiled schema and its committed copy have no
// reason to guarantee). Used both for contract/instance/passthrough
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

export interface PassthroughPropertyLike {
  type?: string;
  enum?: string[];
  // Declared so the diff below can be seen NOT to read it. A property that
  // asserts nothing carries prose naming its TypeScript type (compile.ts's
  // describeUntypeableProperty), and prose is documentation: adding,
  // rewording or dropping it rejects nothing a consumer used to pass, so it
  // is not a compatibility signal in either direction.
  description?: string;
}

export interface PassthroughSchemaLike {
  properties?: Record<string, PassthroughPropertyLike>;
  required?: string[];
}

export interface PassthroughDiff {
  added: string[];
  removed: string[];
  narrowed: { prop: string; reason: string }[];
  // An element-kind passthrough type is one of several in-place applicators a
  // component schema composes (see its own $comment) - gts-ts's flat
  // property/required/enum comparison never sees it, because it never
  // resolves the component contract's allOf/$ref. This is the check that
  // closes that gap: an added forwarded prop only widens what a consumer may
  // pass (backward compatible), while a removed prop or a narrowed enum/type
  // can reject something that used to validate.
  compatible: boolean;
}

// The name-level half of the forwarded-surface comparison: which forwarded
// props vanished, which arrived, and which became mandatory. Split out from
// the shape checks below because the two answer different questions and a
// reader of either should not have to skip the other.
function comparePassthroughNames(
  oldSchema: PassthroughSchemaLike,
  newSchema: PassthroughSchemaLike,
): { added: string[]; removed: string[]; newlyRequired: string[] } {
  const oldProps = oldSchema.properties ?? {};
  const newProps = newSchema.properties ?? {};
  // A prop the new schema requires and the old one did not rejects a props
  // object that used to validate (the prop simply absent) - the same
  // "changed shape" the type/enum checks in diffPassthroughSchema treat as
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
    newlyRequired: (newSchema.required ?? []).filter((name) => name in newProps && !oldRequired.has(name)),
  };
}

const NEWLY_REQUIRED_REASON = 'became required where it was optional (or absent) before';

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-passthrough
export function diffPassthroughSchema(oldSchema: PassthroughSchemaLike, newSchema: PassthroughSchemaLike): PassthroughDiff {
  const oldProps = oldSchema.properties ?? {};
  const newProps = newSchema.properties ?? {};
  const { added, removed, newlyRequired } = comparePassthroughNames(oldSchema, newSchema);
  const narrowed: { prop: string; reason: string }[] = [];
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-passthrough

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-passthrough
  for (const name of Object.keys(oldProps)) {
    if (!(name in newProps)) continue;
    const oldProp = oldProps[name];
    const newProp = newProps[name];

    // A type constraint that changes, OR that appears where none existed,
    // both reject a value the old (unconstrained, or differently typed)
    // prop used to accept - narrowing either way. The reverse - a type
    // constraint lifted entirely - accepts a strict superset, so it is not
    // checked here at all.
    if (oldProp.type !== undefined && newProp.type !== undefined && oldProp.type !== newProp.type) {
      narrowed.push({ prop: name, reason: `type changed from "${oldProp.type}" to "${newProp.type}"` });
    } else if (oldProp.type === undefined && newProp.type !== undefined) {
      narrowed.push({ prop: name, reason: `type constraint added: "${newProp.type}" where none existed before` });
    }

    // Same reasoning for enum: a dropped value out of an existing enum, or
    // a whole enum appearing where the prop previously accepted any value
    // of its type, both narrow independently of whatever the type check
    // above found. An enum lifted entirely (the prop keeps its type, just
    // no enum) is the widening direction and is not flagged.
    if (oldProp.enum !== undefined && newProp.enum !== undefined) {
      const newEnumValues = new Set(newProp.enum);
      const droppedValues = oldProp.enum.filter((value) => !newEnumValues.has(value));
      if (droppedValues.length > 0) {
        narrowed.push({ prop: name, reason: `enum value(s) removed: ${droppedValues.join(', ')}` });
      }
    } else if (oldProp.enum === undefined && newProp.enum !== undefined) {
      narrowed.push({ prop: name, reason: `enum constraint added: ${newProp.enum.join(', ')} where none existed before` });
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-passthrough

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-passthrough
  for (const name of newlyRequired) narrowed.push({ prop: name, reason: NEWLY_REQUIRED_REASON });
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-passthrough

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-passthrough
  return { added, removed, narrowed, compatible: removed.length === 0 && narrowed.length === 0 };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-passthrough

// gts-ts's own `checkCompatibility(..., 'backward')` diffs a component's OWN
// properties/required the same shallow way `diffPassthroughSchema` diffs the
// passthrough surface - but empirically (see check-lib.compat-e2e.test.ts,
// M9) its BACKWARD direction only ever flags a prop that both (a) existed in
// the old schema and (b) was already required there, then disappeared; it
// never inspects whether a prop gained `required` status (new prop, or an
// existing optional one tightened), because that shape only shows up in the
// FORWARD direction's `forward_errors`, which this tool's `compat` command
// never reads. For a component's PROPS SCHEMA - the shape a consumer's call
// site must satisfy - "does an old caller's props object still validate"
// is exactly what `is_backward_compatible` claims to answer, so a newly
// required prop (or an old prop simply vanishing, required or not - a rename
// looks exactly like this) is a real backward break the library's own
// implementation misses. This closes that gap locally, the same way
// `diffPassthroughSchema` above closes the analogous gap for forwarded props.
export interface OwnPropsSchemaLike {
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface OwnPropsDiff {
  removedProps: string[];
  newlyRequiredProps: string[];
  compatible: boolean;
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own
export function diffOwnPropsSchema(oldSchema: OwnPropsSchemaLike, newSchema: OwnPropsSchemaLike): OwnPropsDiff {
  const oldProps = oldSchema.properties ?? {};
  const newProps = newSchema.properties ?? {};
  const oldRequired = new Set(oldSchema.required ?? []);
  const newRequired = new Set(newSchema.required ?? []);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own
  const removedProps = Object.keys(oldProps).filter((name) => !(name in newProps));
  const newlyRequiredProps = [...newRequired].filter((name) => !oldRequired.has(name));

  return { removedProps, newlyRequiredProps, compatible: removedProps.length === 0 && newlyRequiredProps.length === 0 };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own

// Which forwarded-surface comparison a contract's two revisions admit. The
// host element is read from EACH revision's own allOf rather than from the
// new one alone: a contract that dropped its passthrough $ref outright has no
// element to look up, so reading only the new side skipped the whole block
// and reported "compatible" for a change that removed every forwarded prop at
// once. Four shapes, and only the last is the ordinary one:
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
export interface PassthroughComparisonInput {
  component: string;
  // The host element each revision's own allOf names, undefined when that
  // revision composes no passthrough type at all.
  oldElement?: string;
  newElement?: string;
  // The schema for that revision's element - at the base ref for the old one,
  // as committed here for the new one - undefined when the file is absent.
  oldSchema?: PassthroughSchemaLike;
  newSchema?: PassthroughSchemaLike;
}

export interface PassthroughComparison {
  diff?: PassthroughDiff;
  note?: string;
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-both
export function comparePassthroughSurfaces(input: PassthroughComparisonInput): PassthroughComparison {
  const { component, oldElement, newElement, oldSchema, newSchema } = input;

  if (oldElement === undefined) return {};
  if (oldSchema === undefined) {
    return {
      note: `${component}: forwarded-surface signal skipped - the base ref carries no passthrough type for element "${oldElement}"`,
    };
  }
  if (newElement === undefined) {
    return {
      diff: diffPassthroughSchema(oldSchema, {}),
      note: `${component}: the contract no longer composes the forwarded surface it carried at the base ref (element "${oldElement}")`,
    };
  }
  if (newSchema === undefined) {
    return {
      note: `${component}: forwarded-surface signal skipped - no committed passthrough type for element "${newElement}"`,
    };
  }
  return {
    diff: diffPassthroughSchema(oldSchema, newSchema),
    note:
      oldElement === newElement
        ? undefined
        : `${component}: host element moved "${oldElement}" -> "${newElement}"`,
  };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-both

export interface CompatDecisionInput {
  component: string;
  oldMajor: number;
  newMajor: number;
  gtsBackwardCompatible: boolean;
  gtsBackwardErrors: string[];
  passthroughDiff?: PassthroughDiff;
  ownPropsDiff?: OwnPropsDiff;
}

export interface CompatVerdict {
  status: 'pass' | 'fail';
  notes: string[];
}

// The decision rule T4 specifies: a contract that is backward-incompatible
// (by any signal - gts-ts's own schema-body comparison, the passthrough
// structural diff above, or the own-props diff above) is only acceptable
// when the contract major in its $id moved, because that is the one visible
// acknowledgement that consumers built against the old major are expected to
// break. An unchanged major carrying an incompatible change would ship a
// props schema that silently rejects code that used to validate.
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-compatibility:p1
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1
export function decideCompat(input: CompatDecisionInput): CompatVerdict {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-combine
  const { component, oldMajor, newMajor, gtsBackwardCompatible, gtsBackwardErrors, passthroughDiff, ownPropsDiff } = input;
  const passthroughIncompatible = passthroughDiff !== undefined && !passthroughDiff.compatible;
  const ownPropsIncompatible = ownPropsDiff !== undefined && !ownPropsDiff.compatible;
  const incompatible = !gtsBackwardCompatible || passthroughIncompatible || ownPropsIncompatible;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-combine

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-pass
  if (!incompatible) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-pass-return
    return { status: 'pass', notes: [`${component}: backward compatible`] };
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-pass-return
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-pass

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-combine
  const reasons = [
    ...gtsBackwardErrors,
    ...(ownPropsDiff?.removedProps.map((prop) => `own prop "${prop}" removed`) ?? []),
    ...(ownPropsDiff?.newlyRequiredProps.map((prop) => `own prop "${prop}" became required`) ?? []),
    ...(passthroughDiff?.removed.map((prop) => `passthrough: prop "${prop}" removed`) ?? []),
    ...(passthroughDiff?.narrowed.map((entry) => `passthrough: prop "${entry.prop}" ${entry.reason}`) ?? []),
  ];
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-combine

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-major
  if (newMajor > oldMajor) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-major-return
    return {
      status: 'pass',
      notes: [`${component}: backward-incompatible, but the contract major moved v${oldMajor} -> v${newMajor}: ${reasons.join('; ')}`],
    };
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-major-return
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-major

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-fail
  return {
    status: 'fail',
    notes: [`${component}: backward-incompatible at contract major v${oldMajor} (unchanged) - ${reasons.join('; ')}`],
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
// the extractor, the metamodel, a generated passthrough file) is a
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
// re-checking every covered component because check.ts changed would be
// circular, since check.ts is what performs that check), its unit tests,
// and prose. Everything else directly under scripts/contracts/ (compile.ts,
// extract.ts, ids.ts, freshness.ts, testing.ts, check-lib.ts,
// base.component.json, ui-component.meta.json, every generated passthrough
// file) participates in producing or comparing EVERY covered component's
// compiled output, so a change to any of it invalidates the "only the
// touched directory needs re-checking" assumption mapChangedFilesToComponents
// makes (M6 - the review's own name for exactly this blind spot).
//
// check-lib.ts belongs on the participating side despite holding the guard's
// own decision rules, and was wrongly excluded here: freshness.ts imports
// jsonDiff from this module, so every freshness verdict for every covered
// component runs through this file. A jsonDiff change can flip all of them
// while touching no component directory - exactly the blind spot the widening
// exists to close. The circularity argument covers check.ts alone, which
// nothing in the comparison path imports.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen
const NON_TOOLING_CONTRACTS_FILES = new Set(['check.ts', 'check-lib.test.ts', 'covered.json', 'PILOT-NOTES.md']);
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen

// Whether any changed file is shared contract-compiling machinery (see
// NON_TOOLING_CONTRACTS_FILES above for what is deliberately excluded).
// check.ts's guard treats "yes" as a reason to re-evaluate freshness for
// EVERY entry in covered.json, not just the components whose own directory
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

// The coverage allowlist is not compile-or-compare tooling - editing it
// changes no component's compiled output - but it decides WHICH components
// the guard holds to the full standard, so a change to it has to put every
// entry it now names back in scope. Without this the file could be edited
// freely: an entry added for a directory with no overlay, or left behind for
// a directory that no longer exists, was checked by nothing until some
// unrelated change happened to touch that directory. Its own signal rather
// than a widening of touchesSharedContractTooling, so the two reasons stay
// distinguishable in the guard's own output and in the rule above.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist
const COVERAGE_ALLOWLIST_FILE = `${CONTRACTS_TOOLING_PREFIX}covered.json`;

export function touchesCoverageAllowlist(changedFiles: string[]): boolean {
  return changedFiles.includes(COVERAGE_ALLOWLIST_FILE);
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist

// A third widening signal, and the one the derived `parent` made necessary: a
// component's allowed mount points are computed from every OTHER overlay's
// `composition.children`, so editing one overlay's children list changes the
// compiled contract of whatever component that list names - a component in a
// different directory, which no change-set mapping would put in scope. The
// guard would then report the edited directory as fresh and never look at the
// contract the edit actually moved.
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
// demands of a removed directory - the coverage allowlist no longer naming
// the component - so the two rules stay the same rule: while covered.json
// still names it, a vanished contract is a refusal; once it does not, the
// removal is reported and accepted.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1:inst-cr-find
export function findRemovedContracts(input: {
  baseContracts: BaseRefContractEntry[];
  comparedBasePaths: string[];
  covered: string[];
}): ContractRemoval[] {
  const compared = new Set(input.comparedBasePaths);
  const coveredSet = new Set(input.covered);
  const removals: ContractRemoval[] = [];
  for (const entry of input.baseContracts) {
    if (compared.has(entry.path)) continue;
    const directory = /^src\/components\/([^/]+)\//.exec(entry.path)?.[1] ?? entry.stem;
    removals.push({ path: entry.path, stem: entry.stem, directory, acknowledged: !coveredSet.has(directory) });
  }
  return removals;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1:inst-cr-find

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1:inst-cr-decide
export function decideRemoval(removal: ContractRemoval): CompatVerdict {
  if (removal.acknowledged) {
    return {
      status: 'pass',
      notes: [
        `${removal.stem}: contract removed (${removal.path} at the base ref) - "${removal.directory}" is no longer in covered.json, so the removal is acknowledged`,
      ],
    };
  }
  return {
    status: 'fail',
    notes: [
      `${removal.stem}: contract removed (${removal.path} at the base ref) while "${removal.directory}" is still listed in covered.json - a removed contract resolves to nothing for a consumer holding it; drop the covered.json entry to acknowledge the removal, or restore the contract`,
    ],
  };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1:inst-cr-decide

export interface GuardEvaluationInput {
  component: string;
  covered: boolean;
  overlayExists: boolean;
  artifactsFresh: boolean;
  // False when the component's own directory no longer exists on disk -
  // touched (git still lists its deleted files) but gone, not merely edited.
  // Optional and defaulted true so every pre-existing call site (and test)
  // keeps meaning exactly what it meant before this field existed.
  componentExists?: boolean;
}

export interface GuardResult {
  component: string;
  status: 'covered-ok' | 'covered-violation' | 'uncovered-info' | 'component-removed';
  message: string;
}

// A component touched but not (yet) in covered.json is informational, never
// a failure - covered.json is an opt-in allowlist growing one component at a
// time (T5, T6, ...), not a floor every touched directory must already meet.
// Once a component IS in covered.json, the guard holds it to what T4
// promises for Button: an overlay must exist, and the committed artifacts
// must be exactly what a fresh compile produces.
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-guard-scope:p1
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-guard:p1
export function evaluateGuard(input: GuardEvaluationInput): GuardResult {
  const { component, covered, overlayExists, artifactsFresh, componentExists = true } = input;
  // A deleted directory is a designed outcome (M10), not a crash: only a
  // problem when covered.json still names a component that no longer
  // exists - an untouched-by-coverage deletion is exactly as uninteresting
  // as any other uncovered change.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-removed
  if (!componentExists) {
    return covered
      ? {
          component,
          status: 'component-removed',
          message: `${component}: directory removed but still listed in covered.json - remove it from covered.json`,
        }
      : { component, status: 'uncovered-info', message: `${component}: directory removed - nothing to check` };
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-removed
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-uncovered
  if (!covered) {
    return {
      component,
      status: 'uncovered-info',
      message: `${component}: touched, not in covered.json - no contract required yet`,
    };
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-uncovered
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
  if (!overlayExists) {
    return {
      component,
      status: 'covered-violation',
      message: `${component}: covered by covered.json but has no ${component}.contract.yaml overlay`,
    };
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
  if (!artifactsFresh) {
    return {
      component,
      status: 'covered-violation',
      message: `${component}: covered by covered.json but its committed contract artifacts are stale - run npm run contracts:compile -- ${component}`,
    };
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
  return { component, status: 'covered-ok', message: `${component}: covered and fresh` };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
}

export interface CoverageReport {
  total: number;
  coveredCount: number;
  uncovered: string[];
  // Allowlist entries that name no component directory at all. Counted out
  // of coveredCount rather than into it: the number is meant to say how much
  // of the kit is described, and an entry pointing at nothing describes
  // nothing - it used to be indistinguishable from a real one, so a typo or
  // a deleted directory quietly inflated the figure the report exists to
  // give.
  unknownCovered: string[];
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count
export function buildCoverageReport(allComponents: string[], covered: string[]): CoverageReport {
  const componentSet = new Set(allComponents);
  const coveredSet = new Set(covered);
  const uncovered = allComponents.filter((component) => !coveredSet.has(component)).sort();
  const unknownCovered = covered.filter((component) => !componentSet.has(component)).sort();
  return { total: allComponents.length, coveredCount: covered.length - unknownCovered.length, uncovered, unknownCovered };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count

export interface DirectoryExportCoverage {
  directory: string;
  // How many of the directory's exported components (extractComponent's
  // result for its .tsx) have a `<stem>.contract.yaml` overlay directly
  // under it, out of how many are exported in total. A directory with one
  // export (the norm) is either 0 of 1 or 1 of 1 - the interesting case T5
  // adds is a compound directory partway through being described.
  totalExports: number;
  coveredExports: number;
  // Exported names the extractor did not generate a contract for because
  // they are not a React component - a helper function, a feature-set
  // const, a type/interface (T6: data-table.tsx's dataTableColumnHelper,
  // dataTableFeatures, dataTableSelectionColumn, DataTableSelectionColumnLabels).
  // Reported so "2 of 6 exports" reads as "4 correctly excluded", not "4
  // undescribed gaps".
  skippedNonComponents: string[];
}

// What a props object looks like against one contract: which names the
// contract or the element surface it composes accounts for, which nothing
// accounts for, and which of those are one edit away from a real kit prop.
//
// This is the report that replaces `unevaluatedProperties: false`. Closing
// the schema made Ajv answer "invalid" to two different things - a typo'd kit
// prop, and a name this harness has not classified yet (a new React
// attribute, a prop of a primitive part nobody has described) - and only the
// first is a mistake. Splitting them needs a comparison the schema cannot
// make: `variannt` is an error because `variant` exists, while `tooltip` is
// merely unchecked. So the schema admits everything and annotates the verdict
// (compile.ts's OPEN_UNEVALUATED), and this is where the verdict is decided.
//
// The consumer this exists for - a plan validator that reads a component's
// props before anything renders - is out of scope here; what is in scope is
// that the harness owns the rule rather than each caller reinventing an edit
// distance.
export interface ContractPropsLike {
  properties?: Record<string, unknown>;
}

export interface PassthroughPropsLike {
  properties?: Record<string, unknown>;
  patternProperties?: Record<string, unknown>;
}

export interface PropsClassification {
  // Declared by the contract itself, or by the element surface it composes,
  // or matching one of that surface's patterns (aria-*, data-*, on*).
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
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-unchecked-props:p1:inst-uc-distance
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
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-unchecked-props:p1:inst-uc-distance

// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-unchecked-props:p1
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-unchecked-props:p1:inst-uc-classify
export function classifyProps(
  props: Record<string, unknown>,
  contract: ContractPropsLike,
  passthrough?: PassthroughPropsLike,
): PropsClassification {
  const contractProps = Object.keys(contract.properties ?? {});
  const elementProps = new Set(Object.keys(passthrough?.properties ?? {}));
  const patterns = Object.keys(passthrough?.patternProperties ?? {}).map((source) => new RegExp(source));
  const declared = new Set(contractProps);

  const known: string[] = [];
  const unchecked: string[] = [];
  const nearMiss: { prop: string; probably: string }[] = [];

  for (const name of Object.keys(props).sort()) {
    if (declared.has(name) || elementProps.has(name) || patterns.some((pattern) => pattern.test(name))) {
      known.push(name);
      continue;
    }
    unchecked.push(name);
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-unchecked-props:p1:inst-uc-near-miss
    const probably = contractProps.filter((candidate) => editDistance(name, candidate) === 1).sort()[0];
    if (probably !== undefined) nearMiss.push({ prop: name, probably });
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-unchecked-props:p1:inst-uc-near-miss
  }

  return { known, unchecked, nearMiss };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-unchecked-props:p1:inst-uc-classify
