// Contract checks that only make sense against a git history: whether a
// component's props schema stays backward compatible with what shipped at
// some base ref (`compat`), whether a merge that touched an already-enrolled
// component still carries fresh contract artifacts (`guard`), and how much
// of the kit is enrolled at all (`enrollment`). All the decision logic lives in
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
//   npm run contracts:enrollment [-- --json]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GTS } from '@globaltypesystem/gts-ts';

import {
  buildEnrollmentReport,
  compareElementSurfaces,
  decideCompat,
  decideRemoval,
  diffOwnPropsSchema,
  evaluateGuard,
  extractContractMajor,
  findRemovedContracts,
  mapChangedFilesToComponents,
  nearMissesIn,
  propsPassedTo,
  resolveRenameSource,
  synthesizeVersionedId,
  touchesAnyOverlay,
  touchesEnrollmentList,
  touchesDependencyManifest,
  touchesSharedContractTooling,
  undeclaredForwardedProps,
  type BaseRefContractEntry,
  type CompatDecision,
  type DirectoryExportEnrollment,
  type GuardResult,
  type ElementSurfaceDiff,
  type NearMissFinding,
} from './check-lib';
import {
  compileContract,
  hostElementToken,
  loadBaseSchema,
  loadElementSurface,
  loadHostSurface,
  overlayStems,
  pascalCase,
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
  // exported name in the file, for the enrollment report's "n of m exports".
  componentExportNames: (directory: string) => string[];
  exportedDeclarationNames: (directory: string) => string[];
  // The props a component forwards to its host element that the committed
  // surface for that element declares by neither name nor pattern - the
  // informational half of the enrollment report. Injected for the reason every
  // other entry here is: it reads the component's own source and the
  // committed surface, both resolved against this package.
  undeclaredForwardedProps: (directory: string, exportStem: string) => string[];
  // Every near miss of a kit prop in the usages this harness can see for one
  // described export - its contract's own examples. Injected like every
  // other entry here: it compiles a contract against this package's own
  // kit root. This is the piece that makes the annotated open schema safe:
  // the schema admits `variannt` and records that nothing checked it, and
  // this is where a name one edit from a real kit prop becomes an exit code.
  nearMisses: (directory: string, exportStem: string) => NearMissFinding[];
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
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-enrolled
    // The same freshness check testing.ts asserts per-component, run here for
    // whichever component the guard is currently evaluating rather than every
    // component in the kit.
    isComponentFresh: (directory, exportStem) => checkComponentFreshness(directory, exportStem).fresh,
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-enrolled
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-unenrolled
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
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-unenrolled
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-forwarded
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
        if (extraction.elementKind === undefined || extraction.forwardedProps.length === 0) return [];
        return undeclaredForwardedProps(
          extraction.forwardedProps.map((prop) => prop.name),
          loadElementSurface(extraction.elementKind),
        );
      } catch {
        return [];
      }
    },
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-forwarded
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce
    // The usages the harness can see for an export are the ones its own
    // contract carries: the `good` snippets a consumer is meant to copy and
    // the `bad` ones it is meant to recognize. A typo is a typo in either -
    // a counter-example teaches its own shape, and a misspelled prop in one
    // teaches the misspelling.
    //
    // NOT swallowed the way the two reports above are: this one derives an
    // exit code, so a component whose contract cannot be compiled has to
    // reach the guard's own freshness failure rather than quietly
    // contributing no findings.
    nearMisses: (directory, exportStem) => {
      const contract = compileContract(directory, exportStem);
      const component = pascalCase(exportStem);
      const usages: { source: string; props: string[] }[] = [];
      const examples = contract['x-gts-traits'].examples;
      for (const [kind, entries] of [
        ['good', examples.good],
        ['bad', examples.bad],
      ] as const) {
        for (const entry of entries) {
          for (const props of propsPassedTo(entry.code, component)) {
            usages.push({ source: `examples.${kind} "${entry.title}"`, props });
          }
        }
      }
      return nearMissesIn(exportStem, usages, contract, loadHostSurface(contract));
    },
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce
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

function elementsDir(ctx: CheckContext): string {
  return join(ctx.kitRoot, 'scripts', 'contracts', 'elements');
}

