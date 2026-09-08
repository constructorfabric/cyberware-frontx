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
}

export interface PassthroughSchemaLike {
  properties?: Record<string, PassthroughPropertyLike>;
  required?: string[];
}

export interface PassthroughDiff {
  added: string[];
  removed: string[];
  narrowed: { prop: string; reason: string }[];
  // A generated passthrough type is one of several in-place applicators a
  // component schema composes (see compile.ts's buildPassthroughSchema
  // $comment) - gts-ts's flat property/required/enum comparison never sees
  // it, because it never resolves the component contract's allOf/$ref. This
  // is the check that closes that gap: an added forwarded prop only widens
  // what a consumer may pass (backward compatible), while a removed prop or
  // a narrowed enum/type can reject something that used to validate.
  compatible: boolean;
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-passthrough
export function diffPassthroughSchema(oldSchema: PassthroughSchemaLike, newSchema: PassthroughSchemaLike): PassthroughDiff {
  const oldProps = oldSchema.properties ?? {};
  const newProps = newSchema.properties ?? {};
  const added = Object.keys(newProps).filter((name) => !(name in oldProps));
  const removed = Object.keys(oldProps).filter((name) => !(name in newProps));
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
  // A prop that was optional and turns required rejects a value that used
  // to validate (the prop simply absent) - the same "changed shape" the
  // type/enum checks above already treat as narrowing, just on the
  // required list rather than on one property's own constraints.
  const oldRequired = new Set(oldSchema.required ?? []);
  const newlyRequired = (newSchema.required ?? []).filter(
    (name) => name in oldProps && name in newProps && !oldRequired.has(name),
  );
  for (const name of newlyRequired) {
    narrowed.push({ prop: name, reason: 'became required where it was optional (or absent) before' });
  }
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

// A component re-based onto a different primitive part changes its passthrough
// ORIGIN key, so `gitShow` looks for `passthrough.<new origin>.json` at the base
// ref and finds nothing. `passthroughDiff` then stays undefined and `decideCompat`
// reads the missing signal as "nothing incompatible" - the inherited surface
// changed wholesale and no one is told. This does not make the change a refusal
// (the old and new surfaces are not comparable prop-by-prop), but the skipped
// signal has to be visible in the report rather than inferred from its absence.
// A base ref carrying no generated passthrough type at all is the genuine
// first-contract case and stays silent.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-skipped
export function skippedPassthroughNote(
  component: string,
  origin: string,
  baseHasOriginFile: boolean,
  baseHasAnyPassthrough: boolean,
): string | undefined {
  if (baseHasOriginFile || !baseHasAnyPassthrough) return undefined;
  return `${component}: inherited-surface signal skipped - the base ref carries no passthrough type for origin "${origin}"`;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-skipped

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
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count
export function buildCoverageReport(allComponents: string[], covered: string[]): CoverageReport {
  const coveredSet = new Set(covered);
  const uncovered = allComponents.filter((component) => !coveredSet.has(component)).sort();
  return { total: allComponents.length, coveredCount: covered.length, uncovered };
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
