// @cpt-flow:cpt-frontx-flow-template-manifest-validate-for-publication:p1
// @cpt-algo:cpt-frontx-algo-template-manifest-validate-contract:p1
// @cpt-state:cpt-frontx-state-template-manifest-validation-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-template-manifest-validate-command:p1
// @cpt-dod:cpt-frontx-dod-template-manifest-single-description:p1
import path from 'node:path';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateManifestContract, readManifestFromContent } from '../manifest/validate-contract';
import { validateCommand } from '../commands/validate';
import { createFsListPayloadFilesFn, createFsResolveDeclaredExclusionFn, createFsReadFileFn } from '../adapters/fs-project-io';
import { MANIFEST_FILENAME } from '../manifest/types';
import type { TemplateManifest, ReadFileFn, ListPayloadFilesFn, ResolveDeclaredExclusionFn } from '../manifest/types';

// These tests exercise the manifest-CONTRACT path only (cpt-frontx-algo-
// template-manifest-validate-contract, p1); the content self-containment
// check (p2, packages/cli/src/__tests__/manifest-content-self-containment.test.ts)
// has its own dedicated coverage, so a stub that finds no files/exclusions is
// the correct fixture here - it keeps these cases from depending on behavior
// that isn't what they're testing.
const noPayloadFiles: ListPayloadFilesFn = async () => [];
const noDeclaredExclusions: ResolveDeclaredExclusionFn = async () => 'ABSENT';

// Helper: build a valid four-field manifest JSON string - exactly `name`,
// `version`, `excludedSubtrees`, `description` (cpt-frontx-contract-
// template-manifest). Every case that needs a different shape overrides
// through `overrides`.
function validManifest(overrides: Partial<TemplateManifest> = {}): string {
  const base: TemplateManifest = {
    name: 'my-tpl',
    version: '1.0.0',
    excludedSubtrees: [],
    description: 'Establishes the project shell and contributes the build toolchain.',
  };
  return JSON.stringify({ ...base, ...overrides });
}