function enrolledPath(ctx: CheckContext): string {
  return join(ctx.kitRoot, 'scripts', 'contracts', 'enrolled.json');
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-count
function listComponentDirs(ctx: CheckContext): string[] {
  return readdirSync(componentsDir(ctx), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-count

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-count
function loadEnrolled(ctx: CheckContext): string[] {
  return JSON.parse(readFileSync(enrolledPath(ctx), 'utf8')) as string[];
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-count

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
// wrong decision: no contract exists at a ref that does not exist, so every
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

// A contract's decision, plus which base-ref path it was compared against.
// `basePath` is what tells runCompat that a base-ref contract has an heir
// here: everything at the base ref that no unit claimed is a removal.
type UnitCompatResult = CompatDecision & { component: string; isNew: boolean; removed: boolean; basePath?: string };

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
    return { component, isNew: true, removed: false, decision: 'pass', notes: [`${component}: new contract (absent at ${base})`] };
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
  // The vocabulary the base type's x-gts-traits-schema references: registered here
  // too, so a store this tool builds is a complete registry rather than one
  // whose x-gts-traits-schema cannot resolve, and so a future change to one of
  // those types is compared through the same store as every other schema.
  registerContractTypes((entity) => gts.register(entity));
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-register
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-element-surface-both
  // Both revisions' host elements, and the schema each one names: the old one
  // as it shipped at the base ref, the new one as it is committed here.
  // Reading the element off the new contract alone made an entire class of
  // change invisible - drop the reference and there is no element to look up,
  // so the block was skipped and every forwarded prop disappeared silently.
  // Read off the reference each revision HOLDS, not re-derived through
  // extraction - `compat` compares two POINTS IN TIME of the same contract,
  // and the reference each one actually shipped with is the ground truth for
  // which surface it named, not whatever extraction says the CURRENT source
  // resolves to. Read for BOTH revisions: see compareElementSurfaces in
  // check-lib.ts for what each combination of the two answers means.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-element-surface
  const newElement = hostElementToken(newContract);
  const oldElement = hostElementToken(oldContract);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-element-surface
  let newElementSurface: Record<string, unknown> | undefined;
  if (newElement !== undefined) {
    const newSurfacePath = join(elementsDir(ctx), `${newElement}.json`);
    if (existsSync(newSurfacePath)) {
      newElementSurface = JSON.parse(readFileSync(newSurfacePath, 'utf8')) as Record<string, unknown>;
      // Registered so the surface the contract NAMES is a resolvable type in
      // the store this comparison runs in, rather than an id pointing at
      // nothing.
      gts.register(newElementSurface);
    }
  }
  const oldElementSurface =
    oldElement === undefined ? undefined : readJsonAt(ctx, base, `scripts/contracts/elements/${oldElement}.json`);
  // The old revision's own surface, when it is a different type from the new
  // one: registered so the surface BOTH synthetic revisions name is
  // resolvable, not only the current one's. Skipped when the element is
  // unchanged, where the two carry the same $id and the second registration
  // would only overwrite the first.
  if (oldElementSurface !== undefined && oldElement !== newElement) gts.register(oldElementSurface);

  const comparison = compareElementSurfaces({
    component,
    oldElement,
    newElement,
    oldSchema: oldElementSurface,
    newSchema: newElementSurface,
  });
  const elementSurfaceDiff: ElementSurfaceDiff | undefined = comparison.diff;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-element-surface-both

  // gts-ts's checkCompatibility (GtsCompatibility.checkCompatibility) diffs
  // the two schemas' OWN properties/required fields and never follows a
  // reference of any kind (see check-lib.ts's diffElementSurface comment
  // for why the forwarded surface needs its own diff above). Old and new
  // normally share the same real $id (same component, same major), so both are
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
  const ownPropsDiff = diffOwnPropsSchema(oldContract, newContract, newElementSurface);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-decision:p1:inst-cd-own

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compat-unit:p1:inst-cu-decide
  const decision = decideCompat({
    component,
    oldMajor,
    newMajor,
    gtsBackwardCompatible: result.is_backward_compatible,
    gtsBackwardErrors: result.backward_errors,
    elementSurfaceDiff,
    ownPropsDiff,
  });
  const notes = decision.notes.map((note) => `${note}${renamedFromNote}`);
  if (comparison.note !== undefined) notes.push(comparison.note);
  return { component, isNew: false, removed: false, decision: decision.decision, notes, basePath };
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
    enrolled: existsSync(enrolledPath(ctx)) ? loadEnrolled(ctx) : [],
  });
  for (const removal of removals) {
    const decision = decideRemoval(removal);
    results.push({ component: removal.stem, isNew: false, removed: true, decision: decision.decision, notes: decision.notes });
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compat-removal:p1:inst-cr-sweep

  if (results.length === 0) {
    if (options.json) ctx.log(JSON.stringify({ command: 'compat', base, failed: false, results: [] }));
    else ctx.log('compat: no components carry a contract.json yet - nothing to check.');
    return 0;
  }

  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
  const failed = results.some((result) => result.decision === 'fail');
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit

  if (options.json) {
    ctx.log(JSON.stringify({ command: 'compat', base, failed, results }));
  } else {
    for (const result of results) {
      const label =
        result.decision === 'fail' ? 'FAIL' : result.removed ? 'REMOVED' : result.isNew ? 'NEW' : 'PASS';
      ctx.log(`[${label}] ${result.notes.join(' ')}`);
    }
  }
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
  return failed ? 1 : 0;
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-compat-exit
}

// How many of a directory's exported components have an overlay, and how
// many the checker resolves in total - used both to decide `overlayExists`
// below (a enrolled compound directory needs EVERY export described, not
// just one) and by `enrollment`'s "n of m exports" report.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-unenrolled
function componentExportEnrollment(ctx: CheckContext, directory: string): DirectoryExportEnrollment {
  const componentNames = ctx.componentExportNames(directory);
  const skippedNonComponents = ctx.exportedDeclarationNames(directory).filter((name) => !componentNames.includes(name));
  return {
    directory,
    totalExports: componentNames.length,
    enrolledExports: ctx.overlayStems(directory).length,
    skippedNonComponents,
  };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-unenrolled

// Every near miss across a set of enrolled directories, one entry per
// export. Shared by the enrollment report and the guard because the rule is
// one rule: the guard is what CI runs, so that is where a near miss has to
// fail, and the enrollment command is where a developer looks before asking
// for enrollment, so that is where it has to be visible. An entry naming no
// directory contributes nothing - the allowlist report above is what says so.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce
function enrolledComponentNearMisses(ctx: CheckContext, enrolled: readonly string[], unknownEnrolled: ReadonlySet<string>): NearMissFinding[] {
  return enrolled
    .filter((component) => !unknownEnrolled.has(component))
    .flatMap((component) => ctx.overlayStems(component).flatMap((stem) => ctx.nearMisses(component, stem)));
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce

export function runGuard(base: string, options: { json: boolean }, ctx: CheckContext = defaultCheckContext()): number {
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-verify-base
  if (!baseRefResolves(ctx, base)) return refuseUnresolvableBase(ctx, 'guard', base);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-verify-base
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed
  const changedFiles = changedFilesSince(ctx, base);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-changed
  const enrolled = loadEnrolled(ctx);
  // The allowlist as it was at the base reference. Read so that a component
  // DROPPED from it is still in scope for the change that drops it: the new
  // list alone takes it out of scope with no line in any output, and that
  // same edit is the acknowledgement the removal sweep accepts, so it must
  // not also be the edit nothing looks at.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist-union
  const baseEnrolled = (readJsonAt(ctx, base, 'scripts/contracts/enrolled.json') as unknown as string[] | undefined) ?? enrolled;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist-union
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-map
  const touchedDirectly = mapChangedFilesToComponents(changedFiles);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-map
  // A change to shared compiling machinery can reshape any enrolled
  // component's compiled output without touching that component's own
  // directory at all (M6) - re-evaluate every enrolled entry, not just the
  // directories the diff happens to name.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-scope
  const toolingChanged = touchesSharedContractTooling(changedFiles);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-scope
  // The allowlist decides which components are held to the standard at all,
  // so editing it has to re-check everything it now names - otherwise an
  // entry could be added for a directory with no overlay, or left behind for
  // a directory that is gone, and the file that grants enrollment would be the
  // one file enrollment never looked at.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist
  const enrollmentChanged = touchesEnrollmentList(changedFiles);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist
  // An overlay's accepted components decide another component's mount
  // points, so an edit to any overlay can move a contract in a directory this
  // change never touched.
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
  // has to include what the enrolled set NAMED as well as what it names.
  const touched =
    toolingChanged || enrollmentChanged || overlayChanged || dependenciesChanged
      ? new Set([...touchedDirectly, ...enrolled, ...baseEnrolled])
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
          enrollmentChanged,
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
      ctx.log('guard: shared contract tooling changed - re-checking every enrolled component for freshness.');
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-scope
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist
    if (enrollmentChanged) {
      ctx.log('guard: enrolled.json changed - re-checking every component it names.');
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-allowlist
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-overlay
    if (overlayChanged) {
      ctx.log(
        'guard: an overlay changed - re-checking every enrolled component, because one overlay\'s accepted components ' +
          "decide another component's mount points.",
      );
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-overlay
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-deps
    if (dependenciesChanged) {
      ctx.log(
        'guard: a dependency manifest changed - re-checking every enrolled component, because a committed contract ' +
          "carries the checker's printed type text for the packages it depends on.",
      );
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-widen-deps
  }

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-each
  ctx.prepareExtraction([...touched]);
  const enrolledSet = new Set(enrolled);
  const baseEnrolledSet = new Set(baseEnrolled);
  let violated = false;
  const results: GuardResult[] = [];
  for (const component of [...touched].sort()) {
    // A deleted directory must never crash an unguarded readdirSync (M10):
    // check existence once, up front, and route through evaluateGuard's
    // dedicated outcome instead of letting overlayStems/componentExportEnrollment
    // throw ENOENT past the print loop below.
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-removed
    const componentExists = existsSync(join(componentsDir(ctx), component));
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-removed
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-enrolled
    let overlayExists = false;
    let artifactsFresh = false;
    let contractTestExists = false;
    if (componentExists) {
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-suite
      contractTestExists = ctx.contractTestExists(component);
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-suite
      const stems = ctx.overlayStems(component);
      const { totalExports } = componentExportEnrollment(ctx, component);
      // A enrolled compound directory must have every export described, not
      // merely one overlay - a directory that touches "overlayExists" by
      // coincidence (its root overlay happens to exist) while a sibling
      // part's overlay is missing or stale would otherwise pass silently.
      overlayExists = stems.length > 0 && stems.length === totalExports;
      const isEnrolled = enrolledSet.has(component);
      // Freshness only needs computing (and can only be computed - it calls
      // compileContract, which throws without an overlay) for a enrolled
      // component that actually has every overlay; evaluateGuard already
      // fails an incomplete enrolled component before this matters.
      artifactsFresh = isEnrolled && overlayExists ? stems.every((stem) => ctx.isComponentFresh(component, stem)) : false;
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-enrolled
    const result = evaluateGuard({
      component,
      enrolled: enrolledSet.has(component),
      overlayExists,
      artifactsFresh,
      componentExists,
      contractTestExists,
      wasEnrolled: baseEnrolledSet.has(component),
    });
    results.push(result);
    if (result.status === 'enrolled-violation' || result.status === 'component-removed') violated = true;
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-each

  // The near-miss check, on the components this run is already about and
  // that are actually enrolled with every overlay in place. The guard is
  // what CI runs, which is why it is here as well as in the enrollment
  // report: a typo'd kit prop admitted by the open schema is a defect no
  // other check in this repository derives a failure from.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce
  const checkable = results
    .filter((result) => result.status === 'enrolled-ok')
    .map((result) => result.component)
    .filter((component) => enrolledSet.has(component));
  const nearMisses = enrolledComponentNearMisses(ctx, checkable, new Set());
  if (nearMisses.length > 0) violated = true;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-guard:p1:inst-gd-return
  if (options.json) {
    ctx.log(
      JSON.stringify({
        command: 'guard',
        base,
        violated,
        toolingChanged,
        enrollmentChanged,
        overlayChanged,
        dependenciesChanged,
        results,
        nearMisses,
      }),
    );
  } else {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce
    for (const finding of nearMisses) {
      ctx.log(
        `[FAIL] ${finding.component}: "${finding.prop}" in ${finding.source} is one edit from "${finding.probably}" - ` +
          `the schema admits it and checks nothing, which is what makes a typo of a kit prop an error rather than an unchecked name`,
      );
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce
    for (const result of results) {
      const label =
        result.status === 'enrolled-violation' || result.status === 'component-removed'
          ? 'FAIL'
          : result.status === 'enrolled-ok'
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

// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-enrollment-report:p1
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2
export function runEnrollment(options: { json: boolean }, ctx: CheckContext = defaultCheckContext()): number {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-count
  const all = listComponentDirs(ctx);
  const enrolled = loadEnrolled(ctx);
  const report = buildEnrollmentReport(all, enrolled);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-count
  // enrolled.json is a human-curated allowlist (the guard's gate, grown one
  // directory at a time); the fraction here is the live, filesystem-derived
  // count of what already has a contract - a compound directory can read
  // "4 of 4 exports" and simply not be promoted into enrolled.json yet, which
  // is a different, more actionable fact than "0 of 63" was ever able to say.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-unenrolled
  ctx.prepareExtraction(all);
  const byDirectory = new Map(all.map((directory) => [directory, componentExportEnrollment(ctx, directory)]));
  const unenrolled = report.unenrolled.map(
    (component) => byDirectory.get(component) ?? { directory: component, totalExports: 0, enrolledExports: 0, skippedNonComponents: [] },
  );
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-unenrolled

  // An allowlist entry only grants enrollment while there is something behind
  // it. An entry naming no directory, or a directory carrying no overlay, was
  // counted as enrollment all the same - the report's own headline number was
  // the thing least able to notice it.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-allowlist
  const unknownEnrolled = new Set(report.unknownEnrolled);
  const allowlistProblems = [
    ...report.unknownEnrolled.map((component) => `${component}: named in enrolled.json but no such component directory`),
    ...enrolled
      .filter((component) => !unknownEnrolled.has(component) && ctx.overlayStems(component).length === 0)
      .sort()
      .map((component) => `${component}: named in enrolled.json but carries no *.contract.yaml overlay`),
  ];
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-allowlist

  // The completeness of a hand-written element surface is not checked
  // anywhere, on purpose: nobody enumerates React's attributes for an
  // element, and an attribute no file names reaches a consumer as unknown
  // rather than as rejected. What was missing was any way to see that set,
  // so it is reported here - beside the enrollment numbers, deriving no exit
  // code, for the same reason none of them do.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-forwarded
  const forwardedGaps = enrolled
    .filter((component) => !unknownEnrolled.has(component))
    .flatMap((component) =>
      ctx
        .overlayStems(component)
        .map((stem) => ({ component: stem, props: ctx.undeclaredForwardedProps(component, stem) }))
        .filter((entry) => entry.props.length > 0),
    );
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-forwarded

  // The one thing in this report that DOES derive an exit code, and the
  // reason it is here: a compiled contract admits every unrecognized prop
  // and records the classification, so a name one edit from a real kit prop
  // is caught by nothing unless a command runs the classification. Every
  // other number here counts what exists; this one is a defect.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce
  const nearMisses = enrolledComponentNearMisses(ctx, enrolled, unknownEnrolled);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-return
  if (options.json) {
    ctx.log(
      JSON.stringify({
        command: 'enrollment',
        total: report.total,
        enrolledCount: report.enrolledCount,
        unenrolled,
        allowlistProblems,
        forwardedGaps,
        nearMisses,
      }),
    );
    return nearMisses.length > 0 ? 1 : 0;
  }

  ctx.log(`${report.enrolledCount} of ${report.total} components enrolled.`);
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce
  if (nearMisses.length > 0) {
    ctx.log('Props one edit from a kit prop the contract declares (a typo, not an unchecked name):');
    for (const finding of nearMisses) {
      ctx.log(`  - ${finding.component}: "${finding.prop}" in ${finding.source} - probably "${finding.probably}"`);
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-props-classification:p1:inst-pc-enforce
  if (allowlistProblems.length > 0) {
    ctx.log('enrolled.json entries that grant enrollment over nothing:');
    for (const problem of allowlistProblems) ctx.log(`  - ${problem}`);
  }
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-forwarded
  if (forwardedGaps.length > 0) {
    ctx.log('Forwarded props no committed element surface declares (reported, never a failure):');
    for (const gap of forwardedGaps) ctx.log(`  - ${gap.component}: ${gap.props.length} - ${gap.props.join(', ')}`);
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-forwarded
  if (unenrolled.length > 0) {
    ctx.log('Not yet in enrolled.json (n of m exports already have a contract):');
    for (const entry of unenrolled) {
      const skippedNote = entry.skippedNonComponents.length > 0 ? ` (skipped, not components: ${entry.skippedNonComponents.join(', ')})` : '';
      ctx.log(`  - ${entry.directory}: ${entry.enrolledExports} of ${entry.totalExports} exports${skippedNote}`);
    }
  }
  return nearMisses.length > 0 ? 1 : 0;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-enrollment:p2:inst-en-return
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
    // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-dispatch-enrollment
    case 'enrollment':
      // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-enrollment-exit
      runEnrollment({ json });
      // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-enrollment-exit
      break;
    // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-dispatch-enrollment
    // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-unknown-subcommand
    default:
      // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-unknown-subcommand-exit
      console.error('Usage: contracts:check <compat --base <git-ref> | guard --base <git-ref> | enrollment> [--json]');
      process.exit(1);
      // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-unknown-subcommand-exit
    // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-guard-change:p1:inst-unknown-subcommand
  }
}
