// Contract checks that only make sense against a git history: whether a
// component's props schema stays backward compatible with what shipped at
// some base ref (`compat`), whether a merge that touched an already-covered
// component still carries fresh contract artifacts (`guard`), and how much
// of the kit is covered at all (`coverage`). All the decision logic lives in
// check-lib.ts as pure functions over already-loaded JSON; everything in
// this file is the thin, impure shell that loads that JSON from git and the
// filesystem and calls gts-ts.
//
// Usage:
//   npm run contracts:check -- compat --base <git-ref> [--json]
//   npm run contracts:check -- guard --base <git-ref> [--json]
//   npm run contracts:coverage [-- --json]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GTS } from '@globaltypesystem/gts-ts';

import {
  buildCoverageReport,
  decideCompat,
  diffOwnPropsSchema,
  diffPassthroughSchema,
  evaluateGuard,
  extractContractMajor,
  mapChangedFilesToComponents,
  resolveRenameSource,
  synthesizeVersionedId,
  skippedPassthroughNote,
  touchesSharedContractTooling,
  type BaseRefContractEntry,
  type CompatVerdict,
  type DirectoryExportCoverage,
  type GuardResult,
} from './check-lib';
import { loadBaseSchema, overlayStems, registerContractTypes, type CompiledContract } from './compile';
import { bareGtsId } from './ids';
import { extractComponent, listExportedDeclarationNames } from './extract';
import { checkComponentFreshness } from './freshness';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS_DIR = join(kitRoot, 'src', 'components');
const GENERATED_DIR = join(kitRoot, 'scripts', 'contracts', 'generated');
const COVERED_PATH = join(kitRoot, 'scripts', 'contracts', 'covered.json');

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count
function listComponentDirs(): string[] {
  return readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count
function loadCovered(): string[] {
  return JSON.parse(readFileSync(COVERED_PATH, 'utf8')) as string[];
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count

// Path git accepts for `git show <ref>:<path>` (repo-root-relative), from a
// path relative to this package. Cached: it never changes mid-run and a
// child process per lookup would be wasteful across a kit-wide compat run.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read
let cachedPackagePrefix: string | undefined;
function packagePrefix(): string {
  if (cachedPackagePrefix === undefined) {
    cachedPackagePrefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: kitRoot, encoding: 'utf8' }).trim();
  }
  return cachedPackagePrefix;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read

// The committed content of a package-relative path at `ref`, or undefined
// when the path did not exist there - the "new contract" case `compat`
// reports instead of failing.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read
function gitShow(ref: string, packageRelativePath: string): string | undefined {
  try {
    // stderr is piped, not inherited: a path absent at `ref` is an expected,
    // handled outcome here (the "new contract" case), not a real error, so
    // git's own "fatal: path ... exists on disk, but not in ..." must not
    // leak into this tool's output every time it happens.
    return execFileSync('git', ['show', `${ref}:${packagePrefix()}${packageRelativePath}`], {
      cwd: kitRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return undefined;
  }
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed
function gitDiffNameOnly(args: string[]): string[] {
  const output = execFileSync('git', ['diff', '--name-only', '--relative', ...args], { cwd: kitRoot, encoding: 'utf8' });
  return output.split('\n').filter((line) => line.length > 0);
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed

// `-M`: rename detection, so a plain `git mv` (with content edits still
// within git's similarity threshold) reports one R### line naming both
// paths, rather than a delete of the old path plus an unrelated add of the
// new one. Committed history only (base...HEAD) - matches every other
// base-ref lookup in this file; a working-tree-only rename falls through to
// resolveRenameSource's $id/stem scan instead (M7).
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
function gitDiffNameStatusRenames(args: string[]): string[] {
  const output = execFileSync('git', ['diff', '--name-status', '-M', '--relative', ...args], { cwd: kitRoot, encoding: 'utf8' });
  return output.split('\n').filter((line) => line.length > 0);
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve

// New contract.json path -> old path, for every rename `-M` recognized
// between `base` and HEAD. `checkCompatForUnit` consults this first, before
// falling back to resolveRenameSource's $id/stem scan (M7).
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
function contractRenameMap(base: string): Map<string, string> {
  const renames = new Map<string, string>();
  for (const line of gitDiffNameStatusRenames([`${base}...HEAD`])) {
    const fields = line.split('\t');
    if (!fields[0].startsWith('R')) continue;
    const [, oldPath, newPath] = fields;
    if (newPath && newPath.endsWith('.contract.json')) renames.set(newPath, oldPath);
  }
  return renames;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve

// Every `*.contract.json` committed at `base`, with its own `$id` and stem -
// the pool `resolveRenameSource`'s id/stem scan searches when a unit's
// current path did not exist at `base` and git's own rename detection named
// nothing for it (M7). An empty result (no `src/components` tree at `base`,
// an unresolvable ref) degrades to "nothing to match against", the same as
// finding no match - not a hard failure of `compat` itself.
// Whether the base ref carries any generated passthrough type at all. This
// separates "the origin key changed, so the file for THIS origin is missing"
// - a real skipped comparison worth reporting - from "the base predates
// generated passthrough types entirely", where there is nothing to compare
// against for any component and silence is correct. Degrades to false on an
// unresolvable ref, the same way listBaseRefContracts degrades to empty.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-skipped
function baseRefHasAnyPassthrough(base: string): boolean {
  const prefix = packagePrefix();
  try {
    const output = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', base, '--', `${prefix}scripts/contracts/generated`],
      { cwd: kitRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return output.split('\n').some((line) => line.endsWith('.json'));
  } catch {
    return false;
  }
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-skipped

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
function listBaseRefContracts(base: string): BaseRefContractEntry[] {
  const prefix = packagePrefix();
  let output: string;
  try {
    output = execFileSync('git', ['ls-tree', '-r', '--name-only', base, '--', `${prefix}src/components`], {
      cwd: kitRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return [];
  }
  const entries: BaseRefContractEntry[] = [];
  for (const line of output.split('\n')) {
    if (!line.endsWith('.contract.json')) continue;
    const relPath = line.slice(prefix.length);
    const raw = gitShow(base, relPath);
    if (raw === undefined) continue;
    const id = (JSON.parse(raw) as CompiledContract).$id;
    const fileName = relPath.split('/').pop() ?? relPath;
    const stem = fileName.slice(0, -'.contract.json'.length);
    entries.push({ path: relPath, id, stem });
  }
  return entries;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed
function gitUntrackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: kitRoot, encoding: 'utf8' });
  return output.split('\n').filter((line) => line.length > 0);
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed

// Everything that differs from `base`: commits already on this branch since
// it diverged, PLUS whatever is still only on disk (staged, unstaged, or
// untracked) - a guard that only looked at commits would let an uncommitted
// contract edit through un-checked.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed
function changedFilesSince(base: string): string[] {
  const committed = gitDiffNameOnly([`${base}...HEAD`]);
  const workingTree = gitDiffNameOnly(['HEAD']);
  const untracked = gitUntrackedFiles();
  return [...new Set([...committed, ...workingTree, ...untracked])];
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed

// The passthrough origin a contract's own allOf carries, read off its
// passthrough $ref rather than re-derived through extraction - `compat`
// compares two POINTS IN TIME of the same contract, and the ref each one
// actually shipped with is the ground truth for which passthrough file it
// composes, not whatever extraction says the CURRENT source resolves to.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough
function passthroughOriginFromContract(contract: CompiledContract): string | undefined {
  for (const ref of contract.allOf) {
    const match = /passthrough\.([a-z0-9_]+)\.v\d+~$/.exec(ref.$ref);
    if (match) return match[1];
  }
  return undefined;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough

// A compiled contract unit: one `*.contract.yaml` overlay directly under a
// component directory. `directory` and `stem` are equal for the ordinary
// case (button/button); a compound component's part has its own stem inside
// the shared directory (accordion/accordion-item) - see compile.ts's
// resolveTargetExtraction for the same split.
interface ContractUnit {
  directory: string;
  stem: string;
}

function listContractUnits(): ContractUnit[] {
  const units: ContractUnit[] = [];
  for (const directory of listComponentDirs()) {
    for (const stem of overlayStems(directory)) units.push({ directory, stem });
  }
  return units;
}

// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1
function checkCompatForUnit(
  unit: ContractUnit,
  base: string,
  renames: Map<string, string>,
  baseContracts: BaseRefContractEntry[],
  baseHasAnyPassthrough: boolean,
): CompatVerdict & { component: string; isNew: boolean } {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read
  const { directory, stem: component } = unit;
  const relPath = `src/components/${directory}/${component}.contract.json`;
  const newRaw = readFileSync(join(kitRoot, relPath), 'utf8');
  const newContract = JSON.parse(newRaw) as CompiledContract;

  // Absent at `relPath` does not by itself mean "new" (M7): a renamed
  // directory or overlay stem means the exact path never existed at `base`
  // even though the contract itself did, under a different path - declaring
  // it "new" without checking would mask a breaking change riding along with
  // the rename. resolveRenameSource escalates through git's own rename
  // detection, then an $id match, then a stem match before giving up.
  let oldRaw = gitShow(base, relPath);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
  let renamedFromNote = '';
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename
  if (oldRaw === undefined) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
    const sourcePath = resolveRenameSource({
      currentPath: relPath,
      currentId: newContract.$id,
      currentStem: component,
      renamedFrom: renames.get(relPath),
      baseContracts,
    });
    if (sourcePath) {
      oldRaw = gitShow(base, sourcePath);
      renamedFromNote = ` (renamed from ${sourcePath})`;
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-new
  if (oldRaw === undefined) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-new-return
    return { component, isNew: true, status: 'pass', notes: [`${component}: new contract (absent at ${base})`] };
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-new-return
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-new

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read
  const oldContract = JSON.parse(oldRaw) as CompiledContract;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read
  const oldMajor = extractContractMajor(oldContract.$id);
  const newMajor = extractContractMajor(newContract.$id);

  // Fresh GTS instance per component: checkCompatibility resolves both ids
  // through the SAME store, so a leftover registration from a previous
  // component's run must never leak in.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-register
  const gts = new GTS();
  gts.register(loadBaseSchema());
  // The vocabulary the base type's trait schema references: registered here
  // too, so a store this tool builds is a complete registry rather than one
  // whose trait schema cannot resolve, and so a future change to one of
  // those types is compared through the same store as every other schema.
  registerContractTypes((entity) => gts.register(entity));
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-register
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough
  const origin = passthroughOriginFromContract(newContract);
  let passthroughDiff: ReturnType<typeof diffPassthroughSchema> | undefined;
  let skippedNote: string | undefined;
  if (origin) {
    const newPassthroughPath = join(GENERATED_DIR, `passthrough.${origin}.json`);
    if (existsSync(newPassthroughPath)) {
      const newPassthrough = JSON.parse(readFileSync(newPassthroughPath, 'utf8')) as Record<string, unknown>;
      gts.register(newPassthrough);
      const oldPassthroughRaw = gitShow(base, `scripts/contracts/generated/passthrough.${origin}.json`);
      if (oldPassthroughRaw !== undefined) {
        passthroughDiff = diffPassthroughSchema(JSON.parse(oldPassthroughRaw), newPassthrough);
      }
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-skipped
      skippedNote = skippedPassthroughNote(component, origin, oldPassthroughRaw !== undefined, baseHasAnyPassthrough);
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-skipped
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough

  // gts-ts's checkCompatibility (GtsCompatibility.checkCompatibility) never
  // resolves allOf/$ref - it diffs the two schemas' OWN properties/required
  // fields (see check-lib.ts's diffPassthroughSchema comment for why the
  // passthrough surface needs its own diff above). Old and new normally
  // share the same real $id (same component, same major), so both are
  // registered under synthetic minor-versioned ids to avoid one silently
  // overwriting the other in the store.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-register
  const oldSynthetic = { ...oldContract, $id: synthesizeVersionedId(oldContract.$id, 0) };
  const newSynthetic = { ...newContract, $id: synthesizeVersionedId(newContract.$id, 1) };
  gts.register(oldSynthetic);
  gts.register(newSynthetic);
  const result = gts.checkCompatibility(bareGtsId(oldSynthetic.$id), bareGtsId(newSynthetic.$id), 'backward');
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-register

  // gts-ts's own backward check misses a newly required own prop and a
  // vanished own prop that was never required (a rename looks exactly like
  // one of these) - see check-lib.ts's diffOwnPropsSchema comment (M9) for
  // why `is_backward_compatible` alone understates a real breaking change
  // here, confirmed empirically against the real library rather than
  // assumed from reading it.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own
  const ownPropsDiff = diffOwnPropsSchema(oldContract, newContract);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-decide
  const verdict = decideCompat({
    component,
    oldMajor,
    newMajor,
    gtsBackwardCompatible: result.is_backward_compatible,
    gtsBackwardErrors: result.backward_errors,
    passthroughDiff,
    ownPropsDiff,
  });
  const notes = verdict.notes.map((note) => `${note}${renamedFromNote}`);
  if (skippedNote !== undefined) notes.push(skippedNote);
  return { component, isNew: false, status: verdict.status, notes };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-decide
}

function runCompat(base: string, options: { json: boolean }): void {
  const units = listContractUnits().filter((unit) =>
    existsSync(join(COMPONENTS_DIR, unit.directory, `${unit.stem}.contract.json`)),
  );
  if (units.length === 0) {
    if (options.json) console.log(JSON.stringify({ command: 'compat', base, failed: false, results: [] }));
    else console.log('compat: no components carry a contract.json yet - nothing to check.');
    return;
  }

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
  const renames = contractRenameMap(base);
  const baseContracts = listBaseRefContracts(base);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-skipped
  const baseHasAnyPassthrough = baseRefHasAnyPassthrough(base);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-skipped
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
  const results = units.map((unit) => checkCompatForUnit(unit, base, renames, baseContracts, baseHasAnyPassthrough));
  const failed = results.some((result) => result.status === 'fail');
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit

  if (options.json) {
    console.log(JSON.stringify({ command: 'compat', base, failed, results }));
  } else {
    for (const result of results) {
      const label = result.isNew ? 'NEW' : result.status === 'pass' ? 'PASS' : 'FAIL';
      console.log(`[${label}] ${result.notes.join(' ')}`);
    }
  }
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
  if (failed) process.exit(1);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
}

// Whether a covered component's committed artifacts are exactly a fresh
// compile - the same freshness check testing.ts asserts per-component, run
// here for whichever component the guard is currently evaluating rather
// than every component in the kit.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
function isComponentFresh(directory: string, exportStem: string): boolean {
  return checkComponentFreshness(directory, exportStem).fresh;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered

// How many of a directory's exported components have an overlay, and how
// many the checker resolves in total - used both to decide `overlayExists`
// below (a covered compound directory needs EVERY export described, not
// just one) and by `coverage`'s "n of m exports" report.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered
function componentExportCoverage(directory: string): DirectoryExportCoverage {
  // A directory whose main file the extractor cannot resolve (wrong name, no
  // component-shaped export) reports 0 total exports rather than crashing a
  // report that is never supposed to fail the build.
  const componentNames = tryExtractComponentNames(directory);
  const skippedNonComponents = tryListExportedDeclarationNames(directory).filter((name) => !componentNames.includes(name));
  return { directory, totalExports: componentNames.length, coveredExports: overlayStems(directory).length, skippedNonComponents };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered
function tryExtractComponentNames(directory: string): string[] {
  try {
    return extractComponent(join(COMPONENTS_DIR, directory, `${directory}.tsx`)).map((e) => e.name);
  } catch {
    return [];
  }
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered
function tryListExportedDeclarationNames(directory: string): string[] {
  try {
    return listExportedDeclarationNames(join(COMPONENTS_DIR, directory, `${directory}.tsx`));
  } catch {
    return [];
  }
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered

function runGuard(base: string, options: { json: boolean }): void {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed
  const changedFiles = changedFilesSince(base);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed
  const covered = loadCovered();
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-map
  const touchedDirectly = mapChangedFilesToComponents(changedFiles);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-map
  // A change to shared compiling machinery can reshape any covered
  // component's compiled output without touching that component's own
  // directory at all (M6) - re-evaluate every covered entry, not just the
  // directories the diff happens to name.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-scope
  const toolingChanged = touchesSharedContractTooling(changedFiles);
  const touched = toolingChanged ? new Set([...touchedDirectly, ...covered]) : touchedDirectly;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-scope

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-empty
  if (touched.size === 0) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-empty-return
    if (options.json) console.log(JSON.stringify({ command: 'guard', base, violated: false, toolingChanged, results: [] }));
    else console.log('guard: no component files changed - nothing to check.');
    return;
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-empty-return
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-empty
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-scope
  if (toolingChanged && !options.json) {
    console.log('guard: shared contract tooling changed - re-checking every covered component for freshness.');
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-scope

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-each
  const coveredSet = new Set(covered);
  let violated = false;
  const results: GuardResult[] = [];
  for (const component of [...touched].sort()) {
    // A deleted directory must never crash an unguarded readdirSync (M10):
    // check existence once, up front, and route through evaluateGuard's
    // dedicated outcome instead of letting overlayStems/componentExportCoverage
    // throw ENOENT past the print loop below.
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-removed
    const componentExists = existsSync(join(COMPONENTS_DIR, component));
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-removed
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
    let overlayExists = false;
    let artifactsFresh = false;
    if (componentExists) {
      const stems = overlayStems(component);
      const { totalExports } = componentExportCoverage(component);
      // A covered compound directory must have every export described, not
      // merely one overlay - a directory that touches "overlayExists" by
      // coincidence (its root overlay happens to exist) while a sibling
      // part's overlay is missing or stale would otherwise pass silently.
      overlayExists = stems.length > 0 && stems.length === totalExports;
      const isCovered = coveredSet.has(component);
      // Freshness only needs computing (and can only be computed - it calls
      // compileContract, which throws without an overlay) for a covered
      // component that actually has every overlay; evaluateGuard already
      // fails an incomplete covered component before this matters.
      artifactsFresh = isCovered && overlayExists ? stems.every((stem) => isComponentFresh(component, stem)) : false;
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
    const result = evaluateGuard({ component, covered: coveredSet.has(component), overlayExists, artifactsFresh, componentExists });
    results.push(result);
    if (result.status === 'covered-violation' || result.status === 'component-removed') violated = true;
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-each

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-return
  if (options.json) {
    console.log(JSON.stringify({ command: 'guard', base, violated, toolingChanged, results }));
  } else {
    for (const result of results) {
      const label =
        result.status === 'covered-violation' || result.status === 'component-removed'
          ? 'FAIL'
          : result.status === 'covered-ok'
            ? 'PASS'
            : 'INFO';
      console.log(`[${label}] ${result.message}`);
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-return
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-guard-exit
  if (violated) process.exit(1);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-guard-exit
}

// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-coverage-report:p1
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2
function runCoverage(options: { json: boolean }): void {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count
  const all = listComponentDirs();
  const covered = loadCovered();
  const report = buildCoverageReport(all, covered);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count
  // covered.json is a human-curated allowlist (the guard's gate, grown one
  // directory at a time); the fraction here is the live, filesystem-derived
  // count of what already has a contract - a compound directory can read
  // "4 of 4 exports" and simply not be promoted into covered.json yet, which
  // is a different, more actionable fact than "0 of 63" was ever able to say.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered
  const byDirectory = new Map(all.map((directory) => [directory, componentExportCoverage(directory)]));
  const uncovered = report.uncovered.map((component) => byDirectory.get(component) ?? { directory: component, totalExports: 0, coveredExports: 0, skippedNonComponents: [] });
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-return
  if (options.json) {
    console.log(JSON.stringify({ command: 'coverage', total: report.total, coveredCount: report.coveredCount, uncovered }));
    return;
  }

  console.log(`${report.coveredCount} of ${report.total} components covered by contracts.`);
  if (uncovered.length === 0) return;
  console.log('Not yet in covered.json (n of m exports already have a contract):');
  for (const coverage of uncovered) {
    const skippedNote = coverage.skippedNonComponents.length > 0 ? ` (skipped, not components: ${coverage.skippedNonComponents.join(', ')})` : '';
    console.log(`  - ${coverage.directory}: ${coverage.coveredExports} of ${coverage.totalExports} exports${skippedNote}`);
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-return
}

function parseBaseArg(args: string[]): string {
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-usage
  const index = args.indexOf('--base');
  const value = index === -1 ? undefined : args[index + 1];
  if (!value) {
    // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-usage-exit
    console.error('Usage: contracts:check <compat|guard> --base <git-ref> [--json]');
    process.exit(1);
    // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-usage-exit
  }
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-usage
  return value;
}

// `--json` is an opt-in flag every subcommand honours the same way (N6): a
// stable, machine-readable object on stdout instead of the human-oriented
// log lines, so a programmatic caller (the CI policy wrapper below, a
// dashboard, a bot) has something better than scraping console output.
function parseJsonFlag(args: string[]): boolean {
  return args.includes('--json');
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

// @cpt-flow:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1
if (invokedDirectly()) {
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-invoke-check
  const [command, ...rest] = process.argv.slice(2);
  const json = parseJsonFlag(rest);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-invoke-check
  switch (command) {
    // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-dispatch-compat
    case 'compat':
      runCompat(parseBaseArg(rest), { json });
      break;
    // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-dispatch-compat
    // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-dispatch-guard
    case 'guard':
      runGuard(parseBaseArg(rest), { json });
      break;
    // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-dispatch-guard
    // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-dispatch-coverage
    case 'coverage':
      // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-coverage-exit
      runCoverage({ json });
      // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-coverage-exit
      break;
    // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-dispatch-coverage
    // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-unknown-subcommand
    default:
      // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-unknown-subcommand-exit
      console.error('Usage: contracts:check <compat --base <git-ref> | guard --base <git-ref> | coverage> [--json]');
      process.exit(1);
      // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-unknown-subcommand-exit
    // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-unknown-subcommand
  }
}
