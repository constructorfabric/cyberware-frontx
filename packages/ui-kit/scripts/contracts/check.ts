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
//   npm run contracts:check -- compat --base <git-ref>
//   npm run contracts:check -- guard --base <git-ref>
//   npm run contracts:coverage
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GTS } from '@globaltypesystem/gts-ts';

import {
  buildCoverageReport,
  decideCompat,
  diffPassthroughSchema,
  evaluateGuard,
  extractContractMajor,
  mapChangedFilesToComponents,
  synthesizeVersionedId,
  type CompatVerdict,
  type DirectoryExportCoverage,
  type GuardResult,
} from './check-lib';
import { loadBaseSchema, overlayStems, type CompiledContract } from './compile';
import { extractComponent, listExportedDeclarationNames } from './extract';
import { checkComponentFreshness } from './freshness';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS_DIR = join(kitRoot, 'src', 'components');
const GENERATED_DIR = join(kitRoot, 'scripts', 'contracts', 'generated');
const COVERED_PATH = join(kitRoot, 'scripts', 'contracts', 'covered.json');

function listComponentDirs(): string[] {
  return readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function loadCovered(): string[] {
  return JSON.parse(readFileSync(COVERED_PATH, 'utf8')) as string[];
}

// The GTS URI form (`gts://...`) is how a JSON Schema $id/$ref has to look;
// gts-ts's own id parser (Gts.parseGtsID, which checkCompatibility calls)
// requires the bare `gts.` prefix and rejects the URI form outright - see
// button.contract.test.ts's identical bareId helper for the schema-level
// version of the same fact.
function bareId(id: string): string {
  return id.replace(/^gts:\/\//, '');
}

// Path git accepts for `git show <ref>:<path>` (repo-root-relative), from a
// path relative to this package. Cached: it never changes mid-run and a
// child process per lookup would be wasteful across a kit-wide compat run.
let cachedPackagePrefix: string | undefined;
function packagePrefix(): string {
  if (cachedPackagePrefix === undefined) {
    cachedPackagePrefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: kitRoot, encoding: 'utf8' }).trim();
  }
  return cachedPackagePrefix;
}

// The committed content of a package-relative path at `ref`, or undefined
// when the path did not exist there - the "new contract" case `compat`
// reports instead of failing.
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

function gitDiffNameOnly(args: string[]): string[] {
  const output = execFileSync('git', ['diff', '--name-only', '--relative', ...args], { cwd: kitRoot, encoding: 'utf8' });
  return output.split('\n').filter((line) => line.length > 0);
}

function gitUntrackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: kitRoot, encoding: 'utf8' });
  return output.split('\n').filter((line) => line.length > 0);
}

// Everything that differs from `base`: commits already on this branch since
// it diverged, PLUS whatever is still only on disk (staged, unstaged, or
// untracked) - a guard that only looked at commits would let an uncommitted
// contract edit through un-checked.
function changedFilesSince(base: string): string[] {
  const committed = gitDiffNameOnly([`${base}...HEAD`]);
  const workingTree = gitDiffNameOnly(['HEAD']);
  const untracked = gitUntrackedFiles();
  return [...new Set([...committed, ...workingTree, ...untracked])];
}

// The passthrough origin a contract's own allOf carries, read off its
// passthrough $ref rather than re-derived through extraction - `compat`
// compares two POINTS IN TIME of the same contract, and the ref each one
// actually shipped with is the ground truth for which passthrough file it
// composes, not whatever extraction says the CURRENT source resolves to.
function passthroughOriginFromContract(contract: CompiledContract): string | undefined {
  for (const ref of contract.allOf) {
    const match = /passthrough\.([a-z0-9_]+)\.v\d+~$/.exec(ref.$ref);
    if (match) return match[1];
  }
  return undefined;
}

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