describe('validateManifestContract', () => {
  // inst-if-parse-error / inst-add-parse-violation
  it('malformed JSON → FAIL parse-error violation', () => {
    const result = validateManifestContract('not-valid-json{{{');
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'manifest')).toBe(true);
  });

  // inst-check-identity / inst-add-identity-violation
  it('missing identity (name) → identity violation', () => {
    const raw = JSON.stringify({ version: '1.0.0', excludedSubtrees: [], description: 'd' });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'name')).toBe(true);
  });

  it('identity unusable as a repository-relative path → identity violation', () => {
    const result = validateManifestContract(validManifest({ name: '../escapes' }));
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'name')).toBe(true);
  });

  // inst-check-version / inst-add-version-violation
  it('missing version → version violation', () => {
    const raw = JSON.stringify({ name: 'my-tpl', excludedSubtrees: [], description: 'd' });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'version')).toBe(true);
  });

  // inst-if-version-missing — malformed (non-string) version
  it('malformed version (non-string) → version violation', () => {
    const result = validateManifestContract(validManifest({ version: 123 as unknown as string }));
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'version')).toBe(true);
  });

  // inst-check-excluded-subtrees — the category itself is required, unlike
  // the old contract's optional referencedTemplates/description
  it('missing excludedSubtrees field entirely → excludedSubtrees violation', () => {
    const raw = JSON.stringify({ name: 'my-tpl', version: '1.0.0', description: 'd' });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'excludedSubtrees')).toBe(true);
  });

  it('excludedSubtrees declared as a non-array → excludedSubtrees violation', () => {
    const result = validateManifestContract(validManifest({ excludedSubtrees: 'packages/' as unknown as string[] }));
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'excludedSubtrees')).toBe(true);
  });

  it('an empty excludedSubtrees array is VALIDATED (no exclusions declared)', () => {
    const result = validateManifestContract(validManifest({ excludedSubtrees: [] }));
    expect(result.status).toBe('VALIDATED');
  });

  // AC: pre-publish validation's verdict on `packages`, `packages/`, and
  // `packages/config.json` is determined by this spec alone, without
  // inspecting the filesystem.
  describe('excludedSubtrees well-formedness — packages / packages/ / packages/config.json', () => {
    it('"packages/" (trailing slash, strict descendant) → VALIDATED', () => {
      const result = validateManifestContract(validManifest({ excludedSubtrees: ['packages/'] }));
      expect(result.status).toBe('VALIDATED');
    });

    it('"packages" (missing trailing slash) → excludedSubtrees violation', () => {
      const result = validateManifestContract(validManifest({ excludedSubtrees: ['packages'] }));
      expect(result.status).toBe('REJECTED');
      if (result.status !== 'REJECTED') return;
      expect(result.violations.some((v) => v.field === 'excludedSubtrees[0]')).toBe(true);
    });

    it('"packages/config.json" (looks like a file, missing trailing slash) → excludedSubtrees violation', () => {
      const result = validateManifestContract(validManifest({ excludedSubtrees: ['packages/config.json'] }));
      expect(result.status).toBe('REJECTED');
      if (result.status !== 'REJECTED') return;
      expect(result.violations.some((v) => v.field === 'excludedSubtrees[0]')).toBe(true);
    });
  });

  // inst-if-excluded-subtree-malformed
  it('an excludedSubtrees entry containing a ".." segment → excludedSubtrees violation', () => {
    const result = validateManifestContract(validManifest({ excludedSubtrees: ['../escapes/'] }));
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'excludedSubtrees[0]')).toBe(true);
  });

  it('an excludedSubtrees entry that is a glob pattern → excludedSubtrees violation', () => {
    const result = validateManifestContract(validManifest({ excludedSubtrees: ['packages/*/'] }));
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'excludedSubtrees[0]')).toBe(true);
  });

  // Regression coverage (adversarial review finding): the well-formedness
  // check must hold an excludedSubtrees entry to the SAME standard the
  // identity field already is, reusing `isSafeRelativePath` rather than a
  // second, weaker formulation. Every one of these entries is well-formed
  // by the OLD (narrower) rule - trailing "/", no glob, no ".." segment -
  // and must still be rejected.
  it.each([
    ['a leading "/" (absolute)', '/packages/'],
    ['a Windows drive-prefixed value', 'C:/packages/'],
    ['a home-relative ("~"-rooted) value', '~/packages/'],
    ['a backslash-separated value', 'packages\\mfe/'],
    ['an embedded "." segment', 'packages/./mfe/'],
    ['a doubled separator (an empty segment)', 'packages//mfe/'],
  ])('an excludedSubtrees entry that is %s → excludedSubtrees violation, not VALIDATED', (_label, entry) => {
    const result = validateManifestContract(validManifest({ excludedSubtrees: [entry] }));
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'excludedSubtrees[0]')).toBe(true);
  });

  // inst-if-excluded-subtree-escapes-target
  it('an excludedSubtrees entry that coincides with the target itself ("./") → excludedSubtrees violation', () => {
    const result = validateManifestContract(validManifest({ excludedSubtrees: ['./'] }));
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'excludedSubtrees[0]')).toBe(true);
  });

  // The escape branch is defined over the entry's RESOLVED position, so an
  // entry that walks back out with ".." is caught by it as well as by the
  // well-formedness check - the spec's step 9.2 names "coincides with the
  // target itself, or otherwise escapes it", and both spellings below do.
  it.each([
    ['resolves back to the target itself', 'a/../'],
    ['resolves above the target', '../a/'],
  ])('an excludedSubtrees entry that %s → BOTH a malformed and an escapes-target violation', (_label, entry) => {
    const result = validateManifestContract(validManifest({ excludedSubtrees: [entry] }));
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    const own = result.violations.filter((v) => v.field === 'excludedSubtrees[0]');
    expect(own).toHaveLength(2);
    expect(own.some((v) => v.message.includes('well-formed'))).toBe(true);
    expect(own.some((v) => v.message.includes('strict descendant'))).toBe(true);
  });

  it('a well-formed, strict-descendant excludedSubtrees entry nested deeper than one level → VALIDATED', () => {
    const result = validateManifestContract(validManifest({ excludedSubtrees: ['packages/nested-vendor/'] }));
    expect(result.status).toBe('VALIDATED');
  });

  it('multiple excludedSubtrees entries are each checked independently', () => {
    const result = validateManifestContract(validManifest({ excludedSubtrees: ['packages/', 'apps'] }));
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'excludedSubtrees[1]')).toBe(true);
    expect(result.violations.some((v) => v.field === 'excludedSubtrees[0]')).toBe(false);
  });

  // Domain-model note (FEATURE §1.2, "Reserved CLI-owned .frontx/ namespace"):
  // whole-target ownership already subtracts .frontx unconditionally, so this
  // validator has no reserved-namespace rule of its own to enforce - an
  // excludedSubtrees entry naming .frontx or .git is refused by neither the
  // well-formedness nor the strict-descendant check.
  it('does not reject an excludedSubtrees entry for naming .frontx/ or .git/ — that reservation is not this algorithm\'s rule', () => {
    const frontx = validateManifestContract(validManifest({ excludedSubtrees: ['.frontx/ai/other-tpl/'] }));
    const git = validateManifestContract(validManifest({ excludedSubtrees: ['.git/'] }));
    expect(frontx.status).toBe('VALIDATED');
    expect(git.status).toBe('VALIDATED');
  });

  // inst-check-description / inst-if-description-invalid / inst-add-description-violation
  it('passes a manifest declaring a non-empty description', () => {
    const result = validateManifestContract(validManifest({ description: 'Establishes X and contributes Y.' }));
    expect(result.status).toBe('VALIDATED');
  });

  // description is now REQUIRED — its absence is itself a violation, unlike
  // the old contract's optional category.
  it('rejects a manifest omitting description entirely, naming the description field', () => {
    const raw = JSON.stringify({ name: 'my-tpl', version: '1.0.0', excludedSubtrees: [] });
    const result = validateManifestContract(raw);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'description')).toBe(true);
  });

  it('rejects a description declared as an empty string, naming the description field', () => {
    const result = validateManifestContract(validManifest({ description: '   ' }));
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'description')).toBe(true);
  });

  it('rejects a description declared as a non-string, naming the description field', () => {
    const result = validateManifestContract(validManifest({ description: 42 as unknown as string }));
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.some((v) => v.field === 'description')).toBe(true);
  });

  // inst-return-validated — conforming four-field manifest
  it('a conforming manifest declaring exactly the four fields → VALIDATED with no violations', () => {
    const result = validateManifestContract(validManifest());
    expect(result.status).toBe('VALIDATED');
    expect(result.violations).toHaveLength(0);
  });

  it('reports every violation together for a manifest missing every field', () => {
    const result = validateManifestContract('{}');
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.violations.map((v) => v.field).sort()).toEqual(
      ['description', 'excludedSubtrees', 'name', 'version'].sort(),
    );
  });
});

