/**
 * Contract Guard/Compat CI Policy (branch review 5720fd49, finding B1: the
 * whole contract guard/compat pipeline was built but never invoked by CI, so
 * nothing enforced it on a real PR - the merge-time compatibility guard the
 * branch exists to build did not exist in the shipped workflow).
 *
 * Runs, in the ui-kit workspace: `contracts:check -- guard --base <ref>`,
 * `contracts:check -- compat --base <ref>`, then `contracts:enrollment`
 * (informational only - enrolled.json is an opt-in allowlist grown one
 * component at a time, not a floor every component must already meet, so a
 * low enrollment number never fails the build; it runs last, for visibility,
 * whether or not guard/compat ran at all).
 *
 * The base ref is never guessed here - this script only accepts one, either
 * as `--base-ref <ref>` or CONTRACTS_POLICY_BASE_REF, and does nothing
 * clever with git history or event payloads to invent one. That deliberately
 * mirrors version-bump-on-change-check.mjs's own shape (a script that trusts
 * an already-resolved ref) rather than its FALLBACK CHAIN: that script only
 * ever needs a base on `pull_request` (its own CI step is gated
 * `if: github.event_name == 'pull_request'`), where GITHUB_BASE_REF is an
 * Actions-provided env var it can read directly. This gate also runs on
 * `push` to develop/main - a merge can itself land an uncovered breaking
 * contract change, not only a PR - and `push` has no equivalent
 * Actions-provided base env var, only the event payload's `before` SHA. So
 * the workflow computes CONTRACTS_POLICY_BASE_REF per event
 * (`origin/${{ github.base_ref }}` on pull_request, `github.event.before` on
 * push) and this script just runs against whatever it is given - if nothing
 * is given (a branch's first push has no `before` commit worth diffing
 * against), guard/compat are skipped with a printed reason rather than
 * diffing against nothing; the enrollment report still runs.
 *
 * CLI entry: `node scripts/contracts-policy.mjs [--base-ref <ref>]`
 * (exit 0 on success). Core logic is exported for unit tests.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const WORKSPACE = '@gears-frontx/ui-kit';

/**
 * @typedef {{
 *   run: (npmScript: string, scriptArgs: string[]) => number;
 * }} Runner
 */

/**
 * @param {string[]} argv
 * @returns {string | undefined}
 */
export function baseRefFromArgv(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-ref') return argv[i + 1];
    if (arg.startsWith('--base-ref=')) return arg.slice('--base-ref='.length);
  }
  return undefined;
}

/**
 * @param {{ log?: (line: string) => void }} [options]
 * @returns {Runner}
 */
function realRunner({ log = console.log } = {}) {
  return {
    run(npmScript, scriptArgs) {
      const args = ['run', npmScript, `--workspace=${WORKSPACE}`, ...(scriptArgs.length > 0 ? ['--', ...scriptArgs] : [])];
      log(`$ npm ${args.join(' ')}`);
      const result = spawnSync('npm', args, { stdio: 'inherit' });
      if (result.error) throw result.error;
      return result.status ?? 1;
    },
  };
}

/**
 * @param {{
 *   argv?: string[];
 *   env?: Record<string, string | undefined>;
 *   log?: (line: string) => void;
 *   runner?: Runner;
 * }} [options]
 * @returns {number} 0 on success, the first nonzero exit code otherwise.
 */
export function runCli(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const runner = options.runner ?? realRunner({ log });

  const baseRef = baseRefFromArgv(argv) ?? (env.CONTRACTS_POLICY_BASE_REF || undefined);

  if (!baseRef) {
    log(
      '[contracts-policy] No base ref given (--base-ref / CONTRACTS_POLICY_BASE_REF) - ' +
        'skipping guard and compat (nothing to diff against); the enrollment report still runs.',
    );
  } else {
    const guardExit = runner.run('contracts:check', ['guard', '--base', baseRef]);
    if (guardExit !== 0) return guardExit;
    const compatExit = runner.run('contracts:check', ['compat', '--base', baseRef]);
    if (compatExit !== 0) return compatExit;
  }

  // Never gates the build on its own exit code - `contracts:enrollment` itself
  // never calls process.exit(1) (see check.ts's runEnrollment), so this is
  // belt-and-braces against a future change to that contract, not a real
  // branch this policy expects to take today.
  runner.run('contracts:enrollment', []);
  return 0;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  // process.exitCode rather than process.exit(): the latter can truncate a
  // still-flushing stdout/stderr write, which for a guard means losing the
  // very lines that say what failed - same reasoning as
  // version-bump-on-change-check.mjs's own entry point.
  process.exitCode = runCli();
}
