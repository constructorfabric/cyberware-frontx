/**
 * Top-level CLI flow for the monorepo test runner.
 *
 * `runCli` is the single entry point that composes arg parsing, project
 * discovery, path-based routing, and child-process spawning. The sequential
 * and parallel loops are intentionally symmetric — both wrap `waitForExit`
 * in try/catch, record a per-project `{ name, code }` result on timeout, and
 * keep auditing the rest of the tree so CI summaries stay consistent.
 */
import process from 'node:process';
import { parseArgs, printUsage } from './args.mjs';
import {
  CliError,
  defaultProjectTimeoutMs,
  defaultWatchProjectName,
} from './common.mjs';
import { loadProjects } from './discovery.mjs';
import {
  assertForwardPathArgsExpanded,
  inferProjectsFromForwardArgs,
} from './routing.mjs';
import {
  aggregateExitCode,
  spawnProject,
  waitForExit,
} from './spawning.mjs';

/**
 * @param {string | null} selector
 * @param {import('./common.mjs').Project[]} projects
 * @param {string} projectNames
 * @returns {import('./common.mjs').Project[]}
 */
export function resolveProjects(selector, projects, projectNames) {
  if (!selector) {
    return projects;
  }

  const matched = projects.find((project) => project.name === selector);
  if (!matched) {
    throw new CliError(`Unknown --project="${selector}". Available: ${projectNames}.`);
  }

  return [matched];
}

/**
 * @param {import('./common.mjs').Project[]} projects
 * @param {string} projectNames
 * @returns {import('./common.mjs').Project}
 */
function resolveDefaultWatchProject(projects, projectNames) {
  const matched = projects.find((project) => project.name === defaultWatchProjectName);
  if (!matched) {
    throw new CliError(
      `Configured default watch project "${defaultWatchProjectName}" is missing. Available: ${projectNames}.`,
    );
  }

  return matched;
}

/**
 * @param {import('./common.mjs').Project[]} targets
 * @param {string[]} forwardArgs
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<number>}
 */
