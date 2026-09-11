#!/usr/bin/env node

/**
 * Type-check every MFE package - and every verification package - independently.
 *
 * Each package under `src-app/mfe_packages/` has its own install boundary and
 * its own `tsconfig`, so there is no single `tsc` invocation that covers them
 * all - this delegates to each package's own `type-check` script. The same
 * goes for `src-app/verify_packages/`, the workspace root an overlay such as
 * template-design-guardrails lands its `design-verify` package in: it is a
 * workspace like the MFEs, declares its own `type-check`, and until it was
 * scanned here nothing in CI ever ran that script (PR #586 review).
 *
 * A package whose `mfe.json` declares `"templateExample": true` is left out by
 * default, on the same rule the other package scanners apply: it is content the
 * template ships to be read and copied, so an applied project pays for
 * type-checking it on every run without learning anything about its own code.
 * `FRONTX_INCLUDE_TEMPLATE_EXAMPLES=1` puts them back, which is how the
 * template's own repository keeps its scaffold provably compilable.
 *
 * Usage:
 *   npx tsx scripts/run-mfe-type-checks.ts [--parallel] [--timeout=<ms>]
 */

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  TEMPLATE_EXAMPLES_ENV_VAR,
  isNonPackageDirectory,
  isTemplateExamplePackage,
  noDiscoveredPackagesNotice,
  templateExamplesIncluded,
  templateExamplesSkippedNotice,
} from './lib/mfe-tools.js';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * The packages root, resolved from this file's location rather than the working
 * directory.
 *
 * `npm run type-check:mfe` always runs from the package root, so both spellings
 * agree there. Invoked from anywhere else - a nested package, a CI step that
 * forgot to `cd`, an editor task - a working-directory default finds no
 * `src-app/mfe_packages`, reports "no MFE packages" and exits 0. That is the
 * silent pass this script exists to prevent, so the default cannot be the thing
 * that produces it.
 */
const defaultMfeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src-app/mfe_packages',
);

/**
 * The verification packages root, resolved the same way. Declared in the shell's
 * `workspaces` (`src-app/verify_packages/*`) and populated only once an overlay
 * lands a package there; absent on a shell-only seed, which `discoverMfeProjects`
 * reads as an empty set rather than a failure.
 */
const defaultVerifyRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src-app/verify_packages',
);

/** Every workspace root this run scans, in the order their packages are reported. */
const defaultProjectRoots: readonly string[] = [defaultMfeRoot, defaultVerifyRoot];

/**
 * A path with symlinks resolved, or the path itself when it cannot be resolved.
 *
 * Node resolves the main module to its realpath, so a comparison against
 * `import.meta.url` has to resolve both sides or a symlinked checkout leaves the
 * two spellings different. `realpathSync` throws when the path does not exist,
 * which is not a reason to fail: fall back to the input and let the comparison
 * decide.
 */
