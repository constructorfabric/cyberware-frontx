/**
 * Tests for the rule that keeps a template's own example and scaffold MFE
 * packages out of the running application (constructorfabric/gears-frontx#550).
 *
 * Three scanners decide it and all are exercised here against a fixture tree
 * rather than against a restatement of their rules: `getMFEPackages`, which
 * feeds `dev-all.ts` and `build-mfes.ts`; `ManifestGenerator`, which writes the
 * aggregate the host registers from; and `discoverMfeProjects`, which picks the
 * packages `type-check:mfe` spawns a child for. Testing only the predicates
 * would have left any of them free to stop calling them with every case still
 * green.
 *
 * All three take their directory as an argument for that reason. The
 * module-level defaults resolve against the working directory at import time,
 * which a test cannot move afterwards.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TEMPLATE_EXAMPLES_ENV_VAR,
  getMFEPackages,
  isTemplateExamplePackage,
  templateExamplesIncluded,
} from '../scripts/lib/mfe-tools';
import { ManifestGenerator } from '../scripts/generate-mfe-manifests';
import {
  discoverMfeProjects,
  discoverTypeCheckProjects,
  refuseMissingTypeCheckScript,
  runParallel,
  runSequential,
} from '../scripts/run-mfe-type-checks';

const MFE_MANIFEST_PATH = 'dist/mfe-manifest.json';

// The type portions every fixture id is chained onto. `ManifestGenerator` refuses
// a manifest whose ids are not parseable GTS ids, so a fixture cannot name them
// after the package alone - and these positions are contracts rather than sample
// data: a manifest, an entry and a screen extension are instances of exactly
// these types.
const MANIFEST_TYPE = 'gts.frontx.mfes.mfe.mf_manifest.v1';
const ENTRY_TYPE = 'gts.frontx.mfes.mfe.entry.v1~frontx.mfes.mfe.entry_mf.v1';
const EXTENSION_TYPE = 'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1';
const SCREEN_DOMAIN = 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1';

/**
 * The package name as a GTS dot-token: the grammar admits neither the hyphen in
 * `tasks-mfe` nor the leading dot in `.cache`, and every fixture id is built
 * from the directory name so a case can read which package an id belongs to.
 */
function nameToken(name: string): string {
  return name.replace(/[^a-z0-9]/g, '_');
}

/** The manifest id `mfePackage` writes for `name`, and what the aggregate carries back. */
function manifestIdFor(name: string): string {
  return `${MANIFEST_TYPE}~fixture.${nameToken(name)}.mfe.manifest.v1`;
}

let workspace: string;
let mfePackagesDir: string;

/**
 * Writes a package directory holding `body` as its `mfe.json` and returns the
 * package path. The body is a raw string rather than an object so a case can
 * write a manifest that is not valid JSON.
 */
function packageWithMfeJson(name: string, body: string): string {
  const packagePath = join(mfePackagesDir, name);
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(join(packagePath, 'mfe.json'), body, 'utf-8');
  return packagePath;
}

/**
 * Writes a package complete enough for all three scanners: an `mfe.json`
 * carrying the flag or not, a `package.json` whose `preview` script declares the
 * port `getMFEPackages` reads and whose `type-check` script is what
 * `discoverMfeProjects` requires, and the enriched build output
 * `ManifestGenerator` aggregates. Every instance value is neutral fixture data;
 * only the type portions of the ids are the real ones, because the id gate parses
 * them.
 */
function mfePackage(name: string, options: { templateExample: boolean; port: number }): void {
  const flag = options.templateExample ? '"templateExample": true, ' : '';
  const packagePath = packageWithMfeJson(name, `{ ${flag}"entries": [], "extensions": [] }`);

  writeFileSync(
    join(packagePath, 'package.json'),
    JSON.stringify({
      name,
      scripts: {
        preview: `vite preview --port ${options.port}`,
        'type-check': 'tsc --noEmit',
      },
    }),
    'utf-8',
  );

  mkdirSync(join(packagePath, 'dist'), { recursive: true });
  writeFileSync(
    join(packagePath, MFE_MANIFEST_PATH),
    JSON.stringify({
      manifest: {
        id: manifestIdFor(name),
        name,
        remoteEntry: `http://localhost:${options.port}/assets/remoteEntry.js`,
        metaData: {
          name,
          type: 'app',
          buildInfo: { buildVersion: '0', buildName: name },
          remoteEntry: { name: 'remoteEntry.js', path: 'assets', type: 'module' },
          globalName: name,
          publicPath: `http://localhost:${options.port}/`,
        },
        shared: [],
      },
      entries: [],
      extensions: [
        {
          id: `${EXTENSION_TYPE}~fixture.${nameToken(name)}.screens.home.v1`,
          domain: SCREEN_DOMAIN,
          entry: `${ENTRY_TYPE}~fixture.${nameToken(name)}.mfe.home.v1`,
        },
      ],
    }),
    'utf-8',
  );
}