function checkCompatForUnit(unit: ContractUnit, base: string): CompatVerdict & { component: string; isNew: boolean } {
  const { directory, stem: component } = unit;
  const relPath = `src/components/${directory}/${component}.contract.json`;
  const newRaw = readFileSync(join(kitRoot, relPath), 'utf8');
  const oldRaw = gitShow(base, relPath);
  if (oldRaw === undefined) {
    return { component, isNew: true, status: 'pass', notes: [`${component}: new contract (absent at ${base})`] };
  }

  const oldContract = JSON.parse(oldRaw) as CompiledContract;
  const newContract = JSON.parse(newRaw) as CompiledContract;
  const oldMajor = extractContractMajor(oldContract.$id);
  const newMajor = extractContractMajor(newContract.$id);

  // Fresh GTS instance per component: checkCompatibility resolves both ids
  // through the SAME store, so a leftover registration from a previous
  // component's run must never leak in.
  const gts = new GTS();
  gts.register(loadBaseSchema());
  const origin = passthroughOriginFromContract(newContract);
  let passthroughDiff: ReturnType<typeof diffPassthroughSchema> | undefined;
  if (origin) {
    const newPassthroughPath = join(GENERATED_DIR, `passthrough.${origin}.json`);
    if (existsSync(newPassthroughPath)) {
      const newPassthrough = JSON.parse(readFileSync(newPassthroughPath, 'utf8')) as Record<string, unknown>;
      gts.register(newPassthrough);
      const oldPassthroughRaw = gitShow(base, `scripts/contracts/generated/passthrough.${origin}.json`);
      if (oldPassthroughRaw !== undefined) {
        passthroughDiff = diffPassthroughSchema(JSON.parse(oldPassthroughRaw), newPassthrough);
      }
    }
  }

  // gts-ts's checkCompatibility (GtsCompatibility.checkCompatibility) never
  // resolves allOf/$ref - it diffs the two schemas' OWN properties/required
  // fields (see check-lib.ts's diffPassthroughSchema comment for why the
  // passthrough surface needs its own diff above). Old and new normally
  // share the same real $id (same component, same major), so both are
  // registered under synthetic minor-versioned ids to avoid one silently
  // overwriting the other in the store.
  const oldSynthetic = { ...oldContract, $id: synthesizeVersionedId(oldContract.$id, 0) };
  const newSynthetic = { ...newContract, $id: synthesizeVersionedId(newContract.$id, 1) };
  gts.register(oldSynthetic);
  gts.register(newSynthetic);
  const result = gts.checkCompatibility(bareId(oldSynthetic.$id), bareId(newSynthetic.$id), 'backward');

  const verdict = decideCompat({
    component,
    oldMajor,
    newMajor,
    gtsBackwardCompatible: result.is_backward_compatible,
    gtsBackwardErrors: result.backward_errors,
    passthroughDiff,
  });
  return { component, isNew: false, ...verdict };
}

function runCompat(base: string): void {
  const units = listContractUnits().filter((unit) =>
    existsSync(join(COMPONENTS_DIR, unit.directory, `${unit.stem}.contract.json`)),
  );
  if (units.length === 0) {
    console.log('compat: no components carry a contract.json yet - nothing to check.');
    return;
  }

  let failed = false;
  for (const unit of units) {
    const result = checkCompatForUnit(unit, base);
    const label = result.isNew ? 'NEW' : result.status === 'pass' ? 'PASS' : 'FAIL';
    console.log(`[${label}] ${result.notes.join(' ')}`);
    if (result.status === 'fail') failed = true;
  }
  if (failed) process.exit(1);
}

// Whether a covered component's committed artifacts are exactly a fresh
// compile - the same freshness check testing.ts asserts per-component, run
// here for whichever component the guard is currently evaluating rather
// than every component in the kit.
function isComponentFresh(directory: string, exportStem: string): boolean {
  return checkComponentFreshness(directory, exportStem).fresh;
}

// How many of a directory's exported components have an overlay, and how
// many the checker resolves in total - used both to decide `overlayExists`
// below (a covered compound directory needs EVERY export described, not
// just one) and by `coverage`'s "n of m exports" report.
function componentExportCoverage(directory: string): DirectoryExportCoverage {
  // A directory whose main file the extractor cannot resolve (wrong name, no
  // component-shaped export) reports 0 total exports rather than crashing a
  // report that is never supposed to fail the build.
  const componentNames = tryExtractComponentNames(directory);
  const skippedNonComponents = tryListExportedDeclarationNames(directory).filter((name) => !componentNames.includes(name));
  return { directory, totalExports: componentNames.length, coveredExports: overlayStems(directory).length, skippedNonComponents };
}