function realPathOrSelf(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

// Per-MFE type-check timeout. Type-checking rarely takes more than a couple
// of minutes; 15m is a generous ceiling that still catches a genuinely hung
// child without surprising an intentionally slow run. Overridable via
// `--timeout=<ms>` on the CLI; 0 disables.
const defaultTypeCheckTimeoutMs = 15 * 60 * 1000;

// How long a timed-out child gets to honour SIGTERM before it is sent SIGKILL.
// Interpolated into the usage text and the doc block on `runTypeCheck` rather
// than restated in either, so what a reader is told matches what runs.
const sigkillGraceMs = 5_000;

interface CliOptions {
  parallel: boolean;
  help: boolean;
  timeoutMs: number;
}

/** One package this run type-checks, and the directory to spawn npm in. */
interface MfeProject {
  cwd: string;
  name: string;
}

/**
 * Outcome of the package scan. The skipped example names travel with the
 * projects for the same reason they do in `getMFEPackages`: a caller reporting
 * an empty set has to say which kind of empty it is.
 */
interface MfeProjectDiscovery {
  projects: MfeProject[];
  /** Directory names that hold a `package.json` but declare no `type-check` script. */
  missingTypeCheckScript: string[];
  /** Directory names left out because their `mfe.json` declares template example content. */
  skippedExamples: string[];
}

function printUsage(): void {
  console.log(
    `Usage: npx tsx scripts/run-mfe-type-checks.ts [--parallel] [--timeout=<ms>]

Options:
  --parallel     Run per-MFE type-check concurrently. Defaults to sequential,
                 which keeps interleaved stdout readable for small runs; use
                 --parallel for CI or multi-MFE repos where fanning out
                 saves wall-clock time.
  --timeout=<ms> Per-child timeout in milliseconds. Default ${defaultTypeCheckTimeoutMs}
                 (15 minutes); 0 disables. On timeout the child is sent
                 SIGTERM, then SIGKILL after ${sigkillGraceMs}ms.
  -h, --help     Print this message.

Environment:
  ${TEMPLATE_EXAMPLES_ENV_VAR}=1
                 Type-check the template's own example and scaffold packages
                 too. They are left out by default.
`,
  );
}

function parseArgs(argv: string[]): CliOptions {
  let parallel = false;
  let help = false;
  let timeoutMs: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--parallel' || arg === 'parallel') {
      parallel = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg.startsWith('--timeout=')) {
      timeoutMs = parseTimeoutValue(arg.slice('--timeout='.length));
      continue;
    }

    if (arg === '--timeout') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        console.error('Missing value for --timeout. Expected --timeout=<ms>.');
        printUsage();
        process.exit(1);
      }
      timeoutMs = parseTimeoutValue(next);
      i++;
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    printUsage();
    process.exit(1);
  }

  return {
    parallel,
    help,
    timeoutMs: timeoutMs ?? defaultTypeCheckTimeoutMs,
  };
}

function parseTimeoutValue(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    console.error(
      `Invalid --timeout value "${raw}". Expected a non-negative integer (milliseconds); use 0 to disable.`,
    );
    process.exit(1);
  }
  return parsed;
}

/**
 * Scan the MFE packages directory for packages this run should type-check.
 *
 * Exported for `__tests__/template-example-packages.test.ts`, which runs the
 * real scan against a fixture tree rather than a copy of its rules. The CLI
 * entry at the foot of this file guards on being the process entry point, so
 * importing this spawns nothing.
 *
 * @param mfeRoot - Directory to scan. Defaults to `defaultMfeRoot`, resolved from
 *   this file's location; tests pass it explicitly, since the default is fixed at
 *   import time and a test cannot move it
 */
export async function discoverMfeProjects(
  mfeRoot: string = defaultMfeRoot,
): Promise<MfeProjectDiscovery> {
  // Only an absent directory means "no MFE packages": a shell-only seed has no
  // `src-app/mfe_packages/` until a template overlay adds one. Every other
  // failure - EACCES, EIO, a path that turns out to be a file - has to reach the
  // caller, because swallowing it would report a clean type-check over a tree
  // this never managed to read. `getMFEPackages` draws the same line with its
  // `existsSync` guard ahead of an unguarded `readdirSync`.
  const entries = await readdir(mfeRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingDirectory(error)) return [];
    throw error;
  });
  const projects: MfeProject[] = [];
  const missingTypeCheckScript: string[] = [];
  const skippedExamples: string[] = [];
  const includeExamples = templateExamplesIncluded();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    // `shared` and dot-directories are not MFE packages, on the same shared
    // predicate the other two scanners apply. It runs ahead of the
    // `type-check`-script lookup below, which refuses the whole run for a
    // package that declares no such script: `shared` is a library and declares
    // none, so reaching that check would refuse a run over a directory that was
    // never a package.
    if (isNonPackageDirectory(entry.name)) {
      continue;
    }

    const cwd = path.join(mfeRoot, entry.name);

    // Ahead of reading `package.json`: an example package is out of this run
    // whether or not it declares a `type-check` script, and the hard failure
    // below would otherwise refuse the whole run over a package nothing
    // intends to check.
    if (!includeExamples && isTemplateExamplePackage(cwd)) {
      skippedExamples.push(entry.name);
      continue;
    }

    const packageJsonPath = path.join(cwd, 'package.json');
    let packageJson: unknown;

    try {
      packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    } catch {
      continue;
    }

    if (!declaresTypeCheckScript(packageJson)) {
      missingTypeCheckScript.push(entry.name);
      continue;
    }

    projects.push({ cwd, name: entry.name });
  }

  return { projects, missingTypeCheckScript, skippedExamples };
}