/** Manifest ids in the aggregate `ManifestGenerator` just wrote. */
function generatedManifestIds(): string[] {
  const outputFile = join(workspace, 'public', 'generated-mfe-manifests.json');
  new ManifestGenerator(mfePackagesDir, outputFile, MFE_MANIFEST_PATH, null).run();

  const configs: unknown = JSON.parse(readFileSync(outputFile, 'utf-8'));
  if (!Array.isArray(configs)) return [];
  return configs.map((config) =>
    typeof config === 'object' && config !== null && 'manifest' in config
      ? String((config.manifest as { id: unknown }).id)
      : '',
  );
}

// The opt-in is read from the real environment, so a value already set where
// this suite runs would put the default-exclusion cases in the wrong mode. It is
// captured once, cleared per case, and put back afterwards, so the suite neither
// inherits a caller's setting nor destroys it.
let originalIncludeExamples: string | undefined;

beforeEach(() => {
  originalIncludeExamples = process.env[TEMPLATE_EXAMPLES_ENV_VAR];
  delete process.env[TEMPLATE_EXAMPLES_ENV_VAR];

  workspace = mkdtempSync(join(tmpdir(), 'frontx-mfe-packages-'));
  mfePackagesDir = join(workspace, 'src-app', 'mfe_packages');
  mkdirSync(mfePackagesDir, { recursive: true });
  mkdirSync(join(workspace, 'public'), { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });

  if (originalIncludeExamples === undefined) {
    delete process.env[TEMPLATE_EXAMPLES_ENV_VAR];
  } else {
    process.env[TEMPLATE_EXAMPLES_ENV_VAR] = originalIncludeExamples;
  }
});

describe('isTemplateExamplePackage', () => {
  it('reports a package as example content when its mfe.json declares templateExample', () => {
    const packagePath = packageWithMfeJson('example-mfe', '{ "templateExample": true }');

    expect(isTemplateExamplePackage(packagePath)).toBe(true);
  });

  it('reports a package as product content when its mfe.json declares no flag', () => {
    const packagePath = packageWithMfeJson('product-mfe', '{ "extensions": [] }');

    expect(isTemplateExamplePackage(packagePath)).toBe(false);
  });

  // An unparseable manifest is the build's failure to report, through the
  // frontxMfGts plugin's own parse. Answering "example" here would drop the
  // package before it ever reached that build.
  it('keeps a package with an unparseable mfe.json in discovery', () => {
    const packagePath = packageWithMfeJson('broken-mfe', '{ not json');

    expect(isTemplateExamplePackage(packagePath)).toBe(false);
  });
});

describe('templateExamplesIncluded', () => {
  it('includes example packages when the variable is exactly 1', () => {
    expect(templateExamplesIncluded({ [TEMPLATE_EXAMPLES_ENV_VAR]: '1' })).toBe(true);
  });

  it('excludes example packages when the variable is unset', () => {
    expect(templateExamplesIncluded({})).toBe(false);
  });

  // One spelling, so a surface documenting `=true` would be documenting an
  // opt-in that does not happen.
  it('excludes example packages for a truthy spelling that is not 1', () => {
    expect(templateExamplesIncluded({ [TEMPLATE_EXAMPLES_ENV_VAR]: 'true' })).toBe(false);
  });

  it('excludes example packages for an unrelated value', () => {
    expect(templateExamplesIncluded({ [TEMPLATE_EXAMPLES_ENV_VAR]: '0' })).toBe(false);
  });
});