function tryExtractComponentNames(directory: string): string[] {
  try {
    return extractComponent(join(COMPONENTS_DIR, directory, `${directory}.tsx`)).map((e) => e.name);
  } catch {
    return [];
  }
}

function tryListExportedDeclarationNames(directory: string): string[] {
  try {
    return listExportedDeclarationNames(join(COMPONENTS_DIR, directory, `${directory}.tsx`));
  } catch {
    return [];
  }
}

function runGuard(base: string): void {
  const touched = mapChangedFilesToComponents(changedFilesSince(base));
  const covered = new Set(loadCovered());

  if (touched.size === 0) {
    console.log('guard: no component files changed - nothing to check.');
    return;
  }

  let violated = false;
  const results: GuardResult[] = [];
  for (const component of [...touched].sort()) {
    const stems = overlayStems(component);
    const { totalExports } = componentExportCoverage(component);
    // A covered compound directory must have every export described, not
    // merely one overlay - a directory that touches "overlayExists" by
    // coincidence (its root overlay happens to exist) while a sibling part's
    // overlay is missing or stale would otherwise pass silently.
    const overlayExists = stems.length > 0 && stems.length === totalExports;
    const isCovered = covered.has(component);
    // Freshness only needs computing (and can only be computed - it calls
    // compileContract, which throws without an overlay) for a covered
    // component that actually has every overlay; evaluateGuard already fails
    // an incomplete covered component before this matters.
    const artifactsFresh =
      isCovered && overlayExists ? stems.every((stem) => isComponentFresh(component, stem)) : false;
    const result = evaluateGuard({ component, covered: isCovered, overlayExists, artifactsFresh });
    results.push(result);
    if (result.status === 'covered-violation') violated = true;
  }

  for (const result of results) {
    const label = result.status === 'covered-violation' ? 'FAIL' : result.status === 'covered-ok' ? 'PASS' : 'INFO';
    console.log(`[${label}] ${result.message}`);
  }
  if (violated) process.exit(1);
}

function runCoverage(): void {
  const all = listComponentDirs();
  const covered = loadCovered();
  const report = buildCoverageReport(all, covered);
  console.log(`${report.coveredCount} of ${report.total} components covered by contracts.`);
  if (report.uncovered.length === 0) return;

  // covered.json is a human-curated allowlist (the guard's gate, grown one
  // directory at a time); the fraction here is the live, filesystem-derived
  // count of what already has a contract - a compound directory can read
  // "4 of 4 exports" and simply not be promoted into covered.json yet, which
  // is a different, more actionable fact than "0 of 63" was ever able to say.
  const byDirectory = new Map(all.map((directory) => [directory, componentExportCoverage(directory)]));
  console.log('Not yet in covered.json (n of m exports already have a contract):');
  for (const component of report.uncovered) {
    const coverage = byDirectory.get(component);
    const skipped = coverage?.skippedNonComponents ?? [];
    const skippedNote = skipped.length > 0 ? ` (skipped, not components: ${skipped.join(', ')})` : '';
    console.log(`  - ${component}: ${coverage?.coveredExports ?? 0} of ${coverage?.totalExports ?? 0} exports${skippedNote}`);
  }
}

function parseBaseArg(args: string[]): string {
  const index = args.indexOf('--base');
  const value = index === -1 ? undefined : args[index + 1];
  if (!value) {
    console.error('Usage: contracts:check <compat|guard> --base <git-ref>');
    process.exit(1);
  }
  return value;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'compat':
      runCompat(parseBaseArg(rest));
      break;
    case 'guard':
      runGuard(parseBaseArg(rest));
      break;
    case 'coverage':
      runCoverage();
      break;
    default:
      console.error('Usage: contracts:check <compat --base <git-ref> | guard --base <git-ref> | coverage>');
      process.exit(1);
  }
}