describe('validateCommand', () => {
  // inst-if-manifest-absent / inst-return-manifest-absent
  it('returns FAIL + non-zero exit code when manifest absent', async () => {
    const readFileFn: ReadFileFn = vi.fn().mockRejectedValue(new Error('ENOENT: no such file'));
    const result = await validateCommand('/some/template', readFileFn, noPayloadFiles, noDeclaredExclusions);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/manifest not found/i);
  });

  // inst-else-pass / inst-return-pass
  it('returns PASS + zero exit code for conforming manifest', async () => {
    const readFileFn: ReadFileFn = vi.fn().mockResolvedValue(validManifest());
    const result = await validateCommand('/some/template', readFileFn, noPayloadFiles, noDeclaredExclusions);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  // Review finding on #493: neither `ListPayloadFilesFn` nor
  // `ResolveDeclaredExclusionFn` has an error channel, so a real
  // `readdir`/`stat` refusal (permission denied, a path that vanished
  // mid-walk) reaches this command as a throw. It used to escape as a raw
  // node stack trace, bypassing the exit-code contract every other failure
  // here goes through.
  it('converts an enumeration failure into a named failure result rather than throwing', async () => {
    const readFileFn: ReadFileFn = vi.fn().mockResolvedValue(validManifest());
    const throwingEnumeration: ListPayloadFilesFn = async () => {
      throw Object.assign(new Error("EACCES: permission denied, scandir '/some/template'"), {
        code: 'EACCES',
      });
    };

    const result = await validateCommand('/some/template', readFileFn, throwingEnumeration, noDeclaredExclusions);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/could not be inspected for self-containment/i);
    expect(result.message).toContain('/some/template');
  });

  // The same conversion, via the OTHER seam: a declared excludedSubtrees
  // entry that cannot be honestly resolved (broken symlink, escapes root)
  // throws too, and must be converted the same way.
  it('converts a declared-exclusion resolution failure into a named failure result rather than throwing', async () => {
    const readFileFn: ReadFileFn = vi.fn().mockResolvedValue(validManifest({ excludedSubtrees: ['vendor/'] }));
    const throwingResolver: ResolveDeclaredExclusionFn = async () => {
      throw new Error('declared excludedSubtrees entry resolves outside the template root: vendor/ -> /elsewhere');
    };

    const result = await validateCommand('/some/template', readFileFn, noPayloadFiles, throwingResolver);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/could not be inspected for self-containment/i);
    expect(result.message).toContain('resolves outside the template root');
  });

  // inst-report-violations / inst-return-fail
  it('reports all violations on REJECTED manifest', async () => {
    // Missing identity, version, excludedSubtrees, and description —
    // multiple violations expected.
    const raw = JSON.stringify({});
    const readFileFn: ReadFileFn = vi.fn().mockResolvedValue(raw);
    const result = await validateCommand('/some/template', readFileFn, noPayloadFiles, noDeclaredExclusions);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.violations).toBeDefined();
    expect((result.violations ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

// Real-fs coverage of validateCommand's content-self-containment seams
// (following the seam split that replaced the single per-subtree
// `ListContentOwnedFilesFn` with `ListPayloadFilesFn` +
// `ResolveDeclaredExclusionFn`): the adapter-level throws
// (fs-project-io.test.ts) and validateCommand's throw-to-FAIL conversion
// (the fake-throw cases above) are each proven separately; these drive the
// REAL `createFsListPayloadFilesFn`, `createFsResolveDeclaredExclusionFn`,
// and `createFsReadFileFn` against a real tmpdir template, the same wiring
// `cli.ts` uses in production, so the conversion is proven end to end
// rather than only at either seam alone.
describe('validateCommand — real fs content self-containment', () => {
  let templateDir: string;
  let outsideDir: string;

  afterEach(async () => {
    if (templateDir) await rm(templateDir, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
    templateDir = '';
    outsideDir = '';
  });

  async function makeTemplate(excludedSubtrees: string[] = []): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-validate-command-'));
    templateDir = dir;
    await writeFile(path.join(dir, MANIFEST_FILENAME), validManifest({ excludedSubtrees }));
    return dir;
  }

  // AC: the manifest is authored before any target is known, so a declared
  // excludedSubtrees entry normally does not exist on disk yet - that must
  // NOT be a failure (the inverse of the old per-subtree contract, where a
  // declared content-owning path had to exist).
  it('passes when a declared excludedSubtrees entry does not exist on disk', async () => {
    const dir = await makeTemplate(['nested-template/']);
    // No `nested-template` directory is ever created under `dir`.

    const result = await validateCommand(
      dir,
      createFsReadFileFn(),
      createFsListPayloadFilesFn(),
      createFsResolveDeclaredExclusionFn(),
    );

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('refuses with exit 1 when a declared excludedSubtrees entry is a symlink resolving outside the template root', async () => {
    const dir = await makeTemplate(['vendor/']);
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-validate-command-outside-'));
    await symlink(outsideDir, path.join(dir, 'vendor'));

    const result = await validateCommand(
      dir,
      createFsReadFileFn(),
      createFsListPayloadFilesFn(),
      createFsResolveDeclaredExclusionFn(),
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('vendor/');
    expect(result.message).toContain('resolves outside the template root');
  });

  it('refuses with exit 1 when a declared excludedSubtrees entry is a broken symlink', async () => {
    const dir = await makeTemplate(['vendor/']);
    await symlink(path.join(dir, 'gone-target'), path.join(dir, 'vendor'));

    const result = await validateCommand(
      dir,
      createFsReadFileFn(),
      createFsListPayloadFilesFn(),
      createFsResolveDeclaredExclusionFn(),
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('vendor/');
  });

  // Adversarial-review regression: before this checkpoint's contract fix, a
  // backslash-spelled entry like "packages\\mfe/" passed well-formedness,
  // so `resolveDeclaredExclusion` was asked to resolve the LITERAL path
  // "packages\\mfe" (which does not exist under this filesystem's real,
  // forward-slash-separated `packages/mfe`) and read it as 'ABSENT', while
  // the real `packages/mfe` - an escaping symlink - was never probed at all
  // and the payload walk's mid-walk skip let it through silently: pre-
  // publish validation reported PASS against an AC that says explicitly
  // "never a silent PASS". Refusing the spelling at the contract check
  // means self-containment never runs at all, so it never has the chance
  // to miss it.
  it('FAILS (via the contract check) a manifest declaring a backslash-spelled excludedSubtrees entry, even though the real path it was meant to address is an escaping symlink', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-validate-command-'));
    templateDir = dir;
    await writeFile(path.join(dir, MANIFEST_FILENAME), validManifest({ excludedSubtrees: ['packages\\mfe/'] }));
    await mkdir(path.join(dir, 'packages'), { recursive: true });
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-validate-command-outside-'));
    await symlink(outsideDir, path.join(dir, 'packages', 'mfe'));

    const result = await validateCommand(
      dir,
      createFsReadFileFn(),
      createFsListPayloadFilesFn(),
      createFsResolveDeclaredExclusionFn(),
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/manifest validation failed/i);
    expect(result.message).toContain('excludedSubtrees[0]');
  });

  it('accepts a BOM-prefixed tsconfig.json carrier that is otherwise valid JSONC', async () => {
    const dir = await makeTemplate();
    // A leading UTF-8 byte-order mark, written via fs like a real editor
    // would leave it, not simulated through a fixture-file trick.
    await writeFile(path.join(dir, 'tsconfig.json'), '﻿{ "compilerOptions": { "strict": true } }');

    const result = await validateCommand(
      dir,
      createFsReadFileFn(),
      createFsListPayloadFilesFn(),
      createFsResolveDeclaredExclusionFn(),
    );

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('refuses with exit 1 when the payload carries an escaping package.json file: specifier', async () => {
    const dir = await makeTemplate();
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:../../packages/api' } }),
    );

    const result = await validateCommand(
      dir,
      createFsReadFileFn(),
      createFsListPayloadFilesFn(),
      createFsResolveDeclaredExclusionFn(),
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/not self-contained/i);
  });

  // inst-csc-if-reserved-name / inst-csc-add-reserved-name-violation, proven
  // against the REAL `createFsListPayloadFilesFn` enumeration - the fake-
  // based coverage in manifest-content-self-containment.test.ts proves the
  // check's logic; this proves the real adapter actually hands it a payload
  // path shaped this way.
  it('refuses with exit 1 when the payload carries a file matching the reserved temporary-file naming convention', async () => {
    const dir = await makeTemplate();
    await writeFile(path.join(dir, 'app.ts.frontx-upgrade-tmp'), 'stray content left by a crashed upgrade');

    const result = await validateCommand(
      dir,
      createFsReadFileFn(),
      createFsListPayloadFilesFn(),
      createFsResolveDeclaredExclusionFn(),
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('app.ts.frontx-upgrade-tmp');
    expect(result.message).toMatch(/reserved temporary-file naming convention/i);
  });
});

describe('single authoritative description', () => {
  // cpt-frontx-dod-template-manifest-single-description
  it('the same four-field shape validated is what validate/install/assembly consume', () => {
    // structural: validateManifestContract accepts raw and the same
    // TemplateManifest shape (name, version, excludedSubtrees, description)
    // is returned by readManifestFromContent on success — no divergent or
    // partial descriptor exists.
    const result = validateManifestContract(validManifest());
    expect(result.status).toBe('VALIDATED');

    const read = readManifestFromContent(validManifest());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(Object.keys(read.manifest).sort()).toEqual(['description', 'excludedSubtrees', 'name', 'version']);
  });
});

describe('readManifestFromContent — bundle envelope unwrap', () => {
  // Discovered while proving the TEST-ONLY offline local-fetch adapter
  // (packages/cli/src/adapters/local-fetch.ts) assembles a real multi-file
  // template end-to-end: every real fetch result (the GitHub adapter's
  // tarball unpack, and this TEST-ONLY local-directory adapter) returns the
  // `{ "$frontxTemplateFiles": { <relative path>: <file text>, ... } }`
  // bundle envelope FsContentStore already materializes to real on-disk
  // files — never a bare manifest string. `readManifestFromContent` is the
  // ONE read path composition/uniform-apply/materialize all call on
  // `InventoryEntry.content`, so it must transparently unwrap that envelope
  // down to its manifest file before validating — the single authoritative
  // description (cpt-frontx-dod-template-manifest-single-description) is
  // unaffected either way.
  it('unwraps a $frontxTemplateFiles bundle envelope to its frontx-template.json entry before validating', () => {
    const manifest = validManifest();
    const bundle = JSON.stringify({
      $frontxTemplateFiles: { 'frontx-template.json': manifest, 'src/index.ts': 'export {};' },
    });

    const result = readManifestFromContent(bundle);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.name).toBe('my-tpl');
  });

  it('still reads a bare (non-bundle) manifest string exactly as before — legacy single-file content is unaffected', () => {
    const manifest = validManifest();

    const result = readManifestFromContent(manifest);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.name).toBe('my-tpl');
  });

  it('rejects with a clear violation when a bundle envelope has no frontx-template.json entry', () => {
    const bundle = JSON.stringify({ $frontxTemplateFiles: { 'src/index.ts': 'export {};' } });

    const result = readManifestFromContent(bundle);

    expect(result.ok).toBe(false);
  });
});

describe('readManifestFromContent — refuseLegacyManifest wiring', () => {
  // Checkpoint 3+4: `refuseLegacyManifest` (built and tested in an earlier
  // checkpoint) is now wired into the single read path every manifest-
  // reading command shares, so a legacy manifest is refused with the
  // SPECIFIC INVALID_MANIFEST code and every undeclared field named — never
  // the generic four-field-contract violation it would otherwise trip
  // (e.g. "excludedSubtrees is required"), which would name the wrong
  // reason and give the template author the wrong instruction to act on.
  it('refuses a legacy manifest with INVALID_MANIFEST naming every undeclared field, not the generic contract violation', () => {
    const legacy = JSON.stringify({
      name: 'my-tpl',
      version: '1.0.0',
      schemaVersion: '1.0',
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
      description: 'Establishes the project shell.',
    });

    const result = readManifestFromContent(legacy);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_MANIFEST');
    expect(result.undeclaredFields).toEqual(
      expect.arrayContaining(['schemaVersion', 'ownershipBoundaries', 'ownershipBoundaries.exclusiveSubtrees', 'ownershipBoundaries.sharedFiles']),
    );
    // Never the generic contract message this manifest would ALSO trip
    // (its excludedSubtrees is absent) — the legacy refusal takes priority
    // and names the real reason instead.
    expect(result.message).not.toMatch(/excludedSubtrees is required/i);
  });

  it('a current four-field manifest passes through readManifestFromContent unaffected by the legacy check', () => {
    const result = readManifestFromContent(validManifest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.name).toBe('my-tpl');
  });

  it('a legacy manifest reached through a bundle envelope is still refused after unwrapping', () => {
    const legacy = JSON.stringify({
      name: 'my-tpl',
      version: '1.0.0',
      excludedSubtrees: [],
      description: 'Establishes the project shell.',
      referencedTemplates: [{ ref: 'github:acme/mfe@v1' }],
    });
    const bundle = JSON.stringify({ $frontxTemplateFiles: { 'frontx-template.json': legacy } });

    const result = readManifestFromContent(bundle);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_MANIFEST');
    expect(result.undeclaredFields).toEqual(['referencedTemplates']);
  });
});