describe('getMFEPackages - what dev:all builds and serves', () => {
  it('leaves an example package out of the served set and names it as skipped', () => {
    mfePackage('tasks-mfe', { templateExample: false, port: 3010 });
    mfePackage('sample-mfe', { templateExample: true, port: 3020 });

    const discovery = getMFEPackages(mfePackagesDir);

    expect(discovery).toEqual({
      packages: [{ name: 'tasks-mfe', port: 3010 }],
      skippedExamples: ['sample-mfe'],
    });
  });

  it('serves the example package too when the environment includes template examples', () => {
    mfePackage('tasks-mfe', { templateExample: false, port: 3010 });
    mfePackage('sample-mfe', { templateExample: true, port: 3020 });
    process.env[TEMPLATE_EXAMPLES_ENV_VAR] = '1';

    const discovery = getMFEPackages(mfePackagesDir);

    expect(discovery).toEqual({
      packages: [
        { name: 'sample-mfe', port: 3020 },
        { name: 'tasks-mfe', port: 3010 },
      ],
      skippedExamples: [],
    });
  });
});

describe('discoverTypeCheckProjects - MFE and verification roots together', () => {
  // A verification package (what template-design-guardrails lands under
  // src-app/verify_packages/) is a workspace with its own `type-check` script
  // and no mfe.json. Scanning only the MFE root left it unchecked in CI, so the
  // aggregate has to report it alongside the MFEs, in root order.
  it('reports verification packages after the MFE packages', async () => {
    mfePackage('tasks-mfe', { templateExample: false, port: 3010 });
    const verifyDir = join(workspace, 'verify_packages');
    const designVerify = join(verifyDir, 'design-verify');
    mkdirSync(designVerify, { recursive: true });
    writeFileSync(
      join(designVerify, 'package.json'),
      JSON.stringify({ name: '@fixture/design-verify', scripts: { 'type-check': 'tsc --noEmit' } }),
      'utf-8',
    );

    const discovery = await discoverTypeCheckProjects([mfePackagesDir, verifyDir]);

    expect(discovery).toEqual({
      projects: [
        { name: 'tasks-mfe', cwd: join(mfePackagesDir, 'tasks-mfe') },
        { name: 'design-verify', cwd: designVerify },
      ],
      missingTypeCheckScript: [],
      skippedExamples: [],
    });
  });

  it('refuses the run for a verification package without a type-check script', async () => {
    const verifyDir = join(workspace, 'verify_packages');
    const silent = join(verifyDir, 'silent-verify');
    mkdirSync(silent, { recursive: true });
    writeFileSync(join(silent, 'package.json'), JSON.stringify({ name: 'silent' }), 'utf-8');

    const { missingTypeCheckScript } = await discoverTypeCheckProjects([mfePackagesDir, verifyDir]);

    expect(missingTypeCheckScript).toEqual(['silent-verify']);
    expect(() => refuseMissingTypeCheckScript(missingTypeCheckScript)).toThrow(/silent-verify/);
  });

  // A shell-only seed has neither root; both read as empty, not as a failure.
  it('reports an empty set when no root exists', async () => {
    const discovery = await discoverTypeCheckProjects([
      join(workspace, 'nowhere'),
      join(workspace, 'nowhere-else'),
    ]);

    expect(discovery).toEqual({ projects: [], missingTypeCheckScript: [], skippedExamples: [] });
  });
});

