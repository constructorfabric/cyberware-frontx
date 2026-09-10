// @cpt-algo:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1
//
// End-to-end regression: `frontx seed <dir>` must deliver a template's
// AI-extension bundle into `<dir>/.frontx/ai/<manifest-name>/` on the SAME
// terms regardless of the invoking process's own working directory —
// `seed <dir>` and `cd <dir> && seed .` name the identical project root, and
// nothing in the AI-bundle contract (`cpt-frontx-dod-cli-scaffolding-ai-
// bundle`) makes delivery conditional on which of the two spellings a caller
// used. Every prior test of this path (`ai-bundle.test.ts`'s pure-logic
// suite, `fs-containment.test.ts`'s adapter-level suite) either injects
// `installedContentPath` directly or runs with the process cwd already
// equal to the project root, so neither could have caught a source that
// resolves correctly in one case and silently drops the bundle in the
// other. This suite drives the real `seed` dispatch (`run`, `createRealDeps`)
// against a real filesystem, once with each cwd, to close that gap.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { joinWithinRoot } from '@gears-frontx/test-support/path-guard';
import { run, createRealDeps, EXIT_SUCCESS } from '../cli';

const MANIFEST_NAME = '@gears-frontx/frontx-template-shell';

// A minimal but real template-shaped fixture: a valid four-field manifest,
// one ordinary payload file, and an AI-extension bundle at the exact
// `.frontx/ai/<manifest-name>/` convention path `scaffold/ai-bundle.ts`
// resolves against the template's own installed content path. Named
// `template-shell` and keyed under `MANIFEST_NAME` so it resolves as the
// CLI's own generated official default (`generated/official-defaults.ts`:
// `"@gears-frontx/frontx-template-shell": "path:template-shell"`), which is
// what `seed` accepts without a separate `register` step.
function writeTemplateFixture(targetDir: string): void {
  const templateDir = joinWithinRoot(targetDir, 'template-shell');
  fs.mkdirSync(templateDir, { recursive: true });
  fs.writeFileSync(
    path.join(templateDir, 'frontx-template.json'),
    JSON.stringify({
      name: MANIFEST_NAME,
      version: '1.0.0',
      excludedSubtrees: [],
      description: 'Fixture template for the seed/cwd AI-bundle regression.',
    }),
  );
  fs.writeFileSync(path.join(templateDir, 'README.md'), '# fixture payload\n');
  const bundleDir = path.join(templateDir, '.frontx', 'ai', MANIFEST_NAME);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'extension.json'), JSON.stringify({ name: MANIFEST_NAME }));
}

function bundleExtensionPath(projectRoot: string): string {
  return path.join(projectRoot, '.frontx', 'ai', MANIFEST_NAME, 'extension.json');
}

describe('seed AI-bundle delivery is independent of the invoking process cwd', () => {
  let base: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-seed-cwd-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('delivers the bundle when seed is invoked from the target directory itself', async () => {
    const targetDir = joinWithinRoot(base, 'from-inside');
    fs.mkdirSync(targetDir, { recursive: true });
    writeTemplateFixture(targetDir);

    process.chdir(targetDir);
    const batch = JSON.stringify({ templates: { [MANIFEST_NAME]: ['.'] } });
    const outcome = await run(['seed', '.', '--input', batch, '--adopt-existing', '--json'], createRealDeps());

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '{}').ok).toBe(true);
    expect(fs.existsSync(bundleExtensionPath(targetDir))).toBe(true);
  });

  // The actual regression: `seed <dir>` named from a DIFFERENT cwd than
  // `<dir>` used to resolve the local origin's payload correctly (that read
  // is joined against the `repoRoot` the seed dispatch passes explicitly)
  // while silently skipping the AI-bundle copy (that seam took the same
  // still-relative `installedContentPath` and joined it against the
  // process's own cwd instead) — `ok: true` on both invocations, only one of
  // which actually delivered the bundle.
  it('delivers the identical bundle when seed is invoked from a sibling directory, naming the target explicitly', async () => {
    const targetDir = joinWithinRoot(base, 'from-outside');
    const otherCwd = joinWithinRoot(base, 'unrelated-cwd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(otherCwd, { recursive: true });
    writeTemplateFixture(targetDir);

    process.chdir(otherCwd);
    const batch = JSON.stringify({ templates: { [MANIFEST_NAME]: ['.'] } });
    const outcome = await run(['seed', targetDir, '--input', batch, '--adopt-existing', '--json'], createRealDeps());

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '{}').ok).toBe(true);
    expect(fs.existsSync(bundleExtensionPath(targetDir))).toBe(true);
    // Nothing should have been written under the unrelated cwd at all — a
    // regression that resolved the bundle base against the process cwd
    // would land it here instead of silently dropping it.
    expect(fs.existsSync(path.join(otherCwd, '.frontx'))).toBe(false);
  });
});
