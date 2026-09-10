// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
//
// Unit tests for the pure-logic helpers inside `run-monorepo-unit-tests.mjs`.
// The runner file is >500 LOC of dense routing logic (arg parsing, path
// inference, workspace discovery, cross-project arg rewriting), so it qualifies
// as a "logic-heavy file" that must carry unit tests. The exported helpers are
// deliberately side-effect-free so we can cover every routing branch here
// without spawning child processes.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  aggregateExitCode,
  assertForwardPathArgsExpanded,
  CliError,
  createBoundedBuffer,
  defaultParallelBufferBytes,
  defaultProjectTimeoutMs,
  defaultWatchProjectName,
  discoverMfeProjects,
  discoverWorkspaceProjects,
  hasGlobMetacharacters,
  inferProjectsFromForwardArgs,
  isPathLikeArg,
  loadProjects,
  normalizePathArg,
  parseArgs,
  printUsage,
  resolveProjects,
  resolveWorkspaceEntry,
  rewriteForwardArgsForProject,
  spawnOptionsFor,
  validateWatchTargets,
} from './run-monorepo-unit-tests.mjs';

/** @typedef {import('./run-monorepo-unit-tests.mjs').Project} Project */

/**
 * Fixture project list with the same shape the runner uses at runtime but
 * decoupled from filesystem discovery so tests stay deterministic.
 *
 * The host here is rooted at `src/` rather than mirroring the real
 * `repo-scripts` project, and stays that way on purpose: `src/` is a prefix of
 * the `demo-mfe` root below, and that nesting is the only thing that exercises
 * longest-prefix precedence in `findBestProjectForPath`. No arrangement of the
 * repo's actual project roots nests, so a "realistic" fixture would leave that
 * branch untested.
 *
 * @type {Project[]}
 */
const projects = [
  { kind: 'host', name: 'host-app', rootPath: 'src' },
  {
    kind: 'workspace',
    name: 'api',
    workspace: '@gears-frontx/api',
    rootPath: 'packages/api',
    hasWatchScript: true,
  },
  {
    kind: 'workspace',
    name: 'framework',
    workspace: '@gears-frontx/framework',
    rootPath: 'packages/framework',
    hasWatchScript: true,
  },
  {
    kind: 'mfe',
    name: 'demo-mfe',
    cwd: '/repo/src/mfe_packages/demo-mfe',
    rootPath: 'src/mfe_packages/demo-mfe',
  },
];

/**
 * Locates a fixture project or fails fast with a clear message. Safer than a
 * bare non-null assertion: a typo in the predicate surfaces as a descriptive
 * test failure instead of quietly handing `undefined` to the function under
 * test.
 *
 * @param {(project: Project) => boolean} predicate
 * @returns {Project}
 */
function mustFindProject(predicate) {
  const found = projects.find(predicate);
  if (!found) {
    throw new Error('Fixture project not found for the given predicate.');
  }
  return found;
}