/**
 * Scan every workspace root this run covers - MFE packages and verification
 * packages - and merge the results in root order.
 *
 * The example filter and the missing-`type-check` refusal apply per package
 * regardless of root: a verification package carries no `mfe.json`, so it is
 * never an example and is always checked; one without a `type-check` script
 * refuses the run exactly as an MFE would, since a package present in the tree
 * and silently unchecked is the state this script exists to prevent.
 *
 * @param roots - Directories to scan. Defaults to the MFE and verification
 *   roots resolved from this file's location; tests pass them explicitly
 */
export async function discoverTypeCheckProjects(
  roots: readonly string[] = defaultProjectRoots,
): Promise<MfeProjectDiscovery> {
  const merged: MfeProjectDiscovery = {
    projects: [],
    missingTypeCheckScript: [],
    skippedExamples: [],
  };
  for (const root of roots) {
    const discovery = await discoverMfeProjects(root);
    merged.projects.push(...discovery.projects);
    merged.missingTypeCheckScript.push(...discovery.missingTypeCheckScript);
    merged.skippedExamples.push(...discovery.skippedExamples);
  }
  return merged;
}

/**
 * Whether a rejection is the "directory is not there" case, told apart from
 * every other reason a read can fail.
 *
 * The rejection arrives as `unknown`, so the hop down to `code` is checked
 * rather than asserted; a `readdir` rejection carries it as a string.
 */
function isMissingDirectory(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
  );
}

/**
 * Whether a parsed `package.json` body declares a runnable `type-check` script.
 * The body arrives as `unknown` straight from `JSON.parse`, so every hop down to
 * the script name is checked rather than asserted.
 */
function declaresTypeCheckScript(packageJson: unknown): boolean {
  if (typeof packageJson !== 'object' || packageJson === null) return false;
  if (!('scripts' in packageJson)) return false;

  const scripts = packageJson.scripts;
  if (typeof scripts !== 'object' || scripts === null) return false;

  return 'type-check' in scripts && Boolean(scripts['type-check']);
}

/**
 * Why one package's type-check did not pass. Closed, so the reporter's `switch`
 * has to account for every case a child can end in.
 *
 * `spawn-failed` is its own case rather than an exit code because a child that
 * never started says nothing about the package's types - only that npm could not
 * be run - and a reader deserves to be told which of the two happened.
 */
type TypeCheckFailureReason =
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'nonzero-exit'; exitCode: number | null }
  | { kind: 'spawn-failed'; message: string };

/**
 * What one child's type-check came to.
 *
 * A failed check is an outcome this script is built to react to - collect it,
 * print it, carry on to the next package - so it comes back as a value with a
 * closed reason rather than as a rejection. That is what keeps the reason
 * machine-readable: a caller asking "did this time out" reads `kind` instead of
 * matching prose in a message, and the reporter formats the reason in one place
 * rather than reconstructing it.
 */
type TypeCheckOutcome =
  | { ok: true; output: string }
  | { ok: false; reason: TypeCheckFailureReason; output: string };

/** The one place a failure reason becomes prose. */
function describeFailureReason(reason: TypeCheckFailureReason): string {
  switch (reason.kind) {
    case 'timeout':
      return `timed out after ${reason.timeoutMs}ms`;
    case 'nonzero-exit':
      return `exit code ${reason.exitCode ?? 'unknown'}`;
    case 'spawn-failed':
      return `could not start ${npmCommand} (${reason.message})`;
  }
}

/**
 * Run the `type-check` npm script inside the project directory.
 *
 * In sequential mode stdout is inherited so the user sees Vitest-style live
 * output. In parallel mode we buffer stdout/stderr per project and flush it
 * with a clear header once the run completes, so concurrent runs don't
 * produce interleaved output that's impossible to read.
 *
 * A positive `timeoutMs` guards against a hung child: the process is sent
 * SIGTERM first, then SIGKILL after a `sigkillGraceMs` grace window if it is
 * still alive. Passing `0` disables the timeout entirely.
 *
 * Exported as the seam the orchestrators are tested against: injecting a stand-in
 * for this is what lets the collect-every-failure behaviour be exercised without
 * spawning npm.
 */
