// TEST-ONLY — this file carries NO `@cpt` marker and traces to NO FEATURE
// instruction, same as `adapters/__tests__/local-fetch.test.ts` (the pattern
// it extends to two small synthetic templates instead of one).
//
// First real multi-template run of the offline install/seed/add pipeline,
// exercised against two small, self-contained SYNTHETIC fixture templates
// checked in under `__tests__/fixtures/` (`fixture-shell/`, `fixture-overlay/`)
// rather than the real product templates, which now live in a separate
// repository. Fixtures 7 and 9
// (known-defect pinning, now correctness assertions) live in
// `template-split.pinning.test.ts`.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedRepository } from '../commands/seed-repository';
import { createFsReadTargetDirFn } from '../adapters/fs-target-dir';
import { createFsReadTargetPathStateFn } from '../adapters/fs-target-path';
import { addTemplate } from '../commands/add-template';
import { installCommand } from '../commands/install';
import { createLocalFetchFn } from '../adapters/local-fetch';
import { checkAssemblyConflicts } from '../scaffold/conflict';
import { pathWithinSubtree } from '../paths/relative-path';
import type { ContributionEntry, StagedAssembly } from '../scaffold/types';
import type { ProvenanceRecord } from '../provenance/types';
import {
  FIXTURE_OVERLAY_DIR,
  FIXTURE_OVERLAY_IDENTITY,
  FIXTURE_SHELL_DIR,
  FIXTURE_SHELL_IDENTITY,
  isPathWithinExclusiveSubtrees,
  listRealFiles,
  makeTmpDir,
  readManifest,
  setupShellAndOverlayInventory,
  sha256,
} from './helpers/template-split-fixtures';
import type { ShellOverlayHarness } from './helpers/template-split-fixtures';

// Each fixture here drives the real install/seed/add pipeline across both
// small fixture template trees — reading, hashing and re-materializing every
// declared file — so a fixture can still cost real (if now much smaller)
// filesystem work. The budget is set from the work the fixtures perform, not
// as a retry; a fixture that exceeds it is genuinely stuck rather than merely
// slow.
vi.setConfig({ testTimeout: 20_000 });

// Tracks every tmp dir created by the current test so `afterEach` can sweep
// them regardless of which `it` ran or how it exited — keeps the fixtures
// independent of execution order (no test relies on another's leftovers,
// and none leaks a tmp dir into the next one).
let tmpDirs: string[] = [];
let harness: ShellOverlayHarness | undefined;

function trackedTmpDir(prefix: string): string {
  const dir = makeTmpDir(prefix);
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
  harness?.cleanup();
  harness = undefined;
});

describe('Fixture 1 — union fidelity: seed fixture-shell + add fixture-overlay materializes byte-identical to fixture-shell/ + fixture-overlay/, nothing extra', () => {
  it('every declared file lands byte-for-byte; no extra files besides .frontx/provenance.json; 2 provenance records with the right identities', async () => {
    const shellManifest = readManifest(FIXTURE_SHELL_DIR);
    const overlayManifest = readManifest(FIXTURE_OVERLAY_DIR);
    const shellSourceFiles = listRealFiles(FIXTURE_SHELL_DIR);
    const overlaySourceFiles = listRealFiles(FIXTURE_OVERLAY_DIR);
    const shellDeclared = shellSourceFiles.filter((p) =>
      isPathWithinExclusiveSubtrees(p, shellManifest.ownershipBoundaries.exclusiveSubtrees),
    );
    const overlayDeclared = overlaySourceFiles.filter((p) =>
      isPathWithinExclusiveSubtrees(p, overlayManifest.ownershipBoundaries.exclusiveSubtrees),
    );

    // Sanity precondition: "union fidelity" is only a well-formed question if
    // the two declarations never double-claim the same target path.
    expect(shellDeclared.filter((p) => overlayDeclared.includes(p))).toEqual([]);

    harness = await setupShellAndOverlayInventory();
    const targetDir = trackedTmpDir('frontx-split-f1-target-');

    const seedResult = await seedRepository(
      FIXTURE_SHELL_IDENTITY,
      targetDir,
      harness.lookupFn,
      harness.readContentFn,
      harness.writeFileFn,
      harness.provenanceWriteFn,
      createFsReadTargetDirFn(),
    );
    expect(seedResult.ok).toBe(true);

    const addResult = await addTemplate(
      FIXTURE_OVERLAY_IDENTITY,
      targetDir,
      harness.lookupFn,
      harness.listInstalledFn,
      harness.readContentFn,
      harness.writeFileFn,
      harness.readProvenanceRecordsFn,
      harness.provenanceWriteFn,
      createFsReadTargetPathStateFn(),
    );
    expect(addResult.ok).toBe(true);

    const targetFiles = listRealFiles(targetDir).filter((p) => p !== path.join('.frontx', 'provenance.json'));
    const expectedFiles = [...shellDeclared, ...overlayDeclared].sort();
    expect(targetFiles.sort()).toEqual(expectedFiles);

    for (const relPath of shellDeclared) {
      expect(fs.readFileSync(path.join(targetDir, relPath), 'utf-8'), `shell file "${relPath}"`).toBe(
        fs.readFileSync(path.join(FIXTURE_SHELL_DIR, relPath), 'utf-8'),
      );
    }
    for (const relPath of overlayDeclared) {
      expect(fs.readFileSync(path.join(targetDir, relPath), 'utf-8'), `overlay file "${relPath}"`).toBe(
        fs.readFileSync(path.join(FIXTURE_OVERLAY_DIR, relPath), 'utf-8'),
      );
    }

    const provenance = JSON.parse(
      fs.readFileSync(path.join(targetDir, '.frontx', 'provenance.json'), 'utf-8'),
    ) as ProvenanceRecord[];
    expect(provenance).toHaveLength(2);
    expect(provenance.map((r) => r.templateIdentity)).toEqual([FIXTURE_SHELL_IDENTITY, FIXTURE_OVERLAY_IDENTITY]);
  });
});