describe('parseArgs', () => {
  it('returns the default run shape when no arguments are passed', () => {
    expect(parseArgs([])).toEqual({
      mode: 'run',
      project: null,
      parallel: false,
      help: false,
      timeoutMs: null,
      forwardArgs: [],
    });
  });

  it('selects watch mode from both `--watch` and bare `watch`', () => {
    expect(parseArgs(['--watch']).mode).toBe('watch');
    expect(parseArgs(['watch']).mode).toBe('watch');
  });

  it('selects run mode from both `--run` and bare `run`', () => {
    expect(parseArgs(['--run']).mode).toBe('run');
    expect(parseArgs(['run']).mode).toBe('run');
  });

  it('sets parallel from both `--parallel` and bare `parallel`', () => {
    expect(parseArgs(['--parallel']).parallel).toBe(true);
    expect(parseArgs(['parallel']).parallel).toBe(true);
  });

  it('sets help from both short and long flags', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('parses `--project=<name>` inline form', () => {
    expect(parseArgs(['--project=api']).project).toBe('api');
  });

  it('parses the spaced `--project <name>` and `-p <name>` forms', () => {
    expect(parseArgs(['--project', 'api']).project).toBe('api');
    expect(parseArgs(['-p', 'framework']).project).toBe('framework');
  });

  it('forwards everything after `--` verbatim, including later flags', () => {
    const parsed = parseArgs(['--run', '--', '--reporter=verbose', '--watch', 'foo/bar.test.ts']);
    expect(parsed.mode).toBe('run');
    expect(parsed.forwardArgs).toEqual([
      '--reporter=verbose',
      '--watch',
      'foo/bar.test.ts',
    ]);
  });

  it('pushes unknown positional args to forwardArgs without consuming them as flags', () => {
    const parsed = parseArgs(['src/foo.test.ts', '-t', 'my test']);
    expect(parsed.forwardArgs).toEqual(['src/foo.test.ts', '-t', 'my test']);
    expect(parsed.project).toBeNull();
  });

  it('combines --parallel with --project and forwarded vitest args', () => {
    const parsed = parseArgs(['--parallel', '--project=api', '--', '--reporter=verbose']);
    expect(parsed).toEqual({
      mode: 'run',
      project: 'api',
      parallel: true,
      help: false,
      timeoutMs: null,
      forwardArgs: ['--reporter=verbose'],
    });
  });
});

describe('isPathLikeArg', () => {
  it('treats paths with separators as path-like', () => {
    expect(isPathLikeArg('src/app/foo.ts')).toBe(true);
    expect(isPathLikeArg(`src${path.sep}foo.ts`)).toBe(true);
  });

  it('treats bare *.test.* / *.spec.* filenames as path-like', () => {
    expect(isPathLikeArg('foo.test.ts')).toBe(true);
    expect(isPathLikeArg('foo.spec.tsx')).toBe(true);
  });

  it('rejects empty strings, flags, and bare filter words', () => {
    expect(isPathLikeArg('')).toBe(false);
    expect(isPathLikeArg('--reporter=verbose')).toBe(false);
    expect(isPathLikeArg('-t')).toBe(false);
    expect(isPathLikeArg('foo')).toBe(false);
  });
});

describe('normalizePathArg', () => {
  it('returns POSIX-form repo-relative paths unchanged', () => {
    expect(normalizePathArg('packages/api/foo.ts')).toBe('packages/api/foo.ts');
  });

  it('strips `./` prefixes and trailing slashes', () => {
    expect(normalizePathArg('./packages/api/')).toBe('packages/api');
  });

  it('re-roots absolute paths against the provided repoRoot', () => {
    const repoRoot = '/virtual/repo';
    const absolute = path.join(repoRoot, 'packages', 'api', 'foo.test.ts');
    expect(normalizePathArg(absolute, { repoRoot })).toBe('packages/api/foo.test.ts');
  });

  it('returns "." when the absolute path equals repoRoot', () => {
    const repoRoot = '/virtual/repo';
    expect(normalizePathArg(repoRoot, { repoRoot })).toBe('.');
  });
});

describe('inferProjectsFromForwardArgs', () => {
  it('returns an empty array when no path-like args are provided', () => {
    expect(inferProjectsFromForwardArgs([], projects)).toEqual([]);
    expect(
      inferProjectsFromForwardArgs(['--reporter=verbose', '-t', 'foo'], projects),
    ).toEqual([]);
  });

  it('matches a host-app path to the host project', () => {
    const matched = inferProjectsFromForwardArgs(
      ['src/app/effects/bootstrapEffects.test.ts'],
      projects,
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe('host-app');
  });

  it('matches a workspace path to the owning workspace project', () => {
    const matched = inferProjectsFromForwardArgs(
      ['packages/api/src/foo.test.ts'],
      projects,
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe('api');
  });

  it('prefers the most specific project via longest-prefix match', () => {
    // `src/mfe_packages/demo-mfe/...` is a prefix of both `host-app` (rootPath
    // `src`) and `demo-mfe` (rootPath `src/mfe_packages/demo-mfe`); the MFE
    // project MUST win because it's the longer, more specific match.
    const matched = inferProjectsFromForwardArgs(
      ['src/mfe_packages/demo-mfe/src/api/foo.test.ts'],
      projects,
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe('demo-mfe');
  });

  it('deduplicates multiple paths inside the same project', () => {
    const matched = inferProjectsFromForwardArgs(
      ['packages/api/src/a.test.ts', 'packages/api/src/b.test.ts'],
      projects,
    );
    expect(matched.map((project) => project.name)).toEqual(['api']);
  });

  it('returns every distinct project when paths span multiple packages', () => {
    const matched = inferProjectsFromForwardArgs(
      ['packages/api/src/a.test.ts', 'packages/framework/__tests__/b.test.ts'],
      projects,
    );
    expect(matched.map((project) => project.name).sort((a, b) => a.localeCompare(b))).toEqual(['api', 'framework']);
  });

  it('matches the project when the path equals its rootPath exactly', () => {
    const matched = inferProjectsFromForwardArgs(['packages/api'], projects);
    expect(matched.map((project) => project.name)).toEqual(['api']);
  });

  it('ignores paths that do not belong to any project', () => {
    const matched = inferProjectsFromForwardArgs(
      ['scripts/run-monorepo-unit-tests.mjs'],
      projects,
    );
    expect(matched).toEqual([]);
  });

  it('uses the provided repoRoot when resolving absolute paths', () => {
    const repoRoot = '/virtual/repo';
    const absolute = path.join(repoRoot, 'packages', 'framework', 'foo.test.ts');
    const matched = inferProjectsFromForwardArgs([absolute], projects, { repoRoot });
    expect(matched.map((project) => project.name)).toEqual(['framework']);
  });
});

describe('rewriteForwardArgsForProject', () => {
  const host = mustFindProject((project) => project.name === 'host-app');
  const api = mustFindProject((project) => project.name === 'api');
  const demoMfe = mustFindProject((project) => project.name === 'demo-mfe');

  it('leaves args untouched for the host project', () => {
    const args = ['src/app/foo.test.ts', '--reporter=verbose'];
    expect(rewriteForwardArgsForProject(host, args)).toEqual(args);
  });

  it('strips the workspace rootPath prefix from path-like args', () => {
    const rewritten = rewriteForwardArgsForProject(api, [
      'packages/api/src/foo.test.ts',
      '--reporter=verbose',
    ]);
    expect(rewritten).toEqual(['src/foo.test.ts', '--reporter=verbose']);
  });

  it('maps an exact rootPath match to `.` so Vitest resolves the package root', () => {
    expect(rewriteForwardArgsForProject(api, ['packages/api'])).toEqual(['.']);
  });

  it('leaves non-path-like args untouched even for nested projects', () => {
    expect(
      rewriteForwardArgsForProject(api, ['-t', 'my test', '--reporter=verbose']),
    ).toEqual(['-t', 'my test', '--reporter=verbose']);
  });

  it('leaves path-like args that belong to a different project untouched', () => {
    // A foreign path should NOT be mangled into a project-relative path; the
    // runner only dispatches focused runs when inference picked the matching
    // project, so a mismatch here means the caller is forwarding something
    // Vitest will resolve itself.
    expect(
      rewriteForwardArgsForProject(demoMfe, ['packages/api/src/foo.test.ts']),
    ).toEqual(['packages/api/src/foo.test.ts']);
  });

  it('rewrites MFE paths relative to the MFE rootPath', () => {
    const rewritten = rewriteForwardArgsForProject(demoMfe, [
      'src/mfe_packages/demo-mfe/src/api/foo.test.ts',
    ]);
    expect(rewritten).toEqual(['src/api/foo.test.ts']);
  });
});

describe('resolveWorkspaceEntry', () => {
  it('returns a single POSIX path for non-glob entries without touching the filesystem', async () => {
    // Passing a `readdir` that throws proves the function never tries to list
    // the filesystem for exact-path entries — it must short-circuit instead.
    const readdir = async () => {
      throw new Error('readdir should not be called for non-glob entries');
    };
    expect(await resolveWorkspaceEntry('packages/api', { readdir })).toEqual(['packages/api']);
  });

  it('normalizes host path separators to POSIX for non-glob entries', async () => {
    expect(await resolveWorkspaceEntry(`packages${path.sep}api`)).toEqual(['packages/api']);
  });

  it('expands `parent/*` globs by listing directory children', async () => {
    const repoRoot = '/virtual/repo';
    /** @param {string} dirPath */
    const readdir = async (dirPath) => {
      expect(dirPath).toBe(path.join(repoRoot, 'packages'));
      return [
        { name: 'api', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'framework', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'README.md', isDirectory: () => false, isSymbolicLink: () => false },
      ];
    };

    const result = await resolveWorkspaceEntry('packages/*', { repoRoot, readdir });
    expect(result).toEqual(['packages/api', 'packages/framework']);
  });

  it('returns an empty array when the glob parent cannot be read', async () => {
    const readdir = async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    expect(await resolveWorkspaceEntry('missing/*', { readdir })).toEqual([]);
  });

  it('filters out non-directory entries in glob expansion', async () => {
    const readdir = async () => [
      { name: 'api', isDirectory: () => true, isSymbolicLink: () => false },
      { name: '.gitkeep', isDirectory: () => false, isSymbolicLink: () => false },
    ];
    expect(await resolveWorkspaceEntry('packages/*', { readdir })).toEqual(['packages/api']);
  });
});

describe('parseArgs — timeout handling', () => {
  it('defaults to null timeout when --timeout is not passed', () => {
    expect(parseArgs([]).timeoutMs).toBeNull();
  });

  it('parses --timeout=<ms> inline form', () => {
    expect(parseArgs(['--timeout=5000']).timeoutMs).toBe(5000);
  });

  it('parses spaced --timeout <ms> form', () => {
    expect(parseArgs(['--timeout', '5000']).timeoutMs).toBe(5000);
  });

  it('accepts 0 as an explicit disable', () => {
    expect(parseArgs(['--timeout=0']).timeoutMs).toBe(0);
  });

  it('throws CliError on a non-numeric --timeout value', () => {
    expect(() => parseArgs(['--timeout=abc'])).toThrow(CliError);
  });

  it('throws CliError on a negative --timeout value', () => {
    expect(() => parseArgs(['--timeout=-1'])).toThrow(CliError);
  });

  it('throws CliError on a non-integer --timeout value', () => {
    expect(() => parseArgs(['--timeout=1.5'])).toThrow(CliError);
  });

  it('throws CliError when --timeout has no value', () => {
    expect(() => parseArgs(['--timeout'])).toThrow(
      /Missing value for --timeout/,
    );
  });

  it('throws CliError when --timeout is followed by another flag', () => {
    expect(() => parseArgs(['--timeout', '--parallel'])).toThrow(CliError);
  });

  it('exposes a 15-minute default for the runner to apply', () => {
    expect(defaultProjectTimeoutMs).toBe(15 * 60 * 1000);
  });
});

describe('parseArgs — CliError on malformed flags', () => {
  it('throws CliError (not process.exit) when --project has no value', () => {
    // Pre-fix this path called process.exit(1) directly, making the helper
    // unsafe to import from tests. The fix is to throw a typed CliError so
    // callers (including tests) can handle it without tearing down the
    // process.
    expect(() => parseArgs(['--project'])).toThrow(CliError);
  });

  it('throws CliError when --project is followed by another flag', () => {
    expect(() => parseArgs(['--project', '--parallel'])).toThrow(CliError);
  });

  it('throws CliError when -p is followed by another flag', () => {
    expect(() => parseArgs(['-p', '--parallel'])).toThrow(CliError);
  });

  it('throws CliError on --project= with an empty value (rejects silent fan-out)', () => {
    // Pre-fix, `--project=` (empty RHS) slipped through as "no project
    // selected" and silently fanned out across every workspace — the exact
    // opposite of what the caller asked for. It now hard-errors so the
    // mistake is fixed at the source instead of wasting CI minutes.
    expect(() => parseArgs(['--project='])).toThrow(CliError);
    expect(() => parseArgs(['--project='])).toThrow(/Missing value for --project/);
  });
});

describe('resolveProjects', () => {
  const projectNames = projects.map((project) => project.name).join(', ');

  it('returns the full list when no selector is passed', () => {
    expect(resolveProjects(null, projects, projectNames)).toEqual(projects);
  });

  it('returns a single-project array for a known name', () => {
    const result = resolveProjects('api', projects, projectNames);
    expect(result.map((project) => project.name)).toEqual(['api']);
  });

  it('throws CliError for an unknown project', () => {
    expect(() => resolveProjects('missing', projects, projectNames)).toThrow(
      CliError,
    );
  });
});

describe('validateWatchTargets', () => {
  const projectNames = projects.map((project) => project.name).join(', ');
  const hostOnly = projects.filter((project) => project.kind === 'host');

  it('returns undefined (no throw) for a single valid target', () => {
    expect(
      validateWatchTargets(hostOnly, projectNames, false),
    ).toBeUndefined();
  });

  it('rejects --watch --parallel combinations', () => {
    expect(() => validateWatchTargets(hostOnly, projectNames, true)).toThrow(
      /Parallel mode only applies/,
    );
  });

  it('rejects workspaces that lack a test:unit:watch script', () => {
    /** @type {Project[]} */
    const noWatch = [
      {
        kind: 'workspace',
        name: 'state',
        workspace: '@gears-frontx/state',
        rootPath: 'packages/state',
        hasWatchScript: false,
      },
    ];
    expect(() => validateWatchTargets(noWatch, projectNames, false)).toThrow(
      /test:unit:watch/,
    );
  });

  it('rejects multi-target watch runs so one Vitest instance owns stdio', () => {
    expect(() => validateWatchTargets(projects, projectNames, false)).toThrow(
      /single Vitest instance/,
    );
  });
});

describe('aggregateExitCode', () => {
  it('returns 0 when every child succeeded', () => {
    expect(
      aggregateExitCode([
        { name: 'api', code: 0 },
        { name: 'framework', code: 0 },
      ]),
    ).toBe(0);
  });

  it('returns flat 1 when any child failed, regardless of the specific code', () => {
    // Pre-fix this returned the first-seen failing child's exit code (e.g.
    // Vitest's 7 for `--passWithNoTests=false`); we now normalize to 1 so the
    // aggregate contract doesn't depend on iteration order.
    expect(
      aggregateExitCode([
        { name: 'api', code: 0 },
        { name: 'framework', code: 7 },
      ]),
    ).toBe(1);
    expect(
      aggregateExitCode([
        { name: 'api', code: 42 },
        { name: 'framework', code: 0 },
      ]),
    ).toBe(1);
  });

  it('returns 0 for an empty results array', () => {
    expect(aggregateExitCode([])).toBe(0);
  });
});

describe('spawnOptionsFor', () => {
  it('uses the repo root as cwd for host projects', () => {
    const host = mustFindProject((project) => project.kind === 'host');
    const options = spawnOptionsFor(host);
    expect(options.cwd).toBeTypeOf('string');
    expect(options.cwd.length).toBeGreaterThan(0);
    expect(options.stdio).toBe('inherit');
  });

  it('uses the repo root as cwd for workspace projects', () => {
    const workspace = mustFindProject((project) => project.kind === 'workspace');
    expect(spawnOptionsFor(workspace).cwd).toBeTypeOf('string');
  });

  it('uses the MFE cwd for MFE projects (nested install boundary)', () => {
    const mfe = mustFindProject((project) => project.kind === 'mfe');
    expect(spawnOptionsFor(mfe).cwd).toBe('/repo/src/mfe_packages/demo-mfe');
  });

  it('switches to piped stdio when buffered is true (parallel output)', () => {
    const workspace = mustFindProject((project) => project.kind === 'workspace');
    expect(spawnOptionsFor(workspace, { buffered: true }).stdio).toEqual([
      'ignore',
      'pipe',
      'pipe',
    ]);
  });

  it('threads process.env through unchanged so child inherits NODE_ENV etc.', () => {
    const host = mustFindProject((project) => project.kind === 'host');
    expect(spawnOptionsFor(host).env).toBe(process.env);
  });
});

describe('discoverMfeProjects (filesystem-backed)', () => {
  /** @type {string} */
  let fixtureRoot;

  beforeAll(async () => {
    // Build a minimal fixture repo so we can exercise the real filesystem
    // discovery path without coupling tests to the live monorepo's MFE list.
    fixtureRoot = await mkdtemp(path.join(tmpdir(), 'runner-mfe-fixture-'));
    const mfeRoot = path.join(fixtureRoot, 'src', 'mfe_packages');
    await mkdir(path.join(mfeRoot, 'alpha-mfe'), { recursive: true });
    await mkdir(path.join(mfeRoot, 'beta-mfe'), { recursive: true });
    await mkdir(path.join(mfeRoot, 'no-script-mfe'), { recursive: true });
    await mkdir(path.join(mfeRoot, 'no-package-json'), { recursive: true });

    await writeFile(
      path.join(mfeRoot, 'alpha-mfe', 'package.json'),
      JSON.stringify({ name: 'alpha-mfe', scripts: { 'test:unit': 'vitest --run' } }),
    );
    await writeFile(
      path.join(mfeRoot, 'beta-mfe', 'package.json'),
      JSON.stringify({ name: 'beta-mfe', scripts: { 'test:unit': 'vitest --run' } }),
    );
    // `no-script-mfe` has a package.json but no `test:unit` — discovery
    // should skip it because the runner has nothing to delegate to.
    await writeFile(
      path.join(mfeRoot, 'no-script-mfe', 'package.json'),
      JSON.stringify({ name: 'no-script-mfe', scripts: { build: 'vite build' } }),
    );
    // `no-package-json` has no package.json at all — silently ignored.
  });

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('discovers MFEs that declare a test:unit script', async () => {
    const result = await discoverMfeProjects({ repoRoot: fixtureRoot });
    expect(result.map((project) => project.name)).toEqual([
      'alpha-mfe',
      'beta-mfe',
    ]);
  });

  it('sets cwd to the absolute MFE directory for each discovered project', async () => {
    const result = await discoverMfeProjects({ repoRoot: fixtureRoot });
    for (const project of result) {
      expect(project.cwd).toBe(
        path.join(fixtureRoot, 'src', 'mfe_packages', project.name),
      );
    }
  });

  it('returns POSIX-style rootPaths suitable for prefix matching on Windows', async () => {
    const result = await discoverMfeProjects({ repoRoot: fixtureRoot });
    for (const project of result) {
      expect(project.rootPath).toBe(`src/mfe_packages/${project.name}`);
    }
  });

  it('returns results sorted by rootPath so output is deterministic', async () => {
    const result = await discoverMfeProjects({ repoRoot: fixtureRoot });
    const rootPaths = result.map((project) => project.rootPath);
    expect([...rootPaths].sort((a, b) => a.localeCompare(b))).toEqual(rootPaths);
  });

  it('returns an empty array when src/mfe_packages does not exist', async () => {
    const emptyRoot = await mkdtemp(path.join(tmpdir(), 'runner-empty-'));
    try {
      expect(await discoverMfeProjects({ repoRoot: emptyRoot })).toEqual([]);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });

  it('rejects when src/mfe_packages is a file rather than a directory', async () => {
    // The pair to the test above, and the reason discovery cannot simply
    // swallow every read failure: a root that exists but is unreadable as a
    // directory is a broken checkout, and reporting zero projects for it would
    // hand back a clean run over a tree nothing was ever read from.
    const brokenRoot = await mkdtemp(path.join(tmpdir(), 'runner-broken-'));
    try {
      await mkdir(path.join(brokenRoot, 'src'), { recursive: true });
      await writeFile(path.join(brokenRoot, 'src', 'mfe_packages'), 'not a directory');
      await expect(discoverMfeProjects({ repoRoot: brokenRoot })).rejects.toMatchObject({
        code: 'ENOTDIR',
      });
    } finally {
      await rm(brokenRoot, { recursive: true, force: true });
    }
  });
});

describe('discoverWorkspaceProjects + loadProjects (end-to-end discovery)', () => {
  /** @type {string} */
  let fixtureRoot;

  beforeAll(async () => {
    // Build a fixture repo with: one workspace that has test:unit (api), one
    // that doesn't (state), one MFE, and a workspaces glob — exercises the
    // full project-loading pipeline end-to-end without spawning children.
    fixtureRoot = await mkdtemp(path.join(tmpdir(), 'runner-load-fixture-'));

    await writeFile(
      path.join(fixtureRoot, 'package.json'),
      JSON.stringify({
        name: 'fixture-root',
        workspaces: ['packages/*'],
      }),
    );

    await mkdir(path.join(fixtureRoot, 'packages', 'api'), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, 'packages', 'api', 'package.json'),
      JSON.stringify({
        name: '@fixture/api',
        scripts: { 'test:unit': 'vitest --run', 'test:unit:watch': 'vitest --watch' },
      }),
    );

    await mkdir(path.join(fixtureRoot, 'packages', 'state'), { recursive: true });
    // `state` has no test:unit — should be filtered out by discoverWorkspaceProjects.
    await writeFile(
      path.join(fixtureRoot, 'packages', 'state', 'package.json'),
      JSON.stringify({ name: '@fixture/state', scripts: { build: 'tsc' } }),
    );

    await mkdir(path.join(fixtureRoot, 'packages', 'no-manifest'), { recursive: true });
    // No package.json at all → resolveWorkspaceEntry yields the path but the
    // readFile inside discoverWorkspaceProjects throws and the entry is
    // skipped silently.

    await mkdir(path.join(fixtureRoot, 'src', 'mfe_packages', 'demo-mfe'), {
      recursive: true,
    });
    await writeFile(
      path.join(fixtureRoot, 'src', 'mfe_packages', 'demo-mfe', 'package.json'),
      JSON.stringify({
        name: '@fixture/demo-mfe',
        scripts: { 'test:unit': 'vitest --run' },
      }),
    );
  });

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('discoverWorkspaceProjects returns only packages with test:unit', async () => {
    const result = await discoverWorkspaceProjects({ repoRoot: fixtureRoot });
    expect(result.map((project) => project.name)).toEqual(['api']);
  });

  it('discoverWorkspaceProjects captures hasWatchScript so watch validation works', async () => {
    const [api] = await discoverWorkspaceProjects({ repoRoot: fixtureRoot });
    expect(api.hasWatchScript).toBe(true);
    expect(api.workspace).toBe('@fixture/api');
  });

  it('loadProjects composes the static repo-scripts project plus discovered workspaces', async () => {
    // Phase 11 template-move relocated the host app + its nested MFEs to a
    // self-contained template (which runs its own tests via its own
    // package.json; its MFE content later split into a sibling template in
    // issue #470), so `discoverMfeProjects` remains a generic utility (see
    // its own dedicated fixture tests above) that `loadProjects` no longer
    // composes.
    //
    // `repo-scripts` is present for a fixture root that has no `scripts/` at
    // all, and that is the point: it is static, not discovered. `scripts/` is
    // not an npm workspace, so nothing about it can be read out of
    // `package.json#workspaces` — the only source `discoverWorkspaceProjects`
    // has. Removing the previous static entry is what silently unhooked the
    // whole `scripts/` suite from `test:unit` (#483).
    const result = await loadProjects(fixtureRoot);
    expect(result.map((project) => `${project.kind}:${project.name}`)).toEqual([
      'host:repo-scripts',
      'workspace:api',
    ]);
  });
});

describe('CliError', () => {
  it('exposes an exitCode field so the top-level handler can propagate it', () => {
    const err = new CliError('boom', 2);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CliError');
    expect(err.message).toBe('boom');
    expect(err.exitCode).toBe(2);
  });

  it('defaults exitCode to 1 when omitted', () => {
    expect(new CliError('boom').exitCode).toBe(1);
  });
});

describe('hasGlobMetacharacters', () => {
  it('detects star, question-mark, and bracket class wildcards', () => {
    expect(hasGlobMetacharacters('packages/api/**/*.test.ts')).toBe(true);
    expect(hasGlobMetacharacters('packages/api/foo?.test.ts')).toBe(true);
    expect(hasGlobMetacharacters('packages/api/foo[abc].test.ts')).toBe(true);
  });

  it('detects shell brace expansion that slipped through unexpanded', () => {
    // `{a,b}` brace expansion is a shell feature (bash/zsh) that the user
    // expects to expand before the runner ever sees it. When the shell
    // doesn't expand it (zsh `setopt nonomatch`, cmd.exe, quoted arg), the
    // raw pattern reaches the runner and would otherwise silently fall
    // through to the all-projects fan-out.
    expect(hasGlobMetacharacters('packages/api/{foo,bar}.test.ts')).toBe(true);
    expect(hasGlobMetacharacters('packages/{api,framework}/src/foo.test.ts')).toBe(true);
  });

  it('ignores a single `{` character that is not part of brace expansion', () => {
    // Filenames containing a lone `{` are rare but legal; the detector
    // requires at least one `,` inside the braces so it doesn't false-
    // positive on coincidental punctuation.
    expect(hasGlobMetacharacters('packages/api/foo{.test.ts')).toBe(false);
    expect(hasGlobMetacharacters('packages/api/{noop}.test.ts')).toBe(false);
  });

  it('returns false for concrete paths and flags', () => {
    expect(hasGlobMetacharacters('packages/api/foo.test.ts')).toBe(false);
    expect(hasGlobMetacharacters('--reporter=verbose')).toBe(false);
  });
});

describe('assertForwardPathArgsExpanded', () => {
  it('does nothing for concrete paths and non-path flags', () => {
    expect(() =>
      assertForwardPathArgsExpanded([
        'packages/api/src/foo.test.ts',
        '--reporter=verbose',
        '-t',
        'my test',
      ]),
    ).not.toThrow();
  });

  it('throws CliError when a path-like arg still contains shell globs', () => {
    // Pre-fix, an unexpanded glob like `packages/api/**/*.test.ts` slipped
    // past `inferProjectsFromForwardArgs` (no rootPath matched) and quietly
    // triggered the all-projects fan-out. The assertion now fails loudly so
    // the caller fixes the invocation instead of waiting for unrelated
    // packages to run.
    expect(() =>
      assertForwardPathArgsExpanded(['packages/api/**/*.test.ts']),
    ).toThrow(CliError);
    expect(() =>
      assertForwardPathArgsExpanded(['packages/api/**/*.test.ts']),
    ).toThrow(/unexpanded glob/);
  });

  it('ignores glob characters that appear outside path-like args', () => {
    // `-t "pattern*"` is a Vitest test-name filter, not a file path; the
    // assertion must not reject it just because the filter contains `*`.
    expect(() =>
      assertForwardPathArgsExpanded(['-t', 'pattern*', '--reporter=verbose']),
    ).not.toThrow();
  });
});

describe('inferProjectsFromForwardArgs for the repo-scripts project', () => {
  /** @type {Project[]} */
  const projectsWithScripts = [
    { kind: 'host', name: 'repo-scripts', rootPath: 'scripts' },
    {
      kind: 'workspace',
      name: 'api',
      workspace: '@gears-frontx/api',
      rootPath: 'packages/api',
      hasWatchScript: true,
    },
  ];

  it('routes scripts/*.test.* to repo-scripts', () => {
    // While no project owned `scripts/**`, a focused run against one
    // script-level test file fell back to "fan out across every package".
    const matched = inferProjectsFromForwardArgs(
      ['scripts/run-monorepo-unit-tests.test.mjs'],
      projectsWithScripts,
    );
    expect(matched.map((project) => project.name)).toEqual(['repo-scripts']);
  });

  it('still prefers workspace roots for nested workspace paths', () => {
    const matched = inferProjectsFromForwardArgs(
      ['packages/api/src/foo.test.ts'],
      projectsWithScripts,
    );
    expect(matched.map((project) => project.name)).toEqual(['api']);
  });
});

describe('createBoundedBuffer', () => {
  it('concatenates appended chunks in order when under the cap', () => {
    const buffer = createBoundedBuffer(1024);
    buffer.append(Buffer.from('hello '));
    buffer.append(Buffer.from('world'));
    expect(buffer.read()).toBe('hello world');
    expect(buffer.isTruncated).toBe(false);
  });

  it('drops oldest chunks and prepends a truncation banner once the cap is exceeded', () => {
    // Cap to 6 bytes so we can exercise the drop-oldest policy deterministically.
    // Appending three 4-byte chunks forces the first chunk out, yielding the
    // newest 8 bytes (still above cap), which drops the next chunk too until
    // only one chunk remains under the cap-or-above-with-single-chunk rule.
    const buffer = createBoundedBuffer(6);
    buffer.append(Buffer.from('AAAA'));
    buffer.append(Buffer.from('BBBB'));
    buffer.append(Buffer.from('CCCC'));
    const output = buffer.read();
    expect(buffer.isTruncated).toBe(true);
    expect(output).toMatch(/^\[run-monorepo-unit-tests\] output truncated/);
    // The newest chunk MUST be preserved in full so operators still see the
    // failure's final log lines; older content is what gets dropped.
    expect(output.endsWith('CCCC')).toBe(true);
  });

  it('truncates a single oversized chunk by keeping its tail', () => {
    // When one write is already bigger than the entire cap, there's no older
    // chunk to drop — the implementation has to slice the chunk itself so
    // memory stays bounded. Verify the tail is preserved and the banner fires.
    const buffer = createBoundedBuffer(4);
    buffer.append(Buffer.from('0123456789'));
    const output = buffer.read();
    expect(buffer.isTruncated).toBe(true);
    // Only the last 4 bytes of the oversized write should remain.
    expect(output.endsWith('6789')).toBe(true);
  });

  it('exposes an 8 MiB default that spawnProject will apply in parallel mode', () => {
    expect(defaultParallelBufferBytes).toBe(8 * 1024 * 1024);
  });
});

describe('printUsage', () => {
  /** @type {import('vitest').MockInstance<typeof console.log>} */
  let logSpy;

  afterEach(() => {
    logSpy?.mockRestore();
  });

  it('prints a single line-broken block covering every documented flag', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printUsage('host-app, api');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [rendered] = logSpy.mock.calls[0];
    for (const flag of ['--run', '--watch', '--project=<name>', '--parallel', '--timeout=<ms>', '-h, --help']) {
      expect(rendered).toContain(flag);
    }
  });

  it('interpolates the project list into the --project help text', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printUsage('host-app, api, framework');

    const [rendered] = logSpy.mock.calls[0];
    expect(rendered).toContain('Available: host-app, api, framework');
  });

  it('advertises the current defaultWatchProjectName so both docs stay in sync', () => {
    // If `defaultWatchProjectName` changes, the usage text must change
    // alongside it. Asserting against the live constant catches drift
    // between the help output and the actual runtime default.
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printUsage('host-app');

    const [rendered] = logSpy.mock.calls[0];
    expect(rendered).toContain(`Defaults to --project=${defaultWatchProjectName}`);
    expect(rendered).toContain(`defaults to ${defaultWatchProjectName}`);
  });

  it('advertises the current defaultProjectTimeoutMs so usage reflects runtime', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printUsage('host-app');

    const [rendered] = logSpy.mock.calls[0];
    expect(rendered).toContain(`default ${defaultProjectTimeoutMs}`);
  });

  it('documents path-based inference and the unexpanded-glob guard rail', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printUsage('host-app');

    const [rendered] = logSpy.mock.calls[0];
    expect(rendered).toContain('Path-based project inference');
    // Help text wraps the word across lines (`unexpanded\n  globs`), so
    // normalize whitespace before searching — asserting on the semantic
    // phrase is more robust than pinning exact indentation.
    expect(rendered.replaceAll(/\s+/g, ' ')).toContain('unexpanded globs');
  });
});

