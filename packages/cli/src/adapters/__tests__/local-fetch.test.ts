// TEST-ONLY — this test file carries NO `@cpt` marker and traces to NO
// FEATURE instruction. It exercises `createLocalFetchFn`
// (`packages/cli/src/adapters/local-fetch.ts`), a TEST-ONLY realization of
// the EXISTING `FetchFn` seam (`packages/cli/src/resolver/types.ts`) that
// lets `frontx install` + `frontx seed` assemble a template OFFLINE from a
// local directory instead of the network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { joinWithinRoot } from '@gears-frontx/test-support/path-guard';
import { createLocalFetchFn } from '../local-fetch';
import { TemplateInventory } from '../../inventory/TemplateInventory';
import { FsInventoryIndex } from '../fs-inventory-index';
import { FsContentStore } from '../fs-content-store';
import { createFsReadContentItemsFn } from '../fs-read-content-items';
import { createFsWriteFileFn, createFsReadProjectFileFn } from '../fs-project-io';
import { createFsProvenanceWriteFn } from '../provenance-io';
import { installCommand } from '../../commands/install';
import { seedRepository } from '../../commands/seed-repository';
import { createFsReadTargetDirFn } from '../fs-target-dir';

// The real on-disk template this repository ships — the FIXTURE the P16
// final done-gate also assembles OFFLINE via this same adapter.
const TEMPLATE_SHELL_DIR = path.resolve(__dirname, '../../../../../template-shell');

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('createLocalFetchFn — TEST-ONLY local content adapter', () => {
  let localDir: string;

  beforeEach(() => {
    localDir = makeTmpDir('frontx-local-fetch-src-');
  });

  afterEach(() => {
    fs.rmSync(localDir, { recursive: true, force: true });
  });

  it('walks a local directory and returns the $frontxTemplateFiles bundle envelope, ignoring the url argument', async () => {
    fs.writeFileSync(joinWithinRoot(localDir, 'frontx-template.json'), '{"name":"fixture","version":"1.0.0"}');
    fs.mkdirSync(joinWithinRoot(localDir, 'src'));
    fs.writeFileSync(joinWithinRoot(localDir, 'src', 'index.ts'), 'export {};');

    const fetchFn = createLocalFetchFn(localDir);
    const content = await fetchFn('https://this-url-is-ignored.example/anything');

    expect(JSON.parse(content)).toEqual({
      $frontxTemplateFiles: {
        'frontx-template.json': '{"name":"fixture","version":"1.0.0"}',
        [path.join('src', 'index.ts')]: 'export {};',
      },
    });
  });

  it('skips node_modules/dist/dist-lib and other build/dependency artifact directories', async () => {
    fs.writeFileSync(joinWithinRoot(localDir, 'frontx-template.json'), '{"name":"fixture","version":"1.0.0"}');
    fs.mkdirSync(joinWithinRoot(localDir, 'node_modules', 'some-dep'), { recursive: true });
    fs.writeFileSync(joinWithinRoot(localDir, 'node_modules', 'some-dep', 'index.js'), 'module.exports = {};');
    fs.mkdirSync(joinWithinRoot(localDir, 'dist'));
    fs.writeFileSync(joinWithinRoot(localDir, 'dist', 'index.js'), 'built output');

    const fetchFn = createLocalFetchFn(localDir);
    const content = await fetchFn('unused://url');
    const bundle = (JSON.parse(content) as { $frontxTemplateFiles: Record<string, string> }).$frontxTemplateFiles;

    expect(Object.keys(bundle)).toEqual(['frontx-template.json']);
  });

  // F-8 (issue #470 phase 4.5): an agent-state directory can exist inside a
  // template source dir (e.g. `template-shell/.omc/` today) without being part
  // of the template's declared content — it must never leak into the offline
  // bundle this test-only adapter builds. `.omo/` is the same class, written
  // per agent session rather than per working directory.
  it.each([
    { dir: '.omc', child: 'state', file: 'notepad.md', content: 'agent scratch state' },
    { dir: '.omo', child: 'run-continuation', file: 'ses_fixture.json', content: '{"session":"fixture"}' },
  ])('skips $dir agent-state directories', async ({ dir, child, file, content: stateContent }) => {
    fs.writeFileSync(joinWithinRoot(localDir, 'frontx-template.json'), '{"name":"fixture","version":"1.0.0"}');
    fs.mkdirSync(joinWithinRoot(localDir, dir, child), { recursive: true });
    fs.writeFileSync(joinWithinRoot(localDir, dir, child, file), stateContent);

    const fetchFn = createLocalFetchFn(localDir);
    const content = await fetchFn('unused://url');
    const bundle = (JSON.parse(content) as { $frontxTemplateFiles: Record<string, string> }).$frontxTemplateFiles;

    expect(Object.keys(bundle)).toEqual(['frontx-template.json']);
  });

  it('rejects when the local source directory does not exist', async () => {
    const fetchFn = createLocalFetchFn(joinWithinRoot(localDir, 'does-not-exist'));
    await expect(fetchFn('unused://url')).rejects.toThrow(/does not exist or is not a directory/);
  });
});