describe('Fixture 2 (CLI part) — seed fixture-shell alone into an empty target', () => {
  it('completes ok, touches zero overlay-territory files, writes exactly one provenance record (npm install/type-check is out of scope here)', async () => {
    harness = await setupShellAndOverlayInventory();
    const targetDir = trackedTmpDir('frontx-split-f2-target-');

    const seedResult = await seedRepository(
      FIXTURE_SHELL_IDENTITY,
      targetDir,
      harness.lookupFn,
      harness.readContentFn,
      harness.writeFileFn,
      harness.provenanceWriteFn,
      createFsReadTargetDirFn(),
    );

    expect(seedResult.ok).toBe(true);
    if (!seedResult.ok) return;
    expect(seedResult.appliedTemplates).toEqual([FIXTURE_SHELL_IDENTITY]);

    expect(fs.existsSync(path.join(targetDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'src-app', 'mfe_packages'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, '.frontx', 'ai', '@fixture', 'overlay'))).toBe(false);

    const provenance = JSON.parse(
      fs.readFileSync(path.join(targetDir, '.frontx', 'provenance.json'), 'utf-8'),
    ) as ProvenanceRecord[];
    expect(provenance).toHaveLength(1);
    expect(provenance[0].templateIdentity).toBe(FIXTURE_SHELL_IDENTITY);
  });
});

describe('Fixture 3 — add-only integrity: seed shell, hash every file, add overlay, no shell file changed byte-for-byte', () => {
  it('shell files are untouched by the add; overlay content lands; provenance grows to 2 records', async () => {
    harness = await setupShellAndOverlayInventory();
    const targetDir = trackedTmpDir('frontx-split-f3-target-');

    const seedResult = await seedRepository(
      FIXTURE_SHELL_IDENTITY,
      targetDir,
      harness.lookupFn,
      harness.readContentFn,
      harness.writeFileFn,
      harness.provenanceWriteFn,
      createFsReadTargetDirFn(),
    );
    expect(seedResult.ok).toBe(true);

    // Snapshot every file the seed wrote, EXCLUDING the CLI's own provenance
    // bookkeeping file — going from 1 record to 2 on `add` is the correct,
    // intended behavior (cpt-frontx-dod-composed-provenance-provenance-at-scaffold),
    // not a "shell file changed" regression.
    const provenancePath = path.join('.frontx', 'provenance.json');
    const preAddFiles = listRealFiles(targetDir).filter((p) => p !== provenancePath);
    const preAddHashes = new Map(
      preAddFiles.map((p) => [p, sha256(fs.readFileSync(path.join(targetDir, p), 'utf-8'))]),
    );

    const addResult = await addTemplate(
      FIXTURE_OVERLAY_IDENTITY,
      targetDir,
      harness.lookupFn,
      harness.listInstalledFn,
      harness.readContentFn,
      harness.writeFileFn,
      harness.readProvenanceRecordsFn,
      harness.provenanceWriteFn,
      createFsReadTargetPathStateFn(),
    );
    expect(addResult.ok).toBe(true);

    for (const relPath of preAddFiles) {
      const postHash = sha256(fs.readFileSync(path.join(targetDir, relPath), 'utf-8'));
      expect(postHash, `shell file "${relPath}" must be byte-unchanged after add-overlay`).toBe(preAddHashes.get(relPath));
    }

    expect(fs.existsSync(path.join(targetDir, 'src-app', 'mfe_packages', 'demo-mfe', 'mfe.json'))).toBe(true);

    const provenance = JSON.parse(
      fs.readFileSync(path.join(targetDir, '.frontx', 'provenance.json'), 'utf-8'),
    ) as ProvenanceRecord[];
    expect(provenance).toHaveLength(2);
    expect(provenance.map((r) => r.templateIdentity)).toEqual([FIXTURE_SHELL_IDENTITY, FIXTURE_OVERLAY_IDENTITY]);
  });
});

