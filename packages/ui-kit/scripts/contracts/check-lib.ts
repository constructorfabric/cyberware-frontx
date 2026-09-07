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

export function diffPassthroughSchema(oldSchema: PassthroughSchemaLike, newSchema: PassthroughSchemaLike): PassthroughDiff {
  const oldProps = oldSchema.properties ?? {};
  const newProps = newSchema.properties ?? {};
  const added = Object.keys(newProps).filter((name) => !(name in oldProps));
  const removed = Object.keys(oldProps).filter((name) => !(name in newProps));
  const narrowed: { prop: string; reason: string }[] = [];

  for (const name of Object.keys(oldProps)) {
    if (!(name in newProps)) continue;
    const oldProp = oldProps[name];
    const newProp = newProps[name];
    if (oldProp.type !== undefined && newProp.type !== undefined && oldProp.type !== newProp.type) {
      narrowed.push({ prop: name, reason: `type changed from "${oldProp.type}" to "${newProp.type}"` });
      continue;
    }
    if (oldProp.enum) {
      const newEnumValues = new Set(newProp.enum ?? []);
      const droppedValues = oldProp.enum.filter((value) => !newEnumValues.has(value));
      if (droppedValues.length > 0) {
        narrowed.push({ prop: name, reason: `enum value(s) removed: ${droppedValues.join(', ')}` });
      }
    }
  }

  return { added, removed, narrowed, compatible: removed.length === 0 && narrowed.length === 0 };
}

export interface CompatDecisionInput {
  component: string;
  oldMajor: number;
  newMajor: number;
  gtsBackwardCompatible: boolean;
  gtsBackwardErrors: string[];
  passthroughDiff?: PassthroughDiff;
}

export interface CompatVerdict {
  status: 'pass' | 'fail';
  notes: string[];
}

// The decision rule T4 specifies: a contract that is backward-incompatible
// (by either signal - gts-ts's own schema-body comparison, or the
// passthrough structural diff above) is only acceptable when the contract
// major in its $id moved, because that is the one visible acknowledgement
// that consumers built against the old major are expected to break. An
// unchanged major carrying an incompatible change would ship a props schema
// that silently rejects code that used to validate.
export function decideCompat(input: CompatDecisionInput): CompatVerdict {
  const { component, oldMajor, newMajor, gtsBackwardCompatible, gtsBackwardErrors, passthroughDiff } = input;
  const passthroughIncompatible = passthroughDiff !== undefined && !passthroughDiff.compatible;
  const incompatible = !gtsBackwardCompatible || passthroughIncompatible;

  if (!incompatible) {
    return { status: 'pass', notes: [`${component}: backward compatible`] };
  }

  const reasons = [
    ...gtsBackwardErrors,
    ...(passthroughDiff?.removed.map((prop) => `passthrough: prop "${prop}" removed`) ?? []),
    ...(passthroughDiff?.narrowed.map((entry) => `passthrough: prop "${entry.prop}" ${entry.reason}`) ?? []),
  ];

  if (newMajor > oldMajor) {
    return {
      status: 'pass',
      notes: [`${component}: backward-incompatible, but the contract major moved v${oldMajor} -> v${newMajor}: ${reasons.join('; ')}`],
    };
  }

  return {
    status: 'fail',
    notes: [`${component}: backward-incompatible at contract major v${oldMajor} (unchanged) - ${reasons.join('; ')}`],
  };
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
export function synthesizeVersionedId(id: string, minor: number): string {
  if (!id.endsWith('~')) {
    throw new Error(`synthesizeVersionedId: "${id}" is not a type id (does not end in "~")`);
  }
  return `${id.slice(0, -1)}.${minor}~`;
}

// Maps a list of changed file paths (package-relative, as `git diff
// --relative` reports them) to the component directories under
// src/components/ they touch. A file outside src/components/ - compile.ts,
// package.json, a fixture - maps to nothing, which is the correct answer:
// the guard only cares about components, not the tooling that compiles them.
export function mapChangedFilesToComponents(changedFiles: string[]): Set<string> {
  const components = new Set<string>();
  for (const file of changedFiles) {
    const match = /^src\/components\/([a-z][a-z0-9-]*)\//.exec(file);
    if (match) components.add(match[1]);
  }
  return components;
}

export interface GuardEvaluationInput {
  component: string;
  covered: boolean;
  overlayExists: boolean;
  artifactsFresh: boolean;
}

export interface GuardResult {
  component: string;
  status: 'covered-ok' | 'covered-violation' | 'uncovered-info';
  message: string;
}

// A component touched but not (yet) in covered.json is informational, never
// a failure - covered.json is an opt-in allowlist growing one component at a
// time (T5, T6, ...), not a floor every touched directory must already meet.
// Once a component IS in covered.json, the guard holds it to what T4
// promises for Button: an overlay must exist, and the committed artifacts
// must be exactly what a fresh compile produces.
export function evaluateGuard(input: GuardEvaluationInput): GuardResult {
  const { component, covered, overlayExists, artifactsFresh } = input;
  if (!covered) {
    return {
      component,
      status: 'uncovered-info',
      message: `${component}: touched, not in covered.json - no contract required yet`,
    };
  }
  if (!overlayExists) {
    return {
      component,
      status: 'covered-violation',
      message: `${component}: covered by covered.json but has no ${component}.contract.yaml overlay`,
    };
  }
  if (!artifactsFresh) {
    return {
      component,
      status: 'covered-violation',
      message: `${component}: covered by covered.json but its committed contract artifacts are stale - run npm run contracts:compile -- ${component}`,
    };
  }
  return { component, status: 'covered-ok', message: `${component}: covered and fresh` };
}

export interface CoverageReport {
  total: number;
  coveredCount: number;
  uncovered: string[];
}

export function buildCoverageReport(allComponents: string[], covered: string[]): CoverageReport {
  const coveredSet = new Set(covered);
  const uncovered = allComponents.filter((component) => !coveredSet.has(component)).sort();
  return { total: allComponents.length, coveredCount: covered.length, uncovered };
}

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
