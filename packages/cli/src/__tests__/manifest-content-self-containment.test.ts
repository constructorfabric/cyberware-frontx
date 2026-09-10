// @cpt-algo:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2
// @cpt-dod:cpt-frontx-dod-template-manifest-content-self-containment:p2
import { describe, it, expect } from 'vitest';
import { validateContentSelfContainment } from '../manifest/validate-content-self-containment';
import type { ListContentOwnedFilesFn, ReadFileFn } from '../manifest/types';

// Builds a fake in-memory candidate template: `files` maps a POSIX-relative
// path to its raw text content. `listContentOwnedFiles` returns every fixture
// path that falls under the requested content-owning path (directory prefix
// match, or exact match for a single-file entry) - a minimal stand-in for
// the real fs walk (`createFsListContentOwnedFilesFn`) that keeps these
// tests independent of any real filesystem.
function fakeTemplate(files: Record<string, string>): { listContentOwnedFiles: ListContentOwnedFilesFn; readFile: ReadFileFn } {
  const listContentOwnedFiles: ListContentOwnedFilesFn = async (_templateDir, contentOwnedPath) => {
    return Object.keys(files).filter((f) => f === contentOwnedPath || f.startsWith(`${contentOwnedPath}/`));
  };
  const readFile: ReadFileFn = async (path) => {
    const relative = path.startsWith('template/') ? path.slice('template/'.length) : path;
    const content = files[relative];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  };
  return { listContentOwnedFiles, readFile };
}

function manifest(exclusiveSubtrees: string[], sharedFilePaths: string[] = []): string {
  return JSON.stringify({
    name: 'my-tpl',
    version: '1.0.0',
    ownershipBoundaries: {
      exclusiveSubtrees,
      sharedFiles: sharedFilePaths.map((path) => ({ path, mergeStrategy: 'exclusive', ownedRegions: [] })),
    },
  });
}

describe('validateContentSelfContainment - package.json `file:` specifiers', () => {
  // inst-csc-extract-specifiers / inst-csc-resolve-specifier / inst-csc-if-outside-root
  it('a `file:` specifier resolving outside the template root is a violation', async () => {
    // Mirrors #485's actual escape: `packages/framework/package.json` sits
    // two levels below the template root, so three `..` segments overshoot
    // the root by exactly one level.
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/package.json': JSON.stringify({
        devDependencies: { '@gears-frontx/mfes': 'file:../../../packages/mfes' },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['packages']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.field).toContain('packages/framework/package.json');
  });

  // false-positive guard (#485's "stays inside" class) - a relative `file:`
  // specifier that stays inside the template root is legitimate, not flagged.
  it("a `file:` specifier resolving to the template's own subpackage is NOT a violation", async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'src-app/mfe_packages/blank/package.json': JSON.stringify({
        dependencies: { '@gears-frontx/react': 'file:../../../packages/react' },
      }),
      'packages/react/package.json': JSON.stringify({ name: '@gears-frontx/react', version: '0.2.0' }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['src-app', 'packages']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  it('a root-level package.json declared as its own exclusiveSubtrees entry is inspected', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:../packages/api' } }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
  });
});