describe("Fixture 4 — conflict-check: a synthetic 'overlay-dup' contests fixture-overlay's already-occupied ground", () => {
  it('REFUSES the add with zero new files, naming the contested ground and both contestants', async () => {
    harness = await setupShellAndOverlayInventory();
    const targetDir = trackedTmpDir('frontx-split-f4-target-');
    const dupSourceDir = trackedTmpDir('frontx-split-f4-dup-src-');

    const seedResult = await seedRepository(
      FIXTURE_SHELL_IDENTITY,
      targetDir,
      harness.lookupFn,
      harness.readContentFn,
      harness.writeFileFn,
      harness.provenanceWriteFn,
      createFsReadTargetDirFn(),
    );
    expect(seedResult.ok).toBe(true);
    const addResult = await addTemplate(
      FIXTURE_OVERLAY_IDENTITY,
      targetDir,
      harness.lookupFn,
      harness.listInstalledFn,
      harness.readContentFn,
      harness.writeFileFn,
      harness.readProvenanceRecordsFn,
      harness.provenanceWriteFn,
      createFsReadTargetPathStateFn(),
    );
    expect(addResult.ok).toBe(true);

    // Synthetic contestant: a distinct template identity that claims the
    // SAME exclusive subtree fixture-overlay already occupies — a conflict
    // against a REAL applied template, not two hand-rolled unit-test manifests.
    fs.writeFileSync(
      path.join(dupSourceDir, 'frontx-template.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        name: 'fixture-overlay-dup',
        version: '0.1.0-alpha.0',
        ownershipBoundaries: { exclusiveSubtrees: ['src-app/mfe_packages/'], sharedFiles: [] },
      }),
    );
    const dupInstall = await installCommand(
      'local:fixture-org/fixture-overlay-dup@offline',
      harness.inventory,
      createLocalFetchFn(dupSourceDir),
    );
    expect(dupInstall.ok).toBe(true);

    const filesBefore = listRealFiles(targetDir).sort();

    const dupAddResult = await addTemplate(
      'fixture-overlay-dup',
      targetDir,
      harness.lookupFn,
      harness.listInstalledFn,
      harness.readContentFn,
      harness.writeFileFn,
      harness.readProvenanceRecordsFn,
      harness.provenanceWriteFn,
      createFsReadTargetPathStateFn(),
    );

    expect(dupAddResult.ok).toBe(false);
    if (dupAddResult.ok) return;
    expect(dupAddResult.reason).toBe('conflict');
    if (dupAddResult.reason === 'conflict') {
      // Derived from the fixture-overlay manifest itself — same pattern as
      // Fixture 5's shell case below — rather than pinned to a snapshot:
      // fixture-overlay claims two separate exclusive subtrees nested under
      // 'src-app/mfe_packages/', so the dup's one broad claim collides with
      // each of them separately, and a report naming only one would leave the
      // rest for the developer to rediscover.
      const overlaySubtrees = readManifest(FIXTURE_OVERLAY_DIR).ownershipBoundaries.exclusiveSubtrees;
      const swallowed = overlaySubtrees.filter((subtree) =>
        pathWithinSubtree(subtree, 'src-app/mfe_packages/'),
      );
      // A derived oracle with no floor under it would pass against a manifest
      // that had stopped declaring anything under `src-app/mfe_packages/`: an
      // empty expectation matches an empty report, and the multi-conflict
      // property this case exists for would go untested. More than one is the
      // standing fact this fixture's manifest guarantees.
      expect(swallowed.length).toBeGreaterThan(1);
      expect(dupAddResult.conflicts).toEqual(
        swallowed.map((subtree) => ({
          ground: `src-app/mfe_packages/ overlaps ${subtree}`,
          contestants: ['fixture-overlay-dup', FIXTURE_OVERLAY_IDENTITY],
        })),
      );
    }

    expect(listRealFiles(targetDir).sort()).toEqual(filesBefore);
  });
});

