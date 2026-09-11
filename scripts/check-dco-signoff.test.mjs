// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMessage, detectIsMerge, resolveGitDir, resolveIdentities, runCli } from './check-dco-signoff.mjs';

/** @type {string | undefined} */
let workDir;

afterEach(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

/** @param {string} content */
async function writeMessageFile(content) {
  workDir = await mkdtemp(path.join(tmpdir(), 'frontx-dco-'));
  const file = path.join(workDir, 'COMMIT_EDITMSG');
  await writeFile(file, content);
  return file;
}

/** Runs the guard with stdout/stderr captured separately, so a case can assert which stream it used. */
/**
 * @param {string[]} argv
 * @param {Partial<Parameters<typeof runCli>[0]>} [overrides]
 */
function run(argv, overrides = {}) {
  /** @type {string[]} */
  const stdout = [];
  /** @type {string[]} */
  const stderr = [];
  // isMerge/identity default to values that don't depend on the real git
  // state of whatever checkout runs this suite.
  const exitCode = runCli({
    argv,
    log: (/** @type {string} */ line) => stdout.push(line),
    logError: (/** @type {string} */ line) => stderr.push(line),
    isMerge: false,
    identities: [],
    ...overrides,
  });
  return { exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

describe('checkMessage', () => {
  it('accepts the exact trailer shape `git commit -s` writes', () => {
    expect(checkMessage('fix: thing\n\nSigned-off-by: A B <a@b.c>\n').ok).toBe(true);
  });

  it('accepts a mixed-case `signed-off-by` keyword with trailing whitespace, matching CI', () => {
    const message = 'fix: thing\n\nsigned-off-by: A B <a@b.c>  \n';
    expect(checkMessage(message).ok).toBe(true);
  });

  it('accepts a sign-off followed by other trailers', () => {
    const message = 'fix: thing\n\nSigned-off-by: A B <a@b.c>\nCo-Authored-By: Claude <noreply@anthropic.com>\n';
    expect(checkMessage(message).ok).toBe(true);
  });

  it('rejects a message with no trailer, naming the fix', () => {
    const result = checkMessage('fix: thing\n');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('missing-signoff');
    expect(result.message).toContain('git commit -s');
  });

  it('rejects a malformed trailer (no email)', () => {
    expect(checkMessage('fix: thing\n\nSigned-off-by: just a name\n').ok).toBe(false);
  });

  it('does not count a Signed-off-by quoted inside git comment lines', () => {
    const message = 'fix: thing\n\n# Please enter the commit message\n#\tSigned-off-by: Ghost <g@h.i>\n';
    expect(checkMessage(message).ok).toBe(false);
  });

  it('exempts an actual merge (isMerge: true) even with a non-"Merge" subject', () => {
    const result = checkMessage('Fold the two config loaders into one\n', { isMerge: true });
    expect(result.ok).toBe(true);
  });

  it('does not exempt a "Merge ..." subject when isMerge is false — merge state, not message text, decides', () => {
    const result = checkMessage("Merge branch 'develop' into feature\n", { isMerge: false });
    expect(result.ok).toBe(false);
  });

  it('does not exempt a "Merge ..." subject when isMerge is omitted (defaults to false)', () => {
    const result = checkMessage("Merge branch 'develop' into feature\n");
    expect(result.ok).toBe(false);
  });

  it('passes when the trailer matches the configured committer identity', () => {
    const message = 'fix: thing\n\nSigned-off-by: A B <a@b.c>\n';
    const result = checkMessage(message, { identities: [{ name: 'A B', email: 'a@b.c' }] });
    expect(result.ok).toBe(true);
  });

  it('matches the configured identity case-insensitively', () => {
    const message = 'fix: thing\n\nSigned-off-by: A B <A@B.C>\n';
    const result = checkMessage(message, { identities: [{ name: 'a b', email: 'a@b.c' }] });
    expect(result.ok).toBe(true);
  });

  it('fails with a sign-off-mismatch reason when the trailer names a different person and identity is configured', () => {
    const message = 'fix: thing\n\nSigned-off-by: Someone Else <someone@else.com>\n';
    const result = checkMessage(message, { identities: [{ name: 'A B', email: 'a@b.c' }] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('sign-off-mismatch');
    expect(result.message).toContain('SignOffMismatch');
  });

  it('accepts a trailer matching the author when the committer differs — the relayed-commit case CI accepts', () => {
    const message = 'fix: thing\n\nSigned-off-by: Bob <bob@example.com>\n';
    const identities = [
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Alice', email: 'alice@example.com' },
    ];
    expect(checkMessage(message, { identities }).ok).toBe(true);
  });

  it('accepts a trailer matching the committer when the author differs', () => {
    const message = 'fix: thing\n\nSigned-off-by: Alice <alice@example.com>\n';
    const identities = [
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Alice', email: 'alice@example.com' },
    ];
    expect(checkMessage(message, { identities }).ok).toBe(true);
  });

  it('names both idents in the mismatch message and does not tell a relayer to re-sign as themselves', () => {
    const message = 'fix: thing\n\nSigned-off-by: Someone Else <someone@else.com>\n';
    const identities = [
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Alice', email: 'alice@example.com' },
    ];
    const result = checkMessage(message, { identities });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('Bob <bob@example.com> or Alice <alice@example.com>');
    expect(result.message).toContain('relaying');
  });

  it('falls back to presence-only checking when no ident could be resolved', () => {
    const message = 'fix: thing\n\nSigned-off-by: Anybody At All <anybody@example.com>\n';
    expect(checkMessage(message, { identities: [] }).ok).toBe(true);
  });
});

describe('runCli', () => {
  it('passes a signed commit-message file', async () => {
    const file = await writeMessageFile('fix: x\n\nSigned-off-by: A B <a@b.c>\n');
    const { exitCode, stdout } = run([file]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('trailer present');
  });

  it('fails an unsigned commit-message file with the CONTRIBUTING.md pointer, printed to stderr', async () => {
    const file = await writeMessageFile('fix: x\n');
    const { exitCode, stdout, stderr } = run([file]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('CONTRIBUTING.md');
    expect(stdout).toBe('');
  });

  it('fails closed when miswired (no argument) with a message that says so', () => {
    const { exitCode, stderr } = run([]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('miswired');
  });

  it('fails closed on an unreadable file', () => {
    const { exitCode, stderr } = run(['/nonexistent/COMMIT_EDITMSG']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('cannot read');
  });

  it('fails closed on an unreadable file via an injected readFile, matching the file\'s DI conventions', () => {
    const readFile = () => {
      throw new Error('EACCES: permission denied');
    };
    const { exitCode, stderr } = run(['COMMIT_EDITMSG'], { readFile });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('cannot read');
    expect(stderr).toContain('permission denied');
  });

  it('exempts a non-"Merge"-prefixed subject when isMerge is injected true', async () => {
    const file = await writeMessageFile('Fold the two config loaders into one\n');
    const { exitCode } = run([file], { isMerge: true });
    expect(exitCode).toBe(0);
  });

  it('rejects a "Merge ..." subject with no trailer when isMerge is false — the message-text regression case', async () => {
    const file = await writeMessageFile("Merge branch 'develop' into feature\n");
    const { exitCode, stderr } = run([file], { isMerge: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Signed-off-by');
  });

  it('fails with a SignOffMismatch reason when the injected identity does not match the trailer', async () => {
    const file = await writeMessageFile('fix: x\n\nSigned-off-by: A B <a@b.c>\n');
    const { exitCode, stderr } = run([file], { identities: [{ name: 'C D', email: 'c@d.e' }] });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('SignOffMismatch');
  });
});

describe('git-backed helpers (temp repository)', () => {
  /** @type {string} */
  let repo;
  /** @type {NodeJS.ProcessEnv} */
  let env;

  /** @param {string[]} args */
  const git = (args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), 'frontx-dco-repo-'));
    // Pin the committer through the environment so the case is independent
    // of whatever identity the machine running the suite has configured, and
    // so no GIT_AUTHOR_* leaks in from an enclosing hook or rebase.
    env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    Object.assign(env, {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_COMMITTER_NAME: 'Alice',
      GIT_COMMITTER_EMAIL: 'alice@example.com',
    });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.name', 'Alice']);
    git(['config', 'user.email', 'alice@example.com']);
    await writeFile(path.join(repo, 'a.txt'), 'a\n');
    git(['add', 'a.txt']);
    git(['commit', '-q', '-m', 'base']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('resolveGitDir finds .git from a subdirectory', async () => {
    const sub = path.join(repo, 'nested');
    await import('node:fs/promises').then((fsp) => fsp.mkdir(sub));
    expect(resolveGitDir(sub)).toBe(path.join(repo, '.git'));
  });

  it('resolveGitDir returns undefined outside a repository', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'frontx-dco-norepo-'));
    try {
      expect(resolveGitDir(outside)).toBeUndefined();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('detectIsMerge is false normally and true while MERGE_HEAD exists', async () => {
    const gitDir = /** @type {string} */ (resolveGitDir(repo));
    expect(detectIsMerge(gitDir)).toBe(false);

    git(['checkout', '-q', '-b', 'topic']);
    await writeFile(path.join(repo, 'b.txt'), 'b\n');
    git(['add', 'b.txt']);
    git(['commit', '-q', '-m', 'topic']);
    git(['checkout', '-q', 'main']);
    await writeFile(path.join(repo, 'c.txt'), 'c\n');
    git(['add', 'c.txt']);
    git(['commit', '-q', '-m', 'main']);
    git(['merge', '--no-commit', '--no-ff', 'topic']);

    expect(detectIsMerge(gitDir)).toBe(true);
  });

  it('resolveIdentities yields the committer from git var when no author is exported', () => {
    expect(resolveIdentities({ cwd: repo, env })).toEqual([{ name: 'Alice', email: 'alice@example.com' }]);
  });

  it('resolveIdentities adds the author from GIT_AUTHOR_* ahead of the committer', () => {
    const hookEnv = { ...env, GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com' };
    expect(resolveIdentities({ cwd: repo, env: hookEnv })).toEqual([
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Alice', email: 'alice@example.com' },
    ]);
  });

  it('resolveIdentities still resolves the committer when user.name is unset', () => {
    git(['config', '--unset', 'user.name']);
    git(['config', '--unset', 'user.email']);
    // git var falls back to GIT_COMMITTER_* from the environment.
    expect(resolveIdentities({ cwd: repo, env })).toEqual([{ name: 'Alice', email: 'alice@example.com' }]);
  });
});