describe('validateContentSelfContainment - absolute / drive-prefixed / home-relative specifiers (A1)', () => {
  // Every specifier this algorithm resolves is CONTRACTUALLY root-relative;
  // an absolute, drive-prefixed, or home-relative value can never actually
  // be root-relative, so it is outside the root by definition regardless of
  // `..`-segment counting. Real-world source: `npm install /abs/path` and
  // `npm link` both write an absolute `file:` specifier.
  it('an absolute POSIX `file:` specifier is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:/Users/me/monorepo/packages/api' } }),
    });
    const result = await validateContentSelfContainment('template', manifest(['package.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('a Windows drive-prefixed `file:` specifier is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:C:\\repo\\packages\\api' } }),
    });
    const result = await validateContentSelfContainment('template', manifest(['package.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('a home-relative (`~`) `file:` specifier is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:~/repo/packages/api' } }),
    });
    const result = await validateContentSelfContainment('template', manifest(['package.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('an absolute `compilerOptions.baseUrl` is a violation, even for an otherwise in-root `paths` entry', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '/Users/me/monorepo/fixture-shell', paths: { '@gears-frontx/state': ['./packages/state/src/index.ts'] } },
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });
});

describe('validateContentSelfContainment - backslash / mixed-separator specifiers (CodeRabbit review)', () => {
  // `resolvesOutsideRoot` splits on `/` to count `..` segments; a
  // backslash-separated relative escape written by a Windows author (or
  // pasted from a Windows machine) must not survive as one opaque, non-`..`
  // segment. Mirrors the same escaping depth used throughout this suite:
  // `packages/framework/package.json` sits two levels below the root, so
  // three ascending segments overshoot by exactly one, regardless of which
  // separator spells them.
  it('a relative backslash traversal in a `file:` specifier is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/package.json': JSON.stringify({
        devDependencies: { '@gears-frontx/mfes': 'file:..\\..\\..\\packages\\mfes' },
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('a relative backslash traversal in a tsconfig `paths` entry is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '@gears-frontx/mfes': ['..\\..\\..\\packages\\mfes\\src'] } },
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('a mixed forward-slash/backslash traversal is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/package.json': JSON.stringify({
        devDependencies: { '@gears-frontx/mfes': 'file:../..\\../packages/mfes' },
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });

  it('a backslash-separated reference that still stays inside the template root is NOT a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'src-app/mfe_packages/blank/package.json': JSON.stringify({
        dependencies: { '@gears-frontx/react': 'file:..\\..\\..\\packages\\react' },
      }),
      'packages/react/package.json': JSON.stringify({ name: '@gears-frontx/react', version: '0.2.0' }),
    });
    const result = await validateContentSelfContainment('template', manifest(['src-app', 'packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });
});

describe('validateContentSelfContainment - tsconfig `paths` mappings', () => {
  // inst-csc-extract-specifiers (tsconfig) / inst-csc-resolve-specifier
  it('a `paths` entry resolving outside the template root is a violation, wildcard included', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.app.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@gears-frontx/api/*': ['../packages/api/src/*'] },
        },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['tsconfig.app.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('compilerOptions.paths');
  });

  it('a `paths` entry resolving inside the template root (own subpackage) is NOT a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.app.json': JSON.stringify({
        compilerOptions: { paths: { '@gears-frontx/state': ['./packages/state/src/index.ts'] } },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['tsconfig.app.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  it('respects a non-default `baseUrl` when resolving a `paths` entry', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/react/tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '..', paths: { '@gears-frontx/state': ['./state/src/index.ts'] } },
      }),
      'packages/state/src/index.ts': 'export {};',
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['packages']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  // A2 review finding - `extends` and `references[].path` are carriers with
  // the same escape semantics as `paths`, resolved relative to the
  // tsconfig's own directory (not `baseUrl`).
  it('an `extends` target escaping the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({ extends: '../../../tsconfig.base.json' }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('extends[0]');
  });

  it('a bare-package `extends` target (npm-resolved, not a filesystem path) is NOT a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({ extends: '@tsconfig/node20/tsconfig.json' }),
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  it('a `references[].path` entry escaping the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({ references: [{ path: '../../../other-repo/shared' }] }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('references[0].path');
  });

  it('a `references[].path` entry resolving to a sibling package inside the template root is NOT a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({ references: [{ path: '../state' }] }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  // CodeRabbit review finding on #493: `files`/`include`/`exclude` and
  // `compilerOptions.typeRoots`/`outDir` name paths too. `include` is the
  // sharpest of them - it is how a tsconfig pulls source files from outside the
  // template straight into its own program, which is the same escape a `paths`
  // mapping expresses with a different spelling.
  it('an `include` glob anchored outside the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({ include: ['src/**/*', '../../../shared/**/*'] }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.field).toContain('include[1]');
  });

  it('a `files` entry escaping the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({ files: ['src/index.ts', '../global.d.ts'] }),
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('files[1]');
  });

  it('an `exclude` pattern escaping the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({ exclude: ['node_modules', '../dist'] }),
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('exclude[1]');
  });

  it('a `typeRoots` or `outDir` outside the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { typeRoots: ['./types', '../../shared-types'], outDir: '../build' },
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.map((v) => v.field).join(' ')).toContain('compilerOptions.typeRoots[1]');
    expect(result.violations.map((v) => v.field).join(' ')).toContain('compilerOptions.outDir');
  });

  // The local review round completed the `compilerOptions` registry. `baseUrl`
  // is the finding that motivated it: the check already READ `baseUrl` to
  // resolve `paths` against, so a tsconfig with an escaping `baseUrl` and no
  // `paths` map moved its whole module resolution outside the template while
  // producing no specifier to report.
  it('a relative `baseUrl` escaping the template root is a violation even with no `paths` map', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '../../..' } }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.map((v) => v.field).join(' ')).toContain('compilerOptions.baseUrl');
  });

  it.each([
    ['rootDir', '../../../shared-src'],
    ['declarationDir', '../../../types'],
    ['outFile', '../../../bundle.js'],
    ['tsBuildInfoFile', '../../../.cache/tpl.tsbuildinfo'],
  ])('an escaping `%s` is a violation', async (option, escapingPath) => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({ compilerOptions: { [option]: escapingPath } }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.map((v) => v.field).join(' ')).toContain(`compilerOptions.${option}`);
  });

  it('an escaping `rootDirs` entry is a violation, and the array index is reported', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/framework/tsconfig.json': JSON.stringify({
        compilerOptions: { rootDirs: ['./src', '../../../generated'] },
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.map((v) => v.field).join(' ')).toContain('compilerOptions.rootDirs[1]');
  });

  // False-positive guard, and the reason globs are cut at their first wildcard
  // rather than counted as path segments: every tsconfig the real templates
  // ship looks like this, and none of it names anything outside the root.
  it('the ordinary in-template file-list and compilerOptions shapes are NOT violations', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': JSON.stringify({
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist', '**/__tests__/**', '**/*.test.ts'],
        compilerOptions: { outDir: './dist', rootDir: './src', typeRoots: ['./node_modules/@types'] },
      }),
      'tsconfig.app.json': JSON.stringify({ compilerOptions: { baseUrl: '.' } }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['tsconfig.json', 'tsconfig.app.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  // The sharpest false-positive risk the completed registry brings: a nested
  // package's tsconfig can legitimately declare `rootDir: '../..'`, which
  // climbs exactly two levels from `packages/react` and lands ON the template
  // root - inside, legally. `..`-segment counting is what makes that a pass;
  // any check that flagged an ascending path by its text would turn this
  // validation red on a template that is correct.
  it("a `rootDir` climbing exactly to the template root is NOT a violation (a real-world nested-package shape)", async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/react/tsconfig.test.json': JSON.stringify({
        extends: '../../tsconfig.json',
        compilerOptions: { noEmit: true, rootDir: '../..', types: ['vitest/globals', 'node'] },
        include: ['src/**/*', '__tests__/**/*'],
        exclude: ['node_modules', 'dist'],
      }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  it('a `rootDir` one level past the template root IS a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'packages/react/tsconfig.test.json': JSON.stringify({ compilerOptions: { rootDir: '../../..' } }),
    });
    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
  });
});