export function runTypeCheck(
  project: MfeProject,
  { buffered, timeoutMs }: { buffered: boolean; timeoutMs: number },
): Promise<TypeCheckOutcome> {
  return new Promise((resolve) => {
    const child = spawn(npmCommand, ['run', 'type-check'], {
      cwd: project.cwd,
      stdio: buffered ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    const chunks: Buffer[] = [];
    if (buffered) {
      child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
    }

    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const clearTimers = (): void => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        if (child.exitCode === null) {
          child.kill('SIGTERM');
        }
        // Gated on the exit status, not on `child.killed`: that flag reports
        // that a signal was delivered, which our own SIGTERM above just made
        // true, so testing it here would skip the escalation every time and
        // leave a child that ignores SIGTERM running until the run ends. The
        // `exit` handler clears this timer, so reaching it means no exit has
        // been observed.
        killTimer = setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }
        }, sigkillGraceMs);
        killTimer.unref();
      }, timeoutMs);
      timer.unref();
    }

    child.on('error', (err) => {
      clearTimers();
      resolve({ ok: false, reason: { kind: 'spawn-failed', message: err.message }, output: '' });
    });
    child.on('exit', (code) => {
      clearTimers();
      const output = buffered ? Buffer.concat(chunks).toString('utf8') : '';

      if (code === 0 && !timedOut) {
        resolve({ ok: true, output });
        return;
      }

      resolve({
        ok: false,
        reason: timedOut ? { kind: 'timeout', timeoutMs } : { kind: 'nonzero-exit', exitCode: code },
        output,
      });
    });
  });
}

/** What an orchestrator needs of `runTypeCheck`, so a test can stand in for it. */
type CheckProject = (
  project: MfeProject,
  options: { buffered: boolean; timeoutMs: number },
) => Promise<TypeCheckOutcome>;

/** One package's failure, with a reason a caller can branch on. */
export interface TypeCheckFailureReport {
  name: string;
  reason: TypeCheckFailureReason;
}

/**
 * A refusal this script raises rather than returns: a run it will not perform,
 * or a run whose packages did not pass.
 *
 * `code` is what an importer branches on. The CLI at the foot of this file
 * prints `message` and exits 1 for either code, but the two are different
 * events - one says the tree is misconfigured, the other says the types are
 * broken - and a caller that has to tell them apart must not be left matching
 * prose in the message.
 */
export class MfeTypeCheckError extends Error {
  constructor(
    message: string,
    public readonly code: 'MISSING_TYPE_CHECK_SCRIPT' | 'TYPE_CHECK_FAILED',
  ) {
    super(message);
    this.name = 'MfeTypeCheckError';
  }
}

/**
 * Refuse the whole run when any discovered package declares no `type-check`
 * script.
 *
 * A hard refusal rather than a skip: a package present in the tree and silently
 * unchecked is the state this script exists to make impossible, and a missing
 * script is a mistake in the package rather than something a run can route
 * around. Example packages never reach here - the flag filter runs ahead of the
 * script lookup, so a scaffold that declares none cannot refuse a run that was
 * never going to check it.
 *
 * @throws {MfeTypeCheckError} `MISSING_TYPE_CHECK_SCRIPT`, naming every package
 *   that declares none
 */
export function refuseMissingTypeCheckScript(missingTypeCheckScript: readonly string[]): void {
  if (missingTypeCheckScript.length === 0) {
    return;
  }

  throw new MfeTypeCheckError(
    `Missing \`type-check\` script in MFE package(s): ${missingTypeCheckScript.join(', ')}.`,
    'MISSING_TYPE_CHECK_SCRIPT',
  );
}

/**
 * Raise one error naming every package that failed, or return quietly.
 *
 * Each package's own reason is repeated here because by the time this prints,
 * a multi-package run has scrolled far past the first failure, and a timeout
 * has to stay distinguishable from a type error.
 *
 * @throws {MfeTypeCheckError} `TYPE_CHECK_FAILED`, listing each failed package
 *   with its own reason
 */