export async function runSequentially(targets, forwardArgs, { timeoutMs } = {}) {
  /** @type {{ name: string; code: number }[]} */
  const results = [];

  for (const project of targets) {
    const { child } = spawnProject(project, 'run', forwardArgs);
    // Wrap waitForExit in try/catch so a timeout (or signal exit) for one
    // project is recorded as a failure for that project instead of aborting
    // the rest of the tree. Pre-fix the rejection propagated up into the
    // top-level catch and killed the remaining projects unannounced, which
    // made CI summaries inconsistent with --parallel.
    let code;
    try {
      code = await waitForExit(child, project.name, { timeoutMs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[run-monorepo-unit-tests] ${message}`);
      results.push({ name: project.name, code: 1 });
      continue;
    }

    results.push({ name: project.name, code });

    if (code !== 0) {
      console.error(`[run-monorepo-unit-tests] ${project.name} failed with exit code ${code}.`);
    }
  }

  const failures = results.filter((result) => result.code !== 0);
  if (failures.length > 0) {
    const summary = failures.map((f) => `${f.name} (exit ${f.code})`).join(', ');
    console.error(
      `[run-monorepo-unit-tests] ${failures.length} of ${targets.length} project(s) failed: ${summary}.`,
    );
  }

  return aggregateExitCode(results);
}

/**
 * @param {import('./common.mjs').Project[]} targets
 * @param {string[]} forwardArgs
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<number>}
 */
export async function runInParallel(targets, forwardArgs, { timeoutMs } = {}) {
  console.error(`[run-monorepo-unit-tests] Running ${targets.length} project(s) in parallel.`);

  const results = await Promise.all(
    targets.map(async (project) => {
      const { child, getOutput } = spawnProject(project, 'run', forwardArgs, {
        buffered: true,
      });
      try {
        const code = await waitForExit(child, project.name, { timeoutMs });
        return { name: project.name, code, output: getOutput() };
      } catch (err) {
        // Surface the timeout / signal error as a failure for this child and
        // still flush whatever buffered output we captured before the kill.
        return {
          name: project.name,
          code: 1,
          output: `${getOutput()}${err instanceof Error ? err.message : String(err)}\n`,
        };
      }
    }),
  );

  // Flush each child's output with a header so concurrent logs don't
  // interleave character-by-character (what `stdio: 'inherit'` produced).
  for (const result of results) {
    console.log(`\n==> ${result.name}`);
    if (result.output) {
      process.stdout.write(result.output);
    }
  }

  const failures = results.filter((result) => result.code !== 0);
  for (const failure of failures) {
    console.error(
      `[run-monorepo-unit-tests] ${failure.name} failed with exit code ${failure.code}.`,
    );
  }

  if (failures.length > 0) {
    const summary = failures.map((failure) => `${failure.name} (exit ${failure.code})`).join(', ');
    console.error(
      `[run-monorepo-unit-tests] ${failures.length} of ${targets.length} project(s) failed: ${summary}.`,
    );
  }

  return aggregateExitCode(results);
}

/**
 * @param {import('./common.mjs').Project} target
 * @param {string[]} forwardArgs
 * @returns {Promise<number>}
 */
export async function runInWatchMode(target, forwardArgs) {
  const { child } = spawnProject(target, 'watch', forwardArgs);
  let shuttingDown = false;

  /** @param {NodeJS.Signals} signal */
  const forwardSignal = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (!child.killed) {
      child.kill(signal);
    }
  };

  // Register each handler exactly once via `process.once` — using `process.on`
  // here leaked a pair of listeners every time this function was called from
  // tests or tooling. `once` also matches the intent: one SIGINT/SIGTERM is
  // enough to tear down the watcher; subsequent signals go straight to the
  // default handler so a second Ctrl-C still kills the runner.
  const onSigint = () => forwardSignal('SIGINT');
  const onSigterm = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  try {
    return await waitForExit(child, target.name);
  } finally {
    // Remove any listener that didn't fire (normal exit path) so repeat
    // invocations don't accumulate orphaned handlers on the process.
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

/**
 * @param {{
 *   project: string | null;
 *   projects: import('./common.mjs').Project[];
 *   projectNames: string;
 *   mode: 'run' | 'watch';
 *   forwardArgs: string[];
 * }} options
 * @returns {import('./common.mjs').Project[]}
 */
export function resolveCliTargets({ project, projects, projectNames, mode, forwardArgs }) {
  if (project) {
    return resolveProjects(project, projects, projectNames);
  }

  // Reject unexpanded globs BEFORE inference so "packages/api/**/*.test.ts"
  // fails loudly instead of silently falling through to the all-projects
  // fan-out. `--project=<name>` opt-outs above already let callers run a
  // glob against a single project's Vitest if that's really what they want.
  assertForwardPathArgsExpanded(forwardArgs);

  const inferred = inferProjectsFromForwardArgs(forwardArgs, projects);
  if (inferred.length > 1) {
    const names = inferred.map((candidate) => candidate.name).join(', ');
    throw new CliError(
      `Forwarded path arguments span multiple projects (${names}). Focused runs target one project at a time.\n` +
        'Pass --project=<name> explicitly, or split the invocation per project.',
    );
  }

  if (inferred.length === 1) {
    return inferred;
  }

  if (mode !== 'watch') {
    return projects;
  }

  const defaultWatchProject = resolveDefaultWatchProject(projects, projectNames);
  console.error(
    `[run-monorepo-unit-tests] No project selected for watch mode; defaulting to ${defaultWatchProject.name}. Pass --project=<name> to watch another project.`,
  );
  return [defaultWatchProject];
}

/**
 * @param {import('./common.mjs').Project[]} targets
 * @param {string} projectNames
 * @param {boolean} parallel
 */
export function validateWatchTargets(targets, projectNames, parallel) {
  if (parallel) {
    throw new CliError(
      'Parallel mode only applies to non-interactive runs. Use --watch without --parallel.',
    );
  }

  const targetsWithoutWatchScript = targets.filter(
    (target) => target.kind === 'workspace' && !target.hasWatchScript,
  );
  if (targetsWithoutWatchScript.length > 0) {
    const names = targetsWithoutWatchScript.map((target) => target.name).join(', ');
    throw new CliError(
      `[run-monorepo-unit-tests] Watch mode requires test:unit:watch. Missing in: ${names}.`,
    );
  }

  if (targets.length === 1) {
    return;
  }

  throw new CliError(
    'Watch mode owns stdio for a single Vitest instance; running every package in parallel makes its interactive prompt (p/t/q) unusable.\n' +
      `Pass --project=<name> or a path under one project root. Available: ${projectNames}.\n` +
      'Examples:\n' +
      '  npm run test:unit:watch -- --project=repo-scripts\n' +
      '  npm run test:unit:watch -- scripts/ecosystem-pin-drift-check.test.mjs',
  );
}

/**
 * Top-level CLI flow. Returns the numeric exit code so the entry-point wrapper
 * is the single place that ever calls `process.exit`. Helpers throw `CliError`
 * (or any other `Error`) on failure; the wrapper translates those into an
 * error message + exit code.
 *
 * @returns {Promise<number>}
 */
export async function runCli() {
  const projects = await loadProjects();
  const projectNames = projects.map((currentProject) => currentProject.name).join(', ');
  const {
    mode,
    project,
    parallel,
    help,
    timeoutMs,
    forwardArgs,
  } = parseArgs(process.argv.slice(2));

  if (help) {
    printUsage(projectNames);
    return 0;
  }

  const targets = resolveCliTargets({ project, projects, projectNames, mode, forwardArgs });
  // `null` = user didn't pass `--timeout`, fall back to the default.
  // `0` = user explicitly disabled the timeout (useful for debugging a hang).
  // Any positive int = explicit override in ms.
  const effectiveTimeoutMs = timeoutMs === null ? defaultProjectTimeoutMs : timeoutMs;

  if (mode !== 'watch') {
    if (parallel) {
      return runInParallel(targets, forwardArgs, { timeoutMs: effectiveTimeoutMs });
    }

    return runSequentially(targets, forwardArgs, { timeoutMs: effectiveTimeoutMs });
  }

  validateWatchTargets(targets, projectNames, parallel);
  // Watch mode is interactive and can idle for a long time; the user drives
  // termination via Vitest's own prompt or SIGINT, so no timeout is applied.
  return runInWatchMode(targets[0], forwardArgs);
}