describe('discoverMfeProjects - what type-check:mfe spawns a child for', () => {
  it('leaves an example package out of the checked set and names it as skipped', async () => {
    mfePackage('tasks-mfe', { templateExample: false, port: 3010 });
    mfePackage('sample-mfe', { templateExample: true, port: 3020 });

    const discovery = await discoverMfeProjects(mfePackagesDir);

    expect(discovery).toEqual({
      projects: [{ name: 'tasks-mfe', cwd: join(mfePackagesDir, 'tasks-mfe') }],
      missingTypeCheckScript: [],
      skippedExamples: ['sample-mfe'],
    });
  });

  it('checks the example package too when the environment includes template examples', async () => {
    mfePackage('tasks-mfe', { templateExample: false, port: 3010 });
    mfePackage('sample-mfe', { templateExample: true, port: 3020 });
    process.env[TEMPLATE_EXAMPLES_ENV_VAR] = '1';

    const { projects, skippedExamples } = await discoverMfeProjects(mfePackagesDir);

    expect(projects.map((project) => project.name)).toEqual(['sample-mfe', 'tasks-mfe']);
    expect(skippedExamples).toEqual([]);
  });

  // A missing `type-check` script fails the whole run, product packages
  // included. The example filter runs ahead of that check for exactly this
  // case: a scaffold nothing intends to check must not be able to refuse the
  // run over a script it was never required to declare.
  it('reports no missing type-check script for an example package it skipped', async () => {
    mfePackage('tasks-mfe', { templateExample: false, port: 3010 });
    const scaffold = packageWithMfeJson('_blank-mfe', '{ "templateExample": true }');
    writeFileSync(
      join(scaffold, 'package.json'),
      JSON.stringify({ name: '_blank-mfe' }),
      'utf-8',
    );

    const { missingTypeCheckScript, skippedExamples } = await discoverMfeProjects(mfePackagesDir);

    expect(missingTypeCheckScript).toEqual([]);
    expect(skippedExamples).toEqual(['_blank-mfe']);
  });

  // `shared` declares no `type-check` script, which the scan refuses a run over
  // for a real package, so the non-package rule has to exclude it first.
  it('leaves the shared library and dot-directories out without reporting them', async () => {
    mfePackage('tasks-mfe', { templateExample: false, port: 3010 });

    // `shared` is a real workspace package, so it carries a `package.json`; what
    // it does not carry is a `type-check` script. That is the shape that reaches
    // the hard failure. A bare directory would not: it falls out at the manifest
    // read regardless, and so pins nothing.
    const shared = join(mfePackagesDir, 'shared');
    mkdirSync(shared, { recursive: true });
    writeFileSync(
      join(shared, 'package.json'),
      JSON.stringify({ name: '@fixture/shared' }),
      'utf-8',
    );

    const dotDir = join(mfePackagesDir, '.cache');
    mkdirSync(dotDir, { recursive: true });
    writeFileSync(join(dotDir, 'package.json'), JSON.stringify({ name: 'cache' }), 'utf-8');

    const discovery = await discoverMfeProjects(mfePackagesDir);

    expect(discovery).toEqual({
      projects: [{ name: 'tasks-mfe', cwd: join(mfePackagesDir, 'tasks-mfe') }],
      missingTypeCheckScript: [],
      skippedExamples: [],
    });
  });

  // A shell-only seed has no packages directory at all, which is a legitimate
  // empty rather than a failure.
  it('reports an empty set when the packages directory does not exist', async () => {
    const discovery = await discoverMfeProjects(join(workspace, 'nowhere'));

    expect(discovery).toEqual({
      projects: [],
      missingTypeCheckScript: [],
      skippedExamples: [],
    });
  });

  // The counterpart to the case above, and the reason the two are told apart: a
  // read that fails for any other reason must not read as "nothing to check",
  // which would let type-check:mfe pass having checked nothing.
  it('propagates a read failure that is not an absent directory', async () => {
    const notADirectory = join(workspace, 'packages-file');
    writeFileSync(notADirectory, 'not a directory', 'utf-8');

    await expect(discoverMfeProjects(notADirectory)).rejects.toThrow();
  });
});

describe('ManifestGenerator - what the host registers from', () => {
  it('writes an aggregate without the example package, so its screen cannot reach the menu', () => {
    mfePackage('tasks-mfe', { templateExample: false, port: 3010 });
    mfePackage('sample-mfe', { templateExample: true, port: 3020 });

    expect(generatedManifestIds()).toEqual([manifestIdFor('tasks-mfe')]);
  });

  it('writes an aggregate holding the example package when the environment includes examples', () => {
    mfePackage('tasks-mfe', { templateExample: false, port: 3010 });
    mfePackage('sample-mfe', { templateExample: true, port: 3020 });
    process.env[TEMPLATE_EXAMPLES_ENV_VAR] = '1';

    expect(generatedManifestIds()).toEqual([
      manifestIdFor('sample-mfe'),
      manifestIdFor('tasks-mfe'),
    ]);
  });
});

/**
 * The three scanners against one tree, so a rule that stops holding in one of
 * them fails here rather than showing up as a project whose menu, build and
 * type-check disagree about which directories are packages.
 *
 * `shared` and `.cache` carry the full shape of a package - `mfe.json`,
 * `package.json` with both scripts, built manifest - so the only thing that can
 * exclude them is the rule about their names. A fixture missing any of that
 * would fall out for an unrelated reason and pin nothing.
 */