export function throwOnFailures(failures: TypeCheckFailureReport[]): void {
  if (failures.length === 0) {
    return;
  }

  const detail = failures
    .map((failure) => `  - ${failure.name}: ${describeFailureReason(failure.reason)}`)
    .join('\n');

  throw new MfeTypeCheckError(
    `Type-check failed for ${failures.length} MFE package(s):\n${detail}`,
    'TYPE_CHECK_FAILED',
  );
}

/**
 * Type-check every project one at a time, collecting failures instead of
 * stopping at the first one.
 *
 * Awaiting each child directly would abort the loop on the first red package
 * and leave every later package unchecked, so a single broken MFE would hide
 * the state of all its siblings and turn one fix-and-rerun cycle into as many
 * cycles as there are broken packages.
 */
export async function runSequential(
  projects: MfeProject[],
  { timeoutMs, checkProject = runTypeCheck }: { timeoutMs: number; checkProject?: CheckProject },
): Promise<TypeCheckFailureReport[]> {
  const failures: TypeCheckFailureReport[] = [];

  for (const project of projects) {
    console.log(`\n==> Type-checking ${project.name}`);
    const outcome = await checkProject(project, { buffered: false, timeoutMs });
    if (!outcome.ok) {
      failures.push({ name: project.name, reason: outcome.reason });
    }
  }

  return failures;
}

export async function runParallel(
  projects: MfeProject[],
  { timeoutMs, checkProject = runTypeCheck }: { timeoutMs: number; checkProject?: CheckProject },
): Promise<TypeCheckFailureReport[]> {
  console.log(`\n==> Type-checking ${projects.length} MFE package(s) in parallel`);

  const outcomes = await Promise.all(
    projects.map((project) => checkProject(project, { buffered: true, timeoutMs })),
  );

  const failures: TypeCheckFailureReport[] = [];

  outcomes.forEach((outcome, index) => {
    const project = projects[index];
    console.log(`\n==> ${project.name}`);

    // Buffered output is worth printing either way: a red child's output is the
    // diagnosis, and a green one's is the record that it ran.
    if (outcome.output) {
      process.stdout.write(outcome.output);
    }

    if (!outcome.ok) {
      failures.push({ name: project.name, reason: outcome.reason });
    }
  });

  return failures;
}

async function main(): Promise<void> {
  const { parallel, help, timeoutMs } = parseArgs(process.argv.slice(2));

  if (help) {
    printUsage();
    return;
  }

  const { projects, missingTypeCheckScript, skippedExamples } = await discoverTypeCheckProjects();

  refuseMissingTypeCheckScript(missingTypeCheckScript);

  if (projects.length === 0) {
    // `noDiscoveredPackagesNotice` already names the skipped examples when they
    // are the whole reason the set is empty, so the skip line below would only
    // repeat it.
    console.log(
      `${noDiscoveredPackagesNotice(skippedExamples)} No verification packages either. Skipping per-package type-check.`,
    );
    return;
  }

  // The type-check flow is the notice's own home. Manifest generation carries it
  // for `dev`, `build` and `dev:all`, but `npm run type-check` chains
  // `type-check:package`, `:package:test`, `:app`, `:packages` and `:mfe` - none
  // of which generates a manifest - so nothing else in this flow would report
  // which packages the scan left out.
  if (skippedExamples.length > 0) {
    console.log(templateExamplesSkippedNotice(skippedExamples));
  }

  const failures = parallel
    ? await runParallel(projects, { timeoutMs })
    : await runSequential(projects, { timeoutMs });

  throwOnFailures(failures);
}

// Type-checking is what running this file does, and only running it: the test
// that imports `discoverMfeProjects` must not spawn npm across the real
// project's packages as a side effect of the import. The comparison is against
// the resolved path of the file node was told to run, so it holds under
// `tsx scripts/run-mfe-type-checks.ts` as well as under node.
const invokedPath = process.argv[1];
const isProcessEntryPoint =
  invokedPath !== undefined &&
  realPathOrSelf(path.resolve(invokedPath)) === realPathOrSelf(fileURLToPath(import.meta.url));

if (isProcessEntryPoint) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