describe('discoverWorkspaceProjects — project-name collision handling', () => {
  /** @type {string} */
  let fixtureRoot;

  beforeAll(async () => {
    // Stand up two workspaces whose directory basenames collide (`api`),
    // under different parent dirs (`packages/api` and `internal/api`). The
    // old `path.basename(workspacePath)` strategy would assign both the
    // same `--project=<name>` and make one of them unreachable; the fix
    // falls back to the unscoped package name, then to the full rootPath.
    fixtureRoot = await mkdtemp(path.join(tmpdir(), 'runner-collision-'));

    await writeFile(
      path.join(fixtureRoot, 'package.json'),
      JSON.stringify({
        name: 'fixture-root',
        workspaces: ['packages/api', 'internal/api'],
      }),
    );

    await mkdir(path.join(fixtureRoot, 'packages', 'api'), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, 'packages', 'api', 'package.json'),
      JSON.stringify({
        name: '@fixture/api',
        scripts: { 'test:unit': 'vitest --run' },
      }),
    );

    await mkdir(path.join(fixtureRoot, 'internal', 'api'), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, 'internal', 'api', 'package.json'),
      JSON.stringify({
        name: '@internal/api',
        scripts: { 'test:unit': 'vitest --run' },
      }),
    );
  });

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('assigns unique project names when directory basenames collide', async () => {
    const result = await discoverWorkspaceProjects({ repoRoot: fixtureRoot });
    const names = result.map((project) => project.name);
    expect(new Set(names).size).toBe(result.length);
    // The first-seen workspace keeps the short basename; the second falls
    // back to its unscoped package name so it's still addressable via
    // `--project=<name>` without typing the full repo-relative path.
    expect(names).toContain('api');
  });
});

describe('discoverWorkspaceProjects — unreadable manifest warning', () => {
  /** @type {string} */
  let fixtureRoot;
  /** @type {import('vitest').MockInstance<typeof console.warn>} */
  let warnSpy;

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), 'runner-unreadable-'));
    await writeFile(
      path.join(fixtureRoot, 'package.json'),
      JSON.stringify({
        name: 'fixture-root',
        workspaces: ['packages/*'],
      }),
    );
    await mkdir(path.join(fixtureRoot, 'packages', 'broken'), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, 'packages', 'broken', 'package.json'),
      '{ not valid JSON',
    );
  });

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it('warns when a workspace manifest exists but cannot be parsed', async () => {
    // Pre-fix, a malformed package.json was silently skipped and the
    // workspace simply "disappeared" from `--project=<name>` without any
    // signal to the operator. Emitting a warning makes the misconfig
    // visible while keeping the scan resilient.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await discoverWorkspaceProjects({ repoRoot: fixtureRoot });
    const warningText = warnSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(warningText).toContain('packages/broken');
  });
});
