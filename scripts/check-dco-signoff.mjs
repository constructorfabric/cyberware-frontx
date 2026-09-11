/**
 * DCO Sign-off Commit Guard.
 *
 * CONTRIBUTING.md requires a `Signed-off-by` trailer on every commit
 * (Developer Certificate of Origin), and CI enforces it with the DCO check —
 * but CI is the most expensive possible place to learn about a missing
 * trailer: the PR is already open, the push already made, and the fix is a
 * history rewrite (`git rebase --signoff` + `--force-with-lease`). PR #562
 * shipped exactly that way. This guard moves the failure to commit time,
 * where the fix is re-running one command.
 *
 * Wired as a `commit-msg`-stage hook in `.pre-commit-config.yaml`
 * (installed for every contributor by `npm install` → `prek install`; see
 * `default_install_hook_types` there). prek passes the commit-message file
 * path as the only argument.
 *
 * What counts as signed: a `Signed-off-by: Name <email>` trailer line, the
 * exact shape `git commit -s` writes. Merges are exempt, matching the DCO CI
 * check's own exemption — but that exemption is keyed off actual merge state
 * (`MERGE_HEAD` present, the same signal `dco2` reads), never off the
 * commit message's first line: a hand-written "Merge the two config loaders"
 * subject is not a merge, and a real merge with a custom subject still is.
 *
 * When a `Signed-off-by` trailer is present, its name/email is also compared
 * (case-insensitively) against the commit's author and committer idents —
 * the same `SignOffMismatch` comparison the CI DCO check makes, which accepts
 * a match against either. The author comes from `GIT_AUTHOR_NAME`/`_EMAIL`,
 * which git exports into the hook's environment (so `--author=`, `git am`
 * and `cherry-pick -x` relays keep their original sign-off); the committer
 * from `git var GIT_COMMITTER_IDENT`, which git resolves even when
 * `user.name` is unset. Only if neither ident can be resolved does the check
 * fall back to trailer-presence only.
 *
 * CLI entry: `node scripts/check-dco-signoff.mjs <commit-msg-file>`
 * (exit 0 when signed or exempt). Core logic is exported for unit tests in
 * `scripts/check-dco-signoff.test.mjs`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SIGNOFF_PATTERN = /^Signed-off-by: (.+) <(.+@.+)>[ \t]*$/gim;

/**
 * @param {string} message full commit message, comment lines included
 * @returns {{ name: string; email: string }[]}
 */
function trailers(message) {
  // Assumes the default git comment char `#`; does not read `core.commentChar`
  // — if that's overridden, git's comment block isn't stripped here.
  const effective = message
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n');
  return [...effective.matchAll(SIGNOFF_PATTERN)].map(([, name, email]) => ({ name, email }));
}

/** @typedef {{ name: string; email: string }} Identity */

/**
 * @param {string} message full commit message, comment lines included
 * @param {{ isMerge?: boolean; identities?: Identity[] }} [options]
 *   `identities` — the idents a sign-off may match (author and committer);
 *   empty or absent means presence-only checking.
 * @returns {{ ok: true } | { ok: false, reason: 'missing-signoff' | 'sign-off-mismatch', message: string }}
 */
export function checkMessage(message, options = {}) {
  const { isMerge = false, identities = [] } = options;

  if (isMerge) return { ok: true };

  const found = trailers(message);
  if (found.length === 0) {
    return {
      ok: false,
      reason: 'missing-signoff',
      message:
        'Commit message carries no `Signed-off-by` trailer.\n\n' +
        'CONTRIBUTING.md (Commit Requirements) requires a DCO sign-off on every commit:\n' +
        '  git commit -s ...\n' +
        'To sign the commit you were just writing, re-run the same command with -s added.\n' +
        'The CI DCO check enforces the same rule after push, where fixing it means rewriting history.',
    };
  }

  if (identities.length > 0) {
    const matches = found.some((trailer) =>
      identities.some(
        (id) => trailer.name.toLowerCase() === id.name.toLowerCase() && trailer.email.toLowerCase() === id.email.toLowerCase(),
      ),
    );
    if (!matches) {
      const expected = identities.map((id) => `${id.name} <${id.email}>`).join(' or ');
      return {
        ok: false,
        reason: 'sign-off-mismatch',
        message:
          `Commit message's \`Signed-off-by\` trailer matches neither the author nor the committer ` +
          `(SignOffMismatch): expected ${expected}.\n\n` +
          'The CI DCO check makes the same comparison. If this is your own commit, re-run:\n' +
          '  git commit -s ...\n' +
          "so the trailer is written from your ident. If you are relaying someone else's commit, keep their\n" +
          'trailer and preserve them as the author (`--author=`, `git am`, `cherry-pick -x`) instead.',
      };
    }
  }

  return { ok: true };
}

