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

// The offline e2e describe block this file used to carry here (`frontx
// install` + the OLD `seedRepository(templateRef, targetDir, ...)` against
// the real on-disk `template-shell/`) exercised a command signature checkpoint
// 3 retires entirely (`commands/seed-repository.ts`'s REWRITE header comment):
// the new `seedRepository(dir, batch, adoptExisting, deps)` takes a batch and
// a project-state document, not a bare `templateRef`, and has no
// `appliedTemplates`/provenance.json shape to assert on. A real end-to-end
// equivalent for the new model would need `dir` to itself resolve
// `path:template-shell`'s relative origin against this monorepo's checkout —
// which only holds when `dir` IS this checkout, not an arbitrary disposable
// tmp directory this suite creates — so it is not reproduced here; the new
// seed/apply/assemble pipeline's own fixture-backed coverage lives in
// `__tests__/entry-flows.test.ts` and `__tests__/cli.test.ts` instead.
