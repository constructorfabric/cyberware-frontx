// Contract checks that only make sense against a git history: whether a
// component's props schema stays backward compatible with what shipped at
// some base ref (`compat`), whether a merge that touched an already-covered
// component still carries fresh contract artifacts (`guard`), and how much
// of the kit is covered at all (`coverage`). All the decision logic lives in
// check-lib.ts as pure functions over already-loaded JSON; everything in
// this file is the thin, impure shell that loads that JSON from git and the
// filesystem and calls gts-ts.
//
// Every impurity this shell has - which repository it reads, which git
// commands it runs, how it compiles and compares a component, where it
// prints - is named in CheckContext below and supplied by defaultCheckContext
// for a real run. That is what lets the three subcommands be driven against a
// purpose-built fixture repository (see check.e2e.test.ts) instead of only
// against this package, which is the only way the git-shaped rules here - a
// contract that vanished since the base ref, a base ref that does not
// resolve, a widened guard scope - can be tested at all.
//
// Usage:
//   npm run contracts:check -- compat --base <git-ref> [--json]
//   npm run contracts:check -- guard --base <git-ref> [--json]
//   npm run contracts:coverage [-- --json]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GTS } from '@globaltypesystem/gts-ts';

import {
  buildCoverageReport,
  comparePassthroughSurfaces,
  decideCompat,
  decideRemoval,
  diffOwnPropsSchema,
  evaluateGuard,
  extractContractMajor,
  findRemovedContracts,
  mapChangedFilesToComponents,
  resolveRenameSource,
  synthesizeVersionedId,
  touchesAnyOverlay,
  touchesCoverageAllowlist,
  touchesDependencyManifest,
  touchesSharedContractTooling,
  undeclaredForwardedProps,
  type BaseRefContractEntry,
  type CompatVerdict,
  type DirectoryExportCoverage,
  type GuardResult,
  type PassthroughDiff,
} from './check-lib';
import {
  loadBaseSchema,
  loadPassthroughSchema,
  overlayStems,
  registerContractTypes,
  resolveTargetExtraction,
  type CompiledContract,
} from './compile';
import { bareGtsId } from './ids';
import { listComponentExportNames, listExportedDeclarationNames } from './extract';
import { checkComponentFreshness } from './freshness';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Everything the three subcommands do that is not a pure decision over
// already-loaded JSON. `overlayStems`, the export lists and the freshness
// comparison are injected rather than imported directly because each of them
// resolves paths against compile.ts's own notion of the kit root: bound to
// this package, they can only ever answer questions about this package.
export interface CheckContext {
  kitRoot: string;
  overlayStems: (directory: string) => string[];
  // Whether the directory ships a conformance suite of its own. Injected for
  // the same reason the overlay listing is: it resolves a path against a kit
  // root, so bound to this package it could only answer about this package.
  contractTestExists: (directory: string) => boolean;
  isComponentFresh: (directory: string, exportStem: string) => boolean;
  // The exported names extraction recognizes as React components, and every
  // exported name in the file, for the coverage report's "n of m exports".
  componentExportNames: (directory: string) => string[];
  exportedDeclarationNames: (directory: string) => string[];
  // The props a component forwards to its host element that the committed
  // surface for that element declares by neither name nor pattern - the
  // informational half of the coverage report. Injected for the reason every
  // other entry here is: it reads the component's own source and the
  // committed surface, both resolved against this package.
  undeclaredForwardedProps: (directory: string, exportStem: string) => string[];
  // Declares up front which component directories this run is about to read
  // source for, so the extractor builds one TypeScript program over all of
  // them instead of one per file. A kit-wide run is the caller that needs it:
  // the closure a component's program loads - React, Base UI, the DOM lib -
  // is very nearly the same closure for all 63 of them.
  prepareExtraction: (directories: string[]) => void;
  log: (line: string) => void;
}