describe('validateContentSelfContainment - JSONC-tolerant tsconfig parsing (review finding on #498)', () => {
  // `tsc` itself reads `tsconfig*.json` with a JSONC parser, so a tsconfig
  // with comments and trailing commas is legal and `tsc` accepts it
  // unmodified. This check used to reject that same file as "not valid
  // JSON" - a false positive that sent the developer to fix a file that
  // was never broken. inst-csc-parse-carrier / inst-csc-extract-specifiers
  it('a tsconfig with line comments, block comments, and trailing commas parses, and an escaping `paths` entry inside it is still flagged', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': `{
        // repo base config
        "compilerOptions": {
          "baseUrl": ".", /* resolve relative to this file */
          "paths": {
            "@gears-frontx/mfes": ["../packages/mfes/src"],
          },
        },
      }`,
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('compilerOptions.paths');
  });

  it('a tsconfig with comments and trailing commas whose paths all stay inside the template root is NOT a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': `{
        // repo base config
        "include": ["src/**/*",],
        "compilerOptions": {
          "strict": true, // strict mode
        },
      }`,
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  it('a BOM-prefixed tsconfig tsc accepts is inspected, not reported as broken JSON', async () => {
    // A leading byte-order mark makes plain JSON.parse throw; tsc strips it, so
    // a BOM-prefixed tsconfig that tsc builds unmodified must not surface here
    // as an unparseable carrier - the same false-positive class as comments.
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'tsconfig.json': `\uFEFF{ "compilerOptions": { "strict": true } }`,
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  it('a `//` inside a tsconfig string value (an `extends` URL) survives JSONC parsing rather than being cut as a comment', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      // A bare package specifier is npm-resolved and thus never a violation
      // (see the `extends` describe block above) - the point here is only
      // that the URL's `//` must not corrupt the JSON, e.g. by producing an
      // unterminated string once the parser thinks the comment (and
      // therefore the rest of the line, including the closing quote) is gone.
      'tsconfig.json': `{ "extends": "@tsconfig/node20/tsconfig.json", "compilerOptions": { "types": ["node"] } }`,
    });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  it('a genuinely malformed tsconfig - unparseable even allowing comments and trailing commas - still fails closed, with a message that does not claim plain JSON', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({ 'tsconfig.json': '{ "compilerOptions": { "strict": true, ' });
    const result = await validateContentSelfContainment('template', manifest(['tsconfig.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.field).toBe('tsconfig.json');
    expect(result.violations[0]?.message).toMatch(/even tolerating the comments and trailing commas/i);
  });

  it('a malformed package.json still reports the plain "not valid JSON" message, unaffected by tsconfig JSONC tolerance', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({ 'package.json': 'not-valid-json{{{' });
    const result = await validateContentSelfContainment('template', manifest(['package.json']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.message).toMatch(/^is a declared package\.json carrier that is not valid JSON/);
  });
});