describe('the non-package rule, across all three scanners', () => {
  beforeEach(() => {
    mfePackage('tasks-mfe', { templateExample: false, port: 3010 });
    mfePackage('shared', { templateExample: false, port: 3030 });
    mfePackage('.cache', { templateExample: false, port: 3040 });
  });

  it('keeps them out of what dev:all builds and serves', () => {
    const { packages, skippedExamples } = getMFEPackages(mfePackagesDir);

    expect(packages.map((mfe) => mfe.name)).toEqual(['tasks-mfe']);
    expect(skippedExamples).toEqual([]);
  });

  it('keeps them out of what type-check:mfe spawns a child for', async () => {
    const { projects, missingTypeCheckScript, skippedExamples } =
      await discoverMfeProjects(mfePackagesDir);

    expect(projects.map((project) => project.name)).toEqual(['tasks-mfe']);
    expect(missingTypeCheckScript).toEqual([]);
    expect(skippedExamples).toEqual([]);
  });

  it('keeps them out of the aggregate the host registers from', () => {
    expect(generatedManifestIds()).toEqual([manifestIdFor('tasks-mfe')]);
  });
});

/**
 * The orchestrators against a stand-in for the child process, which is what
 * `runTypeCheck`'s injection seam exists for: the behaviour worth pinning is
 * which packages get attempted and which failures survive to the report, and
 * spawning real npm children would test tsc instead.
 */
describe('type-check orchestration', () => {
  const project = (name: string): { name: string; cwd: string } => ({
    name,
    cwd: join(mfePackagesDir, name),
  });

  /** A stand-in that fails the named packages and records what it was asked to run. */
  function checkerFailing(failing: readonly string[]): {
    checkProject: (p: { name: string; cwd: string }) => Promise<
      | { ok: true; output: string }
      | { ok: false; reason: { kind: 'nonzero-exit'; exitCode: number | null }; output: string }
    >;
    attempted: string[];
  } {
    const attempted: string[] = [];
    return {
      attempted,
      checkProject: (p) => {
        attempted.push(p.name);
        return Promise.resolve(
          failing.includes(p.name)
            ? { ok: false as const, reason: { kind: 'nonzero-exit' as const, exitCode: 2 }, output: '' }
            : { ok: true as const, output: '' },
        );
      },
    };
  }

  // The headline of this branch's runner change: awaiting each child directly
  // ended the loop at the first red package and left every later one unchecked,
  // so one broken MFE hid the state of all its siblings.
  it('sequential: checks every package and reports all the red ones', async () => {
    const { checkProject, attempted } = checkerFailing(['b-mfe', 'd-mfe']);

    const failures = await runSequential([project('a-mfe'), project('b-mfe'), project('c-mfe'), project('d-mfe')], {
      timeoutMs: 0,
      checkProject,
    });

    expect(attempted).toEqual(['a-mfe', 'b-mfe', 'c-mfe', 'd-mfe']);
    expect(failures).toEqual([
      { name: 'b-mfe', reason: { kind: 'nonzero-exit', exitCode: 2 } },
      { name: 'd-mfe', reason: { kind: 'nonzero-exit', exitCode: 2 } },
    ]);
  });

  it('parallel: reports all the red ones too, on the same failure shape', async () => {
    const { checkProject, attempted } = checkerFailing(['b-mfe']);

    const failures = await runParallel([project('a-mfe'), project('b-mfe')], {
      timeoutMs: 0,
      checkProject,
    });

    expect(attempted).toEqual(['a-mfe', 'b-mfe']);
    expect(failures).toEqual([{ name: 'b-mfe', reason: { kind: 'nonzero-exit', exitCode: 2 } }]);
  });

  it('reports a timeout as its own reason rather than as an exit code', async () => {
    const failures = await runSequential([project('slow-mfe')], {
      timeoutMs: 100,
      checkProject: () =>
        Promise.resolve({
          ok: false as const,
          reason: { kind: 'timeout' as const, timeoutMs: 100 },
          output: '',
        }),
    });

    expect(failures).toEqual([{ name: 'slow-mfe', reason: { kind: 'timeout', timeoutMs: 100 } }]);
  });
});

describe('refuseMissingTypeCheckScript', () => {
  // A package present in the tree and silently unchecked is the state this
  // script exists to make impossible, so a missing script stops the run rather
  // than dropping the package from it.
  it('refuses the run and names every package missing the script', () => {
    expect(() => refuseMissingTypeCheckScript(['tasks-mfe', 'login-mfe'])).toThrow(
      /tasks-mfe, login-mfe/,
    );
  });

  it('returns quietly when every package declares one', () => {
    expect(() => refuseMissingTypeCheckScript([])).not.toThrow();
  });
});