export function defaultCheckContext(): CheckContext {
  const componentsDir = join(packageRoot, 'src', 'components');
  const entryFile = (directory: string): string => join(componentsDir, directory, `${directory}.tsx`);
  // Component export names for whichever directories this run declared, read
  // out of one shared program rather than one per directory. Names only, and
  // never through the extraction cache a compile reads - see
  // listComponentExportNames in extract.ts for why the two must not be the
  // same answer.
  const componentNames = new Map<string, string[]>();
  return {
    kitRoot: packageRoot,
    overlayStems,
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-suite
    contractTestExists: (directory) => {
      const dir = join(packageRoot, 'src', 'components', directory);
      if (!existsSync(dir)) return false;
      return readdirSync(dir).some((name) => name.endsWith('.contract.test.ts'));
    },
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-suite
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
    // The same freshness check testing.ts asserts per-component, run here for
    // whichever component the guard is currently evaluating rather than every
    // component in the kit.
    isComponentFresh: (directory, exportStem) => checkComponentFreshness(directory, exportStem).fresh,
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered
    // A directory whose main file the extractor cannot resolve (wrong name, no
    // component-shaped export) reports 0 exports rather than crashing a report
    // that is never supposed to fail the build.
    componentExportNames: (directory) => componentNames.get(entryFile(directory)) ?? [],
    exportedDeclarationNames: (directory) => {
      try {
        return listExportedDeclarationNames(entryFile(directory));
      } catch {
        return [];
      }
    },
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-forwarded
    // Its own program per component, like every other extraction an artifact
    // is read from: the answer is about one component's own source. A
    // component with no host element forwards nothing, so there is no gap to
    // report for it.
    undeclaredForwardedProps: (directory, exportStem) => {
      // Swallowed the way the export listing above swallows its own failure,
      // and for the same reason: a directory the extractor cannot read is a
      // fact the guard fails on, and this report is never supposed to fail
      // the build.
      try {
        const extraction = resolveTargetExtraction(directory, exportStem);
        if (extraction.elementKind === undefined || extraction.passthroughProps.length === 0) return [];
        return undeclaredForwardedProps(
          extraction.passthroughProps.map((prop) => prop.name),
          loadPassthroughSchema(extraction.elementKind),
        );
      } catch {
        return [];
      }
    },
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-forwarded
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-shared-program
    prepareExtraction: (directories) => {
      const paths = directories.map(entryFile).filter((path) => existsSync(path));
      if (paths.length === 0) return;
      for (const [path, names] of listComponentExportNames(paths)) componentNames.set(path, names);
    },
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-shared-program
    log: (line) => console.log(line),
  };
}

function componentsDir(ctx: CheckContext): string {
  return join(ctx.kitRoot, 'src', 'components');
}

function passthroughDir(ctx: CheckContext): string {
  return join(ctx.kitRoot, 'scripts', 'contracts', 'passthrough');
}