describe('validateContentSelfContainment - lockfile entries', () => {
  // inst-csc-extract-specifiers (lockfile, lockfileVersion >= 2 "packages" map)
  it('a lockfileVersion-3 workspace-member key escaping the template root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { name: 'tpl' }, '../packages/api': { name: '@gears-frontx/api', version: '0.3.0' } },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package-lock.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toContain('packages["../packages/api"]');
  });

  it('a lockfileVersion-3 `node_modules/*` link entry\'s escaping `resolved` value is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/@gears-frontx/api': { resolved: '../packages/api', link: true } },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package-lock.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
  });

  it('a workspace-member key/resolved value that stays inside the template root is NOT a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'packages/auth': { name: '@gears-frontx/auth', version: '0.2.0' },
          'node_modules/@gears-frontx/auth': { resolved: 'packages/auth', link: true },
        },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package-lock.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  it('a registry `resolved` URL is never mistaken for a local-path escape', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/esbuild': {
            version: '0.19.12',
            resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.19.12.tgz',
          },
        },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package-lock.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('VALIDATED');
  });

  // inst-csc-extract-specifiers (lockfile, legacy lockfileVersion 1 nested tree)
  it('a legacy lockfileVersion-1 `file:`-pinned nested entry escaping the root is a violation', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          '@gears-frontx/api': { version: 'file:../packages/api' },
        },
      }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package-lock.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
  });
});

describe('validateContentSelfContainment - carrier discovery and edge cases', () => {
  it('no declared exclusive subtrees → VALIDATED trivially', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({});
    const result = await validateContentSelfContainment('template', manifest([]), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  it('a non-carrier file (e.g. a source .ts file) is never inspected', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'src/index.ts': 'import x from "../../../outside"; export default x;',
    });
    const result = await validateContentSelfContainment('template', manifest(['src']), listContentOwnedFiles, readFile);
    expect(result.status).toBe('VALIDATED');
  });

  // Review finding on #493: this used to expect VALIDATED. A carrier the check
  // cannot parse is a carrier the check did not inspect, and "we could not look"
  // must not be indistinguishable from "we looked and it was clean" - silence is
  // also what a pass looks like.
  it('a malformed (unparseable) carrier file is a violation naming the file, not a silent skip', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({ 'package.json': 'not-valid-json{{{' });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.field).toBe('package.json');
    expect(result.violations[0]?.message).toMatch(/not valid JSON/i);
  });

  it('a carrier that was enumerated but cannot be read is a violation naming the file and the carrier kind', async () => {
    // Enumerated (the manifest declares it) but absent from the fixture's file
    // map, so `readFile` rejects - the shape a file deleted between listing and
    // reading, or one the OS refuses, actually takes.
    const listContentOwnedFiles: ListContentOwnedFilesFn = async () => ['packages/auth/tsconfig.json'];
    const readFile: ReadFileFn = async () => {
      throw new Error('EACCES: permission denied');
    };

    const result = await validateContentSelfContainment('template', manifest(['packages']), listContentOwnedFiles, readFile);

    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations[0]?.field).toBe('packages/auth/tsconfig.json');
    expect(result.violations[0]?.message).toMatch(/tsconfig carrier that could not be read/i);
  });

  it('multiple violations across multiple carriers are all reported', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:../packages/api' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@gears-frontx/mfes': ['../packages/mfes/src'] } } }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package.json', 'tsconfig.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations).toHaveLength(2);
  });

  // A3 review finding - ADR-0031's own worked example puts
  // package.json/lockfile/tsconfig in `sharedFiles`. No template ships that
  // shape yet (both post-#470 templates declare them as exclusive subtrees),
  // which is exactly why this needs a test: enumeration must not silently stop
  // covering the highest-value carriers the first time one does.
  it('a carrier declared only as a shared-file path (not an exclusive subtree) is still inspected', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:../packages/api' } }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest([], ['package.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
  });

  it('a carrier declared as both an exclusive subtree and a shared-file path is inspected once, not double-reported', async () => {
    const { listContentOwnedFiles, readFile } = fakeTemplate({
      'package.json': JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:../packages/api' } }),
    });
    const result = await validateContentSelfContainment(
      'template',
      manifest(['package.json'], ['package.json']),
      listContentOwnedFiles,
      readFile,
    );
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations).toHaveLength(1);
  });
});