describe('Fixture 5 — the conflict check arbitrates nesting and spelling against the fixture-shell declaration', () => {
  // Both cases are read directly from the fixture-shell manifest (not a
  // hand-copied literal) so they track that manifest's actual declared
  // boundary rather than a stale assumption about it, and so the expected
  // conflicts are derived from it rather than pinned to a snapshot a future
  // boundary edit would falsify.
  const shellManifest = readManifest(FIXTURE_SHELL_DIR);
  const shellSubtrees = shellManifest.ownershipBoundaries.exclusiveSubtrees;
  const shellContribution: ContributionEntry = {
    templateName: 'fixture-shell',
    files: [],
    ownershipBoundaries: shellManifest.ownershipBoundaries,
  };

  it('refuses a claim on "src-app/", which contains the shell-owned "src-app/app/", naming every shell subtree it swallows', () => {
    expect(shellSubtrees).toContain('src-app/app/');

    const nestedClaim: ContributionEntry = {
      templateName: 'nested-claim-fixture',
      files: [],
      ownershipBoundaries: { exclusiveSubtrees: ['src-app/'], sharedFiles: [] },
    };
    const assembly: StagedAssembly = { contributions: [shellContribution, nestedClaim] };

    const verdict = checkAssemblyConflicts(assembly, []);

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // Every shell subtree under `src-app/` is its own contested ground: the
    // outer claim collides with each of them separately, and a report naming
    // only the first would leave the rest for the developer to rediscover.
    // The oracle selects them with the same predicate the check uses, so a
    // shell that one day declares `src-app/` itself yields the equal-strings
    // ground rather than an "overlaps" line this test would fail on for the
    // wrong reason.
    expect(verdict.conflicts).toEqual(
      shellSubtrees
        .filter((subtree) => pathWithinSubtree(subtree, 'src-app/'))
        .map((subtree) => ({
          ground: subtree === 'src-app/' ? subtree : `${subtree} overlaps src-app/`,
          contestants: ['fixture-shell', 'nested-claim-fixture'],
        })),
    );
  });

  it('refuses the same ground under a different spelling — a claim on "src" against the shell-owned "src/"', () => {
    expect(shellSubtrees).toContain('src/');

    const misspelledClaim: ContributionEntry = {
      templateName: 'slash-mismatch-fixture',
      files: [],
      ownershipBoundaries: { exclusiveSubtrees: ['src'], sharedFiles: [] },
    };
    const assembly: StagedAssembly = { contributions: [shellContribution, misspelledClaim] };

    const verdict = checkAssemblyConflicts(assembly, []);

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // Exactly one conflict, and specifically not one against `src-app/app/`:
    // the shell's other `src`-prefixed subtrees share a string prefix with the
    // claim without sharing a path segment, so a comparison that refused them
    // too would be refusing assemblies that are actually disjoint.
    expect(verdict.conflicts).toEqual([
      { ground: 'src/ overlaps src', contestants: ['fixture-shell', 'slash-mismatch-fixture'] },
    ]);
  });
});