function coveredPath(ctx: CheckContext): string {
  return join(ctx.kitRoot, 'scripts', 'contracts', 'covered.json');
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count
function listComponentDirs(ctx: CheckContext): string[] {
  return readdirSync(componentsDir(ctx), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count
function loadCovered(ctx: CheckContext): string[] {
  return JSON.parse(readFileSync(coveredPath(ctx), 'utf8')) as string[];
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runGit(ctx: CheckContext, args: string[]): GitResult {
  const result = spawnSync('git', args, { cwd: ctx.kitRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: (result.stderr ?? '').trim() };
}

// Every git command whose failure is NOT a meaningful answer. Each of these
// used to either throw execFileSync's whole spawn record (a page of JSON
// around a one-line fatal) or, worse, swallow the failure and return an empty
// list that reads exactly like "there was nothing there" - which is how an
// unresolvable ref could report every contract as new.
function gitOrThrow(ctx: CheckContext, args: string[], what: string): string {
  const result = runGit(ctx, args);
  if (!result.ok) {
    throw new Error(`contracts:check: ${what} failed - git ${args.join(' ')}: ${result.stderr || 'no stderr'}`);
  }
  return result.stdout;
}

function gitLines(ctx: CheckContext, args: string[], what: string): string[] {
  return gitOrThrow(ctx, args, what)
    .split('\n')
    .filter((line) => line.length > 0);
}

// A base ref that does not name a commit in this repository - a typo, a
// branch never fetched, a shallow clone missing the commit - is the one input
// that can make every other lookup here answer honestly and still add up to a
// wrong verdict: no contract exists at a ref that does not exist, so every
// contract reads as new and every removal reads as nothing. Verified once, up
// front, so the run says which ref it could not resolve instead of reporting
// a green kit against nothing at all.
// @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-verify-base
function baseRefResolves(ctx: CheckContext, base: string): boolean {
  return runGit(ctx, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok;
}

function refuseUnresolvableBase(ctx: CheckContext, command: string, base: string): number {
  ctx.log(
    `${command}: --base "${base}" does not resolve to a commit in this repository - fetch the ref or correct it. ` +
      'Refusing to run: against a ref that does not exist every contract reads as new and every removal reads as nothing.',
  );
  return 1;
}
// @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-verify-base

// Path git accepts for `git show <ref>:<path>` (repo-root-relative), from a
// path relative to this package. Cached per kit root: it never changes
// mid-run and a child process per lookup would be wasteful across a kit-wide
// compat run.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read
const packagePrefixCache = new Map<string, string>();
function packagePrefix(ctx: CheckContext): string {
  const cached = packagePrefixCache.get(ctx.kitRoot);
  if (cached !== undefined) return cached;
  const prefix = gitOrThrow(ctx, ['rev-parse', '--show-prefix'], 'locating the package inside the repository').trim();
  packagePrefixCache.set(ctx.kitRoot, prefix);
  return prefix;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read

// The committed content of a package-relative path at `ref`, or undefined
// when the path did not exist there - the "new contract" case `compat`
// reports instead of failing. This is the one git lookup whose failure IS an
// answer, and it is only ever reached after the ref itself has been verified
// to resolve, so "git refused" here means "not at that ref", not "no such
// ref".
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read
function gitShow(ctx: CheckContext, ref: string, packageRelativePath: string): string | undefined {
  // stderr is captured, not inherited: a path absent at `ref` is an expected,
  // handled outcome here, not a real error, so git's own "fatal: path ...
  // exists on disk, but not in ..." must not leak into this tool's output
  // every time it happens.
  const result = runGit(ctx, ['show', `${ref}:${packagePrefix(ctx)}${packageRelativePath}`]);
  return result.ok ? result.stdout : undefined;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read

function readJsonAt(ctx: CheckContext, ref: string, packageRelativePath: string): Record<string, unknown> | undefined {
  const raw = gitShow(ctx, ref, packageRelativePath);
  return raw === undefined ? undefined : (JSON.parse(raw) as Record<string, unknown>);
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed
function gitDiffNameOnly(ctx: CheckContext, args: string[]): string[] {
  return gitLines(ctx, ['diff', '--name-only', '--relative', ...args], 'listing changed files');
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed

// `-M`: rename detection, so a plain `git mv` (with content edits still
// within git's similarity threshold) reports one R### line naming both
// paths, rather than a delete of the old path plus an unrelated add of the
// new one. Committed history only (base...HEAD) - matches every other
// base-ref lookup in this file; a working-tree-only rename falls through to
// resolveRenameSource's $id/stem scan instead (M7).
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
function gitDiffNameStatusRenames(ctx: CheckContext, args: string[]): string[] {
  return gitLines(ctx, ['diff', '--name-status', '-M', '--relative', ...args], 'detecting renames');
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve

// New contract.json path -> old path, for every rename `-M` recognized
// between `base` and HEAD. `checkCompatForUnit` consults this first, before
// falling back to resolveRenameSource's $id/stem scan (M7).
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
function contractRenameMap(ctx: CheckContext, base: string): Map<string, string> {
  const renames = new Map<string, string>();
  for (const line of gitDiffNameStatusRenames(ctx, [`${base}...HEAD`])) {
    const fields = line.split('\t');
    if (!fields[0].startsWith('R')) continue;
    const [, oldPath, newPath] = fields;
    if (newPath && newPath.endsWith('.contract.json')) renames.set(newPath, oldPath);
  }
  return renames;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve

// Every `*.contract.json` committed at `base`, with its own `$id` and stem.
// Two readers: `resolveRenameSource`'s id/stem scan searches this pool when a
// unit's current path did not exist at `base` and git's own rename detection
// named nothing for it (M7), and `findRemovedContracts` subtracts everything
// the run actually compared from it to find the contracts that exist only in
// the past. The second reader is why this list may no longer degrade to empty
// on a git failure: an empty pool used to mean "nothing to match against",
// and now it would also mean "nothing was removed".
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
function listBaseRefContracts(ctx: CheckContext, base: string): BaseRefContractEntry[] {
  const prefix = packagePrefix(ctx);
  const output = gitOrThrow(
    ctx,
    ['ls-tree', '-r', '--name-only', base, '--', `${prefix}src/components`],
    'listing contracts at the base ref',
  );
  const entries: BaseRefContractEntry[] = [];
  for (const line of output.split('\n')) {
    if (!line.endsWith('.contract.json')) continue;
    const relPath = line.slice(prefix.length);
    const raw = gitShow(ctx, base, relPath);
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
function gitUntrackedFiles(ctx: CheckContext): string[] {
  return gitLines(ctx, ['ls-files', '--others', '--exclude-standard'], 'listing untracked files');
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed

// Everything that differs from `base`: commits already on this branch since
// it diverged, PLUS whatever is still only on disk (staged, unstaged, or
// untracked) - a guard that only looked at commits would let an uncommitted
// contract edit through un-checked.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed
function changedFilesSince(ctx: CheckContext, base: string): string[] {
  const committed = gitDiffNameOnly(ctx, [`${base}...HEAD`]);
  const workingTree = gitDiffNameOnly(ctx, ['HEAD']);
  const untracked = gitUntrackedFiles(ctx);
  return [...new Set([...committed, ...workingTree, ...untracked])];
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed

// The same change set WITHOUT `--relative`, so paths are repository-root
// relative and the listing is not limited to this package. Every other lookup
// here is deliberately package-scoped; this one exists because the lockfile
// that decides which version of the primitive library is installed lives at
// the repository root, and a package-relative diff cannot see it at all - the
// one input that reshapes every committed contract from outside the package.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-deps
function repoChangedFilesSince(ctx: CheckContext, base: string): string[] {
  const committed = gitLines(ctx, ['diff', '--name-only', `${base}...HEAD`], 'listing changed files across the repository');
  const workingTree = gitLines(ctx, ['diff', '--name-only', 'HEAD'], 'listing working-tree changes across the repository');
  return [...new Set([...committed, ...workingTree])];
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-deps

// The host element a contract's own allOf carries, read off its passthrough
// $ref rather than re-derived through extraction - `compat` compares two
// POINTS IN TIME of the same contract, and the ref each one actually shipped
// with is the ground truth for which passthrough file it composes, not
// whatever extraction says the CURRENT source resolves to. Called for BOTH
// revisions: see comparePassthroughSurfaces in check-lib.ts for what each
// combination of the two answers means.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough
function passthroughElementFromContract(contract: CompiledContract): string | undefined {
  for (const ref of contract.allOf) {
    const match = /passthrough\.([a-z0-9_]+)\.v\d+~$/.exec(ref.$ref);
    // The token, not the tag: `dom_button`, which is also the file name under
    // scripts/contracts/passthrough/ - the two are one identity, so nothing
    // here has to reverse domPassthroughToken.
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

function listContractUnits(ctx: CheckContext): ContractUnit[] {
  const units: ContractUnit[] = [];
  for (const directory of listComponentDirs(ctx)) {
    for (const stem of ctx.overlayStems(directory)) units.push({ directory, stem });
  }
  return units;
}

// A contract's verdict, plus which base-ref path it was compared against.
// `basePath` is what tells runCompat that a base-ref contract has an heir
// here: everything at the base ref that no unit claimed is a removal.
type UnitCompatResult = CompatVerdict & { component: string; isNew: boolean; removed: boolean; basePath?: string };

// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1
function checkCompatForUnit(
  ctx: CheckContext,
  unit: ContractUnit,
  base: string,
  renames: Map<string, string>,
  baseContracts: BaseRefContractEntry[],
): UnitCompatResult {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-read
  const { directory, stem: component } = unit;
  const relPath = `src/components/${directory}/${component}.contract.json`;
  const newRaw = readFileSync(join(ctx.kitRoot, relPath), 'utf8');
  const newContract = JSON.parse(newRaw) as CompiledContract;

  // Absent at `relPath` does not by itself mean "new" (M7): a renamed
  // directory or overlay stem means the exact path never existed at `base`
  // even though the contract itself did, under a different path - declaring
  // it "new" without checking would mask a breaking change riding along with
  // the rename. resolveRenameSource escalates through git's own rename
  // detection, then an $id match, then a stem match before giving up.
  let oldRaw = gitShow(ctx, base, relPath);
  let basePath: string | undefined = oldRaw === undefined ? undefined : relPath;
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
      oldRaw = gitShow(ctx, base, sourcePath);
      if (oldRaw !== undefined) basePath = sourcePath;
      renamedFromNote = ` (renamed from ${sourcePath})`;
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-new
  if (oldRaw === undefined) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-new-return
    return { component, isNew: true, removed: false, status: 'pass', notes: [`${component}: new contract (absent at ${base})`] };
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
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-both
  // Both revisions' host elements, and the schema each one names: the old one
  // as it shipped at the base ref, the new one as it is committed here.
  // Reading the element off the new contract alone made an entire class of
  // change invisible - drop the passthrough $ref and there is no element to
  // look up, so the block was skipped and every forwarded prop disappeared
  // silently.
  const newElement = passthroughElementFromContract(newContract);
  const oldElement = passthroughElementFromContract(oldContract);
  let newPassthrough: Record<string, unknown> | undefined;
  if (newElement !== undefined) {
    const newPassthroughPath = join(passthroughDir(ctx), `${newElement}.json`);
    if (existsSync(newPassthroughPath)) {
      newPassthrough = JSON.parse(readFileSync(newPassthroughPath, 'utf8')) as Record<string, unknown>;
      // Registered so the store this comparison runs in can resolve the
      // contract's own allOf, exactly as before.
      gts.register(newPassthrough);
    }
  }
  const oldPassthrough =
    oldElement === undefined ? undefined : readJsonAt(ctx, base, `scripts/contracts/passthrough/${oldElement}.json`);
  // The old revision's own surface, when it is a different type from the new
  // one: registered so the store can resolve BOTH synthetic revisions' allOf
  // rather than only the current one's. Skipped when the element is
  // unchanged, where the two carry the same $id and the second registration
  // would only overwrite the first.
  if (oldPassthrough !== undefined && oldElement !== newElement) gts.register(oldPassthrough);

  const passthrough = comparePassthroughSurfaces({
    component,
    oldElement,
    newElement,
    oldSchema: oldPassthrough,
    newSchema: newPassthrough,
  });
  const passthroughDiff: PassthroughDiff | undefined = passthrough.diff;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-passthrough-both

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

  // gts-ts's own backward check misses a newly required own prop, a vanished
  // own prop that was never required (a rename looks exactly like one of
  // these), and an enum appearing on a prop that already carried its type -
  // see check-lib.ts's diffOwnPropsSchema comment for why
  // `is_backward_compatible` alone understates a real breaking change here,
  // measured against the real library rather than assumed from reading it.
  // The current revision's forwarded surface is handed in so a prop that left
  // `properties` can be reconciled against what the host element still
  // accepts - a component dropping its own `className` declaration forwards
  // `className` all the same, and a consumer notices nothing.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own
  const ownPropsDiff = diffOwnPropsSchema(oldContract, newContract, newPassthrough);
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
  if (passthrough.note !== undefined) notes.push(passthrough.note);
  return { component, isNew: false, removed: false, status: verdict.status, notes, basePath };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-decide
}

// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1
export function runCompat(base: string, options: { json: boolean }, ctx: CheckContext = defaultCheckContext()): number {
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-verify-base
  if (!baseRefResolves(ctx, base)) return refuseUnresolvableBase(ctx, 'compat', base);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-verify-base

  const units = listContractUnits(ctx).filter((unit) =>
    existsSync(join(componentsDir(ctx), unit.directory, `${unit.stem}.contract.json`)),
  );

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
  const renames = contractRenameMap(ctx, base);
  const baseContracts = listBaseRefContracts(ctx, base);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-rename-resolve
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
  const results: UnitCompatResult[] = units.map((unit) => checkCompatForUnit(ctx, unit, base, renames, baseContracts));
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit

  // Everything the base ref carried that no unit above compared itself
  // against. A contract only reachable in the past is visited by no unit, so
  // without this sweep a deletion - and a rename neither git nor
  // resolveRenameSource could pair up - was not so much passed as never
  // looked at.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1:inst-cr-sweep
  const removals = findRemovedContracts({
    baseContracts,
    comparedBasePaths: results.map((result) => result.basePath).filter((path): path is string => path !== undefined),
    covered: existsSync(coveredPath(ctx)) ? loadCovered(ctx) : [],
  });
  for (const removal of removals) {
    const verdict = decideRemoval(removal);
    results.push({ component: removal.stem, isNew: false, removed: true, status: verdict.status, notes: verdict.notes });
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1:inst-cr-sweep

  if (results.length === 0) {
    if (options.json) ctx.log(JSON.stringify({ command: 'compat', base, failed: false, results: [] }));
    else ctx.log('compat: no components carry a contract.json yet - nothing to check.');
    return 0;
  }

  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
  const failed = results.some((result) => result.status === 'fail');
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit

  if (options.json) {
    ctx.log(JSON.stringify({ command: 'compat', base, failed, results }));
  } else {
    for (const result of results) {
      const label =
        result.status === 'fail' ? 'FAIL' : result.removed ? 'REMOVED' : result.isNew ? 'NEW' : 'PASS';
      ctx.log(`[${label}] ${result.notes.join(' ')}`);
    }
  }
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
  return failed ? 1 : 0;
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
}

// How many of a directory's exported components have an overlay, and how
// many the checker resolves in total - used both to decide `overlayExists`
// below (a covered compound directory needs EVERY export described, not
// just one) and by `coverage`'s "n of m exports" report.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered
function componentExportCoverage(ctx: CheckContext, directory: string): DirectoryExportCoverage {
  const componentNames = ctx.componentExportNames(directory);
  const skippedNonComponents = ctx.exportedDeclarationNames(directory).filter((name) => !componentNames.includes(name));
  return {
    directory,
    totalExports: componentNames.length,
    coveredExports: ctx.overlayStems(directory).length,
    skippedNonComponents,
  };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered

export function runGuard(base: string, options: { json: boolean }, ctx: CheckContext = defaultCheckContext()): number {
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-verify-base
  if (!baseRefResolves(ctx, base)) return refuseUnresolvableBase(ctx, 'guard', base);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-verify-base
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed
  const changedFiles = changedFilesSince(ctx, base);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed
  const covered = loadCovered(ctx);
  // The allowlist as it was at the base reference. Read so that a component
  // DROPPED from it is still in scope for the change that drops it: the new
  // list alone takes it out of scope with no line in any output, and that
  // same edit is the acknowledgement the removal sweep accepts, so it must
  // not also be the edit nothing looks at.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist-union
  const baseCovered = (readJsonAt(ctx, base, 'scripts/contracts/covered.json') as unknown as string[] | undefined) ?? covered;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist-union
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-map
  const touchedDirectly = mapChangedFilesToComponents(changedFiles);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-map
  // A change to shared compiling machinery can reshape any covered
  // component's compiled output without touching that component's own
  // directory at all (M6) - re-evaluate every covered entry, not just the
  // directories the diff happens to name.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-scope
  const toolingChanged = touchesSharedContractTooling(changedFiles);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-scope
  // The allowlist decides which components are held to the standard at all,
  // so editing it has to re-check everything it now names - otherwise an
  // entry could be added for a directory with no overlay, or left behind for
  // a directory that is gone, and the file that grants coverage would be the
  // one file coverage never looked at.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist
  const allowlistChanged = touchesCoverageAllowlist(changedFiles);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist
  // An overlay's children list decides another component's derived parent, so
  // an edit to any overlay can move a contract in a directory this change
  // never touched.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-overlay
  const overlayChanged = touchesAnyOverlay(changedFiles);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-overlay
  // A dependency bump changes what the checker prints into every committed
  // contract, from outside this package entirely.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-deps
  const dependenciesChanged = touchesDependencyManifest(changedFiles, repoChangedFilesSince(ctx, base));
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-deps
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist-union
  // The union of both allowlists, not just the current one: a widened scope
  // has to include what coverage NAMED as well as what it names.
  const touched =
    toolingChanged || allowlistChanged || overlayChanged || dependenciesChanged
      ? new Set([...touchedDirectly, ...covered, ...baseCovered])
      : touchedDirectly;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist-union

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-empty
  if (touched.size === 0) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-empty-return
    if (options.json) {
      ctx.log(
        JSON.stringify({
          command: 'guard',
          base,
          violated: false,
          toolingChanged,
          allowlistChanged,
          overlayChanged,
          dependenciesChanged,
          results: [],
        }),
      );
    } else {
      ctx.log('guard: no component files changed - nothing to check.');
    }
    return 0;
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-empty-return
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-empty
  if (!options.json) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-scope
    if (toolingChanged) {
      ctx.log('guard: shared contract tooling changed - re-checking every covered component for freshness.');
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-scope
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist
    if (allowlistChanged) {
      ctx.log('guard: covered.json changed - re-checking every component it names.');
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-overlay
    if (overlayChanged) {
      ctx.log('guard: an overlay changed - re-checking every covered component, because a children list decides another component\'s derived parent.');
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-overlay
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-deps
    if (dependenciesChanged) {
      ctx.log(
        'guard: a dependency manifest changed - re-checking every covered component, because a committed contract ' +
          "carries the checker's printed type text for the packages it depends on.",
      );
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-deps
  }

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-each
  ctx.prepareExtraction([...touched]);
  const coveredSet = new Set(covered);
  const baseCoveredSet = new Set(baseCovered);
  let violated = false;
  const results: GuardResult[] = [];
  for (const component of [...touched].sort()) {
    // A deleted directory must never crash an unguarded readdirSync (M10):
    // check existence once, up front, and route through evaluateGuard's
    // dedicated outcome instead of letting overlayStems/componentExportCoverage
    // throw ENOENT past the print loop below.
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-removed
    const componentExists = existsSync(join(componentsDir(ctx), component));
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-removed
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
    let overlayExists = false;
    let artifactsFresh = false;
    let contractTestExists = false;
    if (componentExists) {
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-suite
      contractTestExists = ctx.contractTestExists(component);
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-suite
      const stems = ctx.overlayStems(component);
      const { totalExports } = componentExportCoverage(ctx, component);
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
      artifactsFresh = isCovered && overlayExists ? stems.every((stem) => ctx.isComponentFresh(component, stem)) : false;
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-covered
    const result = evaluateGuard({
      component,
      covered: coveredSet.has(component),
      overlayExists,
      artifactsFresh,
      componentExists,
      contractTestExists,
      wasCovered: baseCoveredSet.has(component),
    });
    results.push(result);
    if (result.status === 'covered-violation' || result.status === 'component-removed') violated = true;
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-each

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-return
  if (options.json) {
    ctx.log(
      JSON.stringify({ command: 'guard', base, violated, toolingChanged, allowlistChanged, overlayChanged, dependenciesChanged, results }),
    );
  } else {
    for (const result of results) {
      const label =
        result.status === 'covered-violation' || result.status === 'component-removed'
          ? 'FAIL'
          : result.status === 'covered-ok'
            ? 'PASS'
            : 'INFO';
      ctx.log(`[${label}] ${result.message}`);
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-return
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-guard-exit
  return violated ? 1 : 0;
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-guard-exit
}

// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-coverage-report:p1
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2
export function runCoverage(options: { json: boolean }, ctx: CheckContext = defaultCheckContext()): number {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count
  const all = listComponentDirs(ctx);
  const covered = loadCovered(ctx);
  const report = buildCoverageReport(all, covered);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-count
  // covered.json is a human-curated allowlist (the guard's gate, grown one
  // directory at a time); the fraction here is the live, filesystem-derived
  // count of what already has a contract - a compound directory can read
  // "4 of 4 exports" and simply not be promoted into covered.json yet, which
  // is a different, more actionable fact than "0 of 63" was ever able to say.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered
  ctx.prepareExtraction(all);
  const byDirectory = new Map(all.map((directory) => [directory, componentExportCoverage(ctx, directory)]));
  const uncovered = report.uncovered.map(
    (component) => byDirectory.get(component) ?? { directory: component, totalExports: 0, coveredExports: 0, skippedNonComponents: [] },
  );
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-uncovered

  // An allowlist entry only grants coverage while there is something behind
  // it. An entry naming no directory, or a directory carrying no overlay, was
  // counted as coverage all the same - the report's own headline number was
  // the thing least able to notice it.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-allowlist
  const unknownCovered = new Set(report.unknownCovered);
  const allowlistProblems = [
    ...report.unknownCovered.map((component) => `${component}: named in covered.json but no such component directory`),
    ...covered
      .filter((component) => !unknownCovered.has(component) && ctx.overlayStems(component).length === 0)
      .sort()
      .map((component) => `${component}: named in covered.json but carries no *.contract.yaml overlay`),
  ];
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-allowlist

  // The completeness of a hand-written element surface is not checked
  // anywhere, on purpose: nobody enumerates React's attributes for an
  // element, and an attribute no file names reaches a consumer as unchecked
  // rather than as rejected. What was missing was any way to see that set,
  // so it is reported here - beside the coverage numbers, deriving no exit
  // code, for the same reason none of them do.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-forwarded
  const forwardedGaps = covered
    .filter((component) => !unknownCovered.has(component))
    .flatMap((component) =>
      ctx
        .overlayStems(component)
        .map((stem) => ({ component: stem, props: ctx.undeclaredForwardedProps(component, stem) }))
        .filter((entry) => entry.props.length > 0),
    );
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-forwarded

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-return
  if (options.json) {
    ctx.log(
      JSON.stringify({
        command: 'coverage',
        total: report.total,
        coveredCount: report.coveredCount,
        uncovered,
        allowlistProblems,
        forwardedGaps,
      }),
    );
    return 0;
  }

  ctx.log(`${report.coveredCount} of ${report.total} components covered by contracts.`);
  if (allowlistProblems.length > 0) {
    ctx.log('covered.json entries that grant coverage over nothing:');
    for (const problem of allowlistProblems) ctx.log(`  - ${problem}`);
  }
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-forwarded
  if (forwardedGaps.length > 0) {
    ctx.log('Forwarded props no committed element surface declares (reported, never a failure):');
    for (const gap of forwardedGaps) ctx.log(`  - ${gap.component}: ${gap.props.length} - ${gap.props.join(', ')}`);
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-coverage:p2:inst-cv-forwarded
  if (uncovered.length === 0) return 0;
  ctx.log('Not yet in covered.json (n of m exports already have a contract):');
  for (const coverage of uncovered) {
    const skippedNote = coverage.skippedNonComponents.length > 0 ? ` (skipped, not components: ${coverage.skippedNonComponents.join(', ')})` : '';
    ctx.log(`  - ${coverage.directory}: ${coverage.coveredExports} of ${coverage.totalExports} exports${skippedNote}`);
  }
  return 0;
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
      // process.exitCode rather than process.exit(): the latter can truncate
      // a still-flushing stdout write, which for a check means losing the
      // very lines that say what failed.
      // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
      process.exitCode = runCompat(parseBaseArg(rest), { json });
      // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
      break;
    // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-dispatch-compat
    // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-dispatch-guard
    case 'guard':
      // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-guard-exit
      process.exitCode = runGuard(parseBaseArg(rest), { json });
      // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-guard-exit
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