/**
 * @param {string} gitDir
 * @returns {boolean}
 */
export function detectIsMerge(gitDir) {
  try {
    return fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
  } catch {
    return false;
  }
}

/**
 * @param {string} [cwd]
 * @returns {string | undefined} the `$GIT_DIR` of the repository at `cwd`
 */
export function resolveGitDir(cwd = process.cwd()) {
  try {
    const dir = execFileSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return path.resolve(cwd, dir);
  } catch {
    return undefined;
  }
}

/**
 * Parses `git var` output — `Name <email> <timestamp> <tz>`.
 * @param {string} ident
 * @returns {Identity | undefined}
 */
function parseIdent(ident) {
  const match = /^(.+?) <(.+@.+?)>(?: |$)/.exec(ident.trim());
  return match ? { name: match[1], email: match[2] } : undefined;
}

/**
 * @param {'GIT_AUTHOR_IDENT' | 'GIT_COMMITTER_IDENT'} name
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {Identity | undefined}
 */
function gitVar(name, cwd, env) {
  try {
    return parseIdent(execFileSync('git', ['var', name], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    return undefined;
  }
}

/**
 * The idents a sign-off may match, as CI sees them: the author (from the
 * `GIT_AUTHOR_*` environment git hands every hook, falling back to
 * `git var GIT_AUTHOR_IDENT`) and the committer (`git var GIT_COMMITTER_IDENT`).
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv }} [options]
 * @returns {Identity[]} deduplicated; empty when neither can be resolved
 */
export function resolveIdentities(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  /** @type {Identity[]} */
  const found = [];
  if (env.GIT_AUTHOR_NAME && env.GIT_AUTHOR_EMAIL) {
    found.push({ name: env.GIT_AUTHOR_NAME, email: env.GIT_AUTHOR_EMAIL });
  } else {
    const author = gitVar('GIT_AUTHOR_IDENT', cwd, env);
    if (author) found.push(author);
  }
  const committer = gitVar('GIT_COMMITTER_IDENT', cwd, env);
  if (committer) found.push(committer);
  return found.filter(
    (id, index) => found.findIndex((other) => other.name === id.name && other.email === id.email) === index,
  );
}

/**
 * @param {{
 *   argv?: string[];
 *   log?: (line: string) => void;
 *   logError?: (line: string) => void;
 *   isMerge?: boolean;
 *   identities?: Identity[];
 *   readFile?: (file: string, encoding: string) => string;
 * }} [options]
 * @returns {number} 0 when signed or exempt, 1 otherwise.
 */
export function runCli(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  const readFile = options.readFile ?? fs.readFileSync;

  const messageFile = argv[0];
  if (!messageFile) {
    logError('[check-dco-signoff] FAIL: no commit-message file argument — the hook is miswired, not the commit unsigned.');
    return 1;
  }
  let message;
  try {
    message = readFile(messageFile, 'utf8');
  } catch (error) {
    logError(`[check-dco-signoff] FAIL: cannot read ${messageFile}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const isMerge =
    options.isMerge ??
    (() => {
      const gitDir = resolveGitDir();
      return gitDir ? detectIsMerge(gitDir) : false;
    })();

  const identities = options.identities ?? resolveIdentities();

  const result = checkMessage(message, { isMerge, identities });
  if (!result.ok) {
    logError(`[check-dco-signoff] FAIL: ${result.message}`);
    return 1;
  }
  log('[check-dco-signoff] Signed-off-by trailer present.');
  return 0;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  process.exitCode = runCli();
}