describe('Fixture 6 — declaration coverage: every file in fixture-shell/ and fixture-overlay/ is declared or explicitly allow-listed', () => {
  it('fixture-shell/: zero files outside the declared boundary and the {frontx-template.json} allow-list', () => {
    const manifest = readManifest(FIXTURE_SHELL_DIR);
    const allowList = new Set(['frontx-template.json']);
    const uncovered = listRealFiles(FIXTURE_SHELL_DIR).filter(
      (p) => !allowList.has(p) && !isPathWithinExclusiveSubtrees(p, manifest.ownershipBoundaries.exclusiveSubtrees),
    );
    expect(uncovered).toEqual([]);
  });

  // The allow-list is the de-facto register of files that live in a template
  // directory WITHOUT being part of the template: authoring and delivery
  // machinery, never shipped. `frontx-template.json` (the manifest itself) and
  // `README.md` are the fixture's own authoring notes; `package.json` /
  // `package-lock.json` stand in for a monorepo build harness that a real
  // split overlay template needs to resolve its own workspace packages in a
  // repo with no workspace root above them, while a seeded project resolves
  // the same names through the shell's root manifest. Contrast fixture-shell,
  // which DECLARES its README.md and package.json and therefore ships them.
  it('fixture-overlay/: zero files outside the declared boundary and the {frontx-template.json, README.md, package.json, package-lock.json} allow-list', () => {
    const manifest = readManifest(FIXTURE_OVERLAY_DIR);
    const allowList = new Set(['frontx-template.json', 'README.md', 'package.json', 'package-lock.json']);
    const uncovered = listRealFiles(FIXTURE_OVERLAY_DIR).filter(
      (p) => !allowList.has(p) && !isPathWithinExclusiveSubtrees(p, manifest.ownershipBoundaries.exclusiveSubtrees),
    );
    expect(uncovered).toEqual([]);
  });

  // Allow-listing only says "ignore this file". This says the stronger thing
  // the harness depends on: an add-only overlay template must never CLAIM a
  // root package.json. Claiming it would collide with the shell's exclusive
  // subtree and turn a development-only file into an ownership assertion —
  // reviving exactly the inferred-ownership model ADR-0031 rejected.
  //
  // The assembler (`isWithinDeclaredBoundaries` in scaffold/assembler.ts)
  // includes a file for exclusiveSubtrees by whole path segments
  // (`pathWithinSubtree`) and for sharedFiles by exact match. Array membership
  // answers neither question: a subtree entry like `'package.json/'`, or a
  // future declaration of a directory that comes to hold these files, captures
  // them without `'package.json'` ever appearing as an element. So
  // exclusiveSubtrees is checked through the same predicate the assembler calls
  // (`isPathWithinExclusiveSubtrees`); sharedFiles stays a plain membership
  // check since that half of the assembler's test really is exact-equality.
  it('fixture-overlay/: the overlay manifest stays undeclared — no claim on package.json or package-lock.json', () => {
    const { exclusiveSubtrees, sharedFiles } = readManifest(FIXTURE_OVERLAY_DIR).ownershipBoundaries;
    const sharedFilePaths = sharedFiles.map((entry: { path: string }) => entry.path);
    expect(isPathWithinExclusiveSubtrees('package.json', exclusiveSubtrees)).toBe(false);
    expect(isPathWithinExclusiveSubtrees('package-lock.json', exclusiveSubtrees)).toBe(false);
    expect(sharedFilePaths).not.toContain('package.json');
    expect(sharedFilePaths).not.toContain('package-lock.json');
  });

  // Negative control for the assertion style above. Array membership calls
  // every one of these declarations safe, because `'package.json'` is never
  // itself an array element — and it is wrong about the last one, which is why
  // the assertion above goes through the real predicate instead:
  //
  //   ['package']        a missing trailing slash, the easy typo for an author
  //                      reaching for "just the packages/ dir". It names a
  //                      directory, and no root file lives inside one.
  //   ['package-']       the same typo one character further along
  //   ['']               an empty declaration addresses no location at all
  //   ['package.json/']  the root file itself, spelled as a directory — the one
  //                      row where membership is wrong and the file IS captured
  //
  // The first three rows are also what pins the segment rule in place: each
  // captures a root package file the moment `pathWithinSubtree` degrades back
  // into a bare string-prefix test.
  it.each([
    { label: 'missing trailing slash', subtrees: ['package'], capturesJson: false, capturesLock: false },
    { label: 'partial prefix', subtrees: ['package-'], capturesJson: false, capturesLock: false },
    { label: 'empty declaration', subtrees: [''], capturesJson: false, capturesLock: false },
    { label: 'the file itself, spelled as a directory', subtrees: ['package.json/'], capturesJson: true, capturesLock: false },
  ])(
    'negative control: exclusiveSubtrees $subtrees ($label) is judged by path segment, not by array membership',
    ({ subtrees, capturesJson, capturesLock }) => {
      // What array membership says: safe. It is not the question the assembler asks.
      expect(subtrees).not.toContain('package.json');
      expect(subtrees).not.toContain('package-lock.json');

      expect(isPathWithinExclusiveSubtrees('package.json', subtrees)).toBe(capturesJson);
      expect(isPathWithinExclusiveSubtrees('package-lock.json', subtrees)).toBe(capturesLock);
    },
  );
});
