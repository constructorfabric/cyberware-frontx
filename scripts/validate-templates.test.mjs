// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCliModule, runCli } from './validate-templates.mjs';

/** @type {string | undefined} */
let rootDir;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

async function makeRoot() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-validate-templates-'));
  return rootDir;
}

function validManifest(overrides = {}) {
  return JSON.stringify({
    name: 'tpl',
    version: '1.0.0',
    excludedSubtrees: [],
    description: 'Establishes the project shell and contributes the build toolchain.',
    ...overrides,
  });
}

describe('runCli', () => {
  it('passes when every template directory validates', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-shell'), { recursive: true });
    await writeFile(path.join(root, 'template-shell', 'frontx-template.json'), validManifest());
    /** @type {string[]} */
    const logs = [];

    const exitCode = await runCli({ rootDir: root, log: (line) => logs.push(line) });

    expect(exitCode).toBe(0);
    expect(logs.some((l) => l.includes('PASS') && l.includes('template-shell'))).toBe(true);
  });

  // The doc-only template shape (template-design-guardrails): a
  // manifest, a DESIGN.md, and the template's own .frontx/ai/<identity>/
  // bundle subtree - no package.json, no lockfile, no ecosystem pins. The
  // manifest contract requires no installable content, and with no
  // package.json anywhere self-containment has nothing to object to, so
  // this must PASS, not crash or false-fail.
  it('passes a doc-only template: manifest + DESIGN.md + its .frontx/ai bundle, no package.json', async () => {
    const root = await makeRoot();
    const name = '@gears-frontx/template-design-guardrails';
    const dir = path.join(root, 'template-design-guardrails');
    await mkdir(path.join(dir, '.frontx', 'ai', name, 'skills'), { recursive: true });
    await writeFile(
      path.join(dir, 'frontx-template.json'),
      validManifest({
        name,
        version: '0.1.0-alpha.1',
        ownershipBoundaries: {
          exclusiveSubtrees: ['DESIGN.md', `.frontx/ai/${name}/`],
          sharedFiles: [],
        },
      }),
    );
    await writeFile(path.join(dir, 'DESIGN.md'), '# Design guardrails\n');
    await writeFile(path.join(dir, '.frontx', 'ai', name, 'extension.json'), JSON.stringify({ skills: [] }));
    await writeFile(path.join(dir, '.frontx', 'ai', name, 'skills', 'guardrails.md'), '# skill\n');
    /** @type {string[]} */
    const logs = [];
    /** @type {string[]} */
    const errors = [];

    const exitCode = await runCli({ rootDir: root, log: (l) => logs.push(l), logError: (l) => errors.push(l) });

    expect(errors).toEqual([]);
    expect(exitCode).toBe(0);
    expect(logs.some((l) => l.includes('PASS') && l.includes('template-design-guardrails'))).toBe(true);
  });

  it('fails when one template directory fails validation, and still checks the rest', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-mfe'), { recursive: true });
    await writeFile(path.join(root, 'template-mfe', 'frontx-template.json'), JSON.stringify({}));
    await mkdir(path.join(root, 'template-shell'), { recursive: true });
    await writeFile(path.join(root, 'template-shell', 'frontx-template.json'), validManifest());
    /** @type {string[]} */
    const logs = [];
    /** @type {string[]} */
    const errors = [];

    const exitCode = await runCli({ rootDir: root, log: (l) => logs.push(l), logError: (l) => errors.push(l) });

    expect(exitCode).toBe(1);
    expect(errors.some((l) => l.includes('FAIL') && l.includes('template-mfe'))).toBe(true);
    expect(logs.some((l) => l.includes('PASS') && l.includes('template-shell'))).toBe(true);
  });

  it('fails when a template carries a content self-containment violation', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-shell'), { recursive: true });
    // No separate declaration needed: the four-field contract's payload is
    // the whole candidate directory by default, minus the manifest itself
    // and any declared `excludedSubtrees` - `package.json` is inspected
    // simply by being there.
    await writeFile(path.join(root, 'template-shell', 'frontx-template.json'), validManifest());
    await writeFile(
      path.join(root, 'template-shell', 'package.json'),
      JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:../../packages/api' } }),
    );
    /** @type {string[]} */
    const errors = [];

    const exitCode = await runCli({ rootDir: root, logError: (l) => errors.push(l) });

    expect(exitCode).toBe(1);
    expect(errors.some((l) => l.includes('not self-contained'))).toBe(true);
  });

  // A5 review finding: zero templates found must never be a silent pass -
  // it means discovery is broken (wrong root, renamed manifest) or every
  // template vanished, either of which needs a human's attention.
  it('fails loudly, not vacuously, when no template is found', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'packages'), { recursive: true }); // no manifest anywhere
    /** @type {string[]} */
    const errors = [];

    const exitCode = await runCli({ rootDir: root, logError: (l) => errors.push(l) });

    expect(exitCode).toBe(1);
    expect(errors.some((l) => l.includes('no template found'))).toBe(true);
  });

  // #492 review finding 3 ("confusing module-resolution error instead of a
  // clear message"), reproduced here for @gears-frontx/cli: a fresh clone or
  // a `clean:artifacts` run leaves packages/cli/dist missing, and a plain
  // `import('@gears-frontx/cli')` would throw node's raw ERR_MODULE_NOT_FOUND.
  // `loadCliModule` is injected here rather than actually deleting dist/,
  // which would make this test destructive to every other suite sharing the
  // built package.
  it('fails with a clear, actionable message - not a raw stack trace - when the CLI build is missing', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-shell'), { recursive: true });
    await writeFile(path.join(root, 'template-shell', 'frontx-template.json'), validManifest());
    /** @type {string[]} */
    const errors = [];

    const exitCode = await runCli({
      rootDir: root,
      logError: (l) => errors.push(l),
      loadCliModule: async () => ({
        ok: false,
        message: 'built @gears-frontx/cli not found (packages/cli/dist is missing) - run `npm run build:packages:cli` first.',
      }),
    });

    expect(exitCode).toBe(1);
    expect(errors.some((l) => l.includes('run `npm run build:packages:cli` first'))).toBe(true);
  });
});

describe('loadCliModule', () => {
  it('returns the loaded module on success', async () => {
    const fakeModule = { MANIFEST_FILENAME: 'frontx-template.json' };
    const result = await loadCliModule(async () => fakeModule);

    expect(result).toEqual({ ok: true, module: fakeModule });
  });

  it('maps ERR_MODULE_NOT_FOUND to a clear, actionable message instead of the raw error', async () => {
    const moduleNotFound = Object.assign(new Error("Cannot find module '@gears-frontx/cli'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });

    const result = await loadCliModule(async () => {
      throw moduleNotFound;
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('run `npm run build:packages:cli` first');
  });

  it('rethrows any other import error unchanged - only a missing build gets the friendly message', async () => {
    const otherError = new Error('unexpected syntax error in dist/index.js');

    await expect(loadCliModule(async () => {
      throw otherError;
    })).rejects.toThrow(otherError);
  });
});