describe('offline e2e — frontx install + seed assemble the real template-shell/ OFFLINE (no network)', () => {
  it('materializes template-shell into a project via the local adapter + the real install/seed pipeline', async () => {
    expect(fs.existsSync(path.join(TEMPLATE_SHELL_DIR, 'frontx-template.json'))).toBe(true);

    const inventoryRoot = makeTmpDir('frontx-local-fetch-inventory-');
    const targetDir = makeTmpDir('frontx-local-fetch-target-');
    try {
      const inventory = new TemplateInventory(new FsInventoryIndex(inventoryRoot), new FsContentStore(inventoryRoot));
      const fetchFn = createLocalFetchFn(TEMPLATE_SHELL_DIR);

      const installResult = await installCommand('local:gears-frontx/frontx-template-shell@offline', inventory, fetchFn);
      expect(installResult.ok).toBe(true);

      const lookupFn = (name: string) => inventory.lookup(name);
      const readContentFn = createFsReadContentItemsFn(inventoryRoot);
      const writeFileFn = createFsWriteFileFn();
      const provenanceWriteFn = createFsProvenanceWriteFn();
      const readProjectFileFn = createFsReadProjectFileFn();

      // Identity is the manifest's own declared `name`
      // ("@gears-frontx/frontx-template-shell", `template-shell/frontx-template.json`),
      // not the repository segment ("frontx-template-shell") the source-spec named.
      const templateIdentity = '@gears-frontx/frontx-template-shell';
      const seedResult = await seedRepository(
        templateIdentity,
        targetDir,
        lookupFn,
        readContentFn,
        writeFileFn,
        provenanceWriteFn,
        createFsReadTargetDirFn(),
        readProjectFileFn,
      );

      expect(seedResult.ok).toBe(true);
      if (!seedResult.ok) return;
      expect(seedResult.appliedTemplates).toEqual([templateIdentity]);

      // Representative files inside declared exclusive subtrees materialize as REAL on-disk files.
      expect(fs.existsSync(joinWithinRoot(targetDir, 'package.json'))).toBe(true);
      expect(fs.existsSync(joinWithinRoot(targetDir, 'src', 'index.ts'))).toBe(true);
      expect(fs.readFileSync(joinWithinRoot(targetDir, 'src', 'index.ts'), 'utf-8')).toBe(
        fs.readFileSync(path.join(TEMPLATE_SHELL_DIR, 'src', 'index.ts'), 'utf-8'),
      );

      // Provenance was written OFFLINE, per the same materialize path a real install uses.
      const provenance = JSON.parse(fs.readFileSync(joinWithinRoot(targetDir, '.frontx', 'provenance.json'), 'utf-8')) as Array<{
        templateIdentity: string;
      }>;
      expect(provenance.map((r) => r.templateIdentity)).toEqual([templateIdentity]);

      // No network / build-artifact directories were ever pulled into the target.
      expect(fs.existsSync(joinWithinRoot(targetDir, 'node_modules'))).toBe(false);
      expect(fs.existsSync(joinWithinRoot(targetDir, 'dist'))).toBe(false);
      // F-8: template-shell/.omc/ is real agent-state on disk today, and .omo/
      // is the same class; neither may be seeded as declared template content.
      expect(fs.existsSync(joinWithinRoot(targetDir, '.omc'))).toBe(false);
      expect(fs.existsSync(joinWithinRoot(targetDir, '.omo'))).toBe(false);
    } finally {
      fs.rmSync(inventoryRoot, { recursive: true, force: true });
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
