// TEST-ONLY — this file carries NO `@cpt` marker and traces to NO FEATURE
// instruction, same as `adapters/__tests__/local-fetch.test.ts`.
//
// This file originally pinned two KNOWN, ALREADY-EXISTING defects in the
// CLI's multi-template path. Both are now fixed and their tests rewritten
// into correctness assertions, per the "when the tracked fix lands"
// instruction below: Fixture 9's provenance-truncation defect by issue #488
// (see its describe block), and Fixture 7's region-union truncation-on-`add`
// defect by issue #487 (`scaffold/compose-shared-files.ts`'s
// carry-forward-from-disk fix — see
// `cpt-frontx-dod-cli-scaffolding-preserve-applied-regions`,
// `architecture/features/cli-scaffolding/FEATURE.md`). Fixture 9 also drives
// the small synthetic `fixture-shell`/`fixture-overlay` templates checked in
// under `__tests__/fixtures/` (the real product templates now live in a
// separate repository).
//
// "Pinning" here means: assert TODAY's (defective) behavior on purpose, so a
// silent regression-in-the-opposite-direction (the defect getting WORSE, or
// disappearing without anyone noticing which fix landed) is caught. When the
// tracked fix for either defect lands, the corresponding test below should
// be rewritten into a real correctness assertion, not deleted.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedRepository } from '../commands/seed-repository';
import { createFsReadTargetDirFn } from '../adapters/fs-target-dir';
import { createFsReadTargetPathStateFn } from '../adapters/fs-target-path';
import { addTemplate } from '../commands/add-template';
import { installCommand } from '../commands/install';
import { createLocalFetchFn } from '../adapters/local-fetch';
import { readProvenanceRecords, createFsReadSingleProvenanceFn, createFsProvenanceWriteFn } from '../adapters/provenance-io';
import {
  createFsReadProjectFileFn,
  createFsRemoveProjectFileFn,
  createFsWriteFileFn,
  createFsWriteProjectFileFn,
} from '../adapters/fs-project-io';
import { TemplateInventory } from '../inventory/TemplateInventory';
import { FsInventoryIndex } from '../adapters/fs-inventory-index';
import { FsContentStore } from '../adapters/fs-content-store';
import { createFsReadContentItemsFn } from '../adapters/fs-read-content-items';
import { upgradeChangeSetReviewApproval } from '../upgrade/flow';
import { MANIFEST_FILENAME } from '../manifest/types';
import type { TemplateManifest } from '../manifest/types';
import type { ContentItem, ReadContentItemsFn } from '../scaffold/types';
import type { ReadProvenanceRecordsFn } from '../scaffold/materialize';
import {
  FIXTURE_SHELL_DIR,
  FIXTURE_SHELL_IDENTITY,
  FIXTURE_OVERLAY_IDENTITY,
  EXCLUDED_DIRS,
  makeTmpDir,
  readManifest,
  setupShellAndOverlayInventory,
} from './helpers/template-split-fixtures';
import type { ShellOverlayHarness } from './helpers/template-split-fixtures';

// Same budget, and for the same reason, as `template-split.e2e.test.ts`: these
// fixtures seed, add and upgrade against real (if small) on-disk fixture
// template trees, so they cost real filesystem work rather than the
// milliseconds vitest's 5s default assumes.
vi.setConfig({ testTimeout: 20_000 });

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

describe('Fixture 7 (F6-fixed, issue #487) — region-union composition reconciles with what is already on disk, regardless of assembly shape', () => {
  const REGION_PATH = 'shared.txt';

  const manifestA: TemplateManifest = {
    schemaVersion: '1.0',
    name: 'region-fixture-a',
    version: '1.0.0',
    ownershipBoundaries: {
      exclusiveSubtrees: [],
      sharedFiles: [{ path: REGION_PATH, mergeStrategy: 'region-union', ownedRegions: ['a'] }],
    },
  };
  const manifestB: TemplateManifest = {
    schemaVersion: '1.0',
    name: 'region-fixture-b',
    version: '1.0.0',
    ownershipBoundaries: {
      exclusiveSubtrees: [],
      sharedFiles: [{ path: REGION_PATH, mergeStrategy: 'region-union', ownedRegions: ['b'] }],
    },
  };
  // Zero-content aggregator whose SOLE purpose is to pull region-fixture-a
  // and region-fixture-b into ONE resolveComposition set, so uniformApply +
  // materializeAssembly run ONCE with BOTH contributions — the "single
  // build" half of this characterization. This mirrors how a real preset
  // would combine templates; #470 defers preset ITSELF (§1.3 of the SSOT),
  // not the underlying `referencedTemplates` composition mechanism this
  // fixture exercises, which is already shipped and covered elsewhere
  // (`composition.test.ts`).
  const manifestBundle: TemplateManifest = {
    schemaVersion: '1.0',
    name: 'region-fixture-bundle',
    version: '1.0.0',
    ownershipBoundaries: { exclusiveSubtrees: [], sharedFiles: [] },
    referencedTemplates: [
      { ref: 'region-fixture-a' },
      { ref: 'region-fixture-b' },
    ],
  };

  const contentA = 'frontx:region region-fixture-a:a\nContent owned by A.\nfrontx:endregion region-fixture-a:a';
  const contentB = 'frontx:region region-fixture-b:b\nContent owned by B.\nfrontx:endregion region-fixture-b:b';

  it('seeded together in ONE assembly: the composed file contains BOTH disjoint region blocks', async () => {
    const inventoryRoot = trackedTmpDir('frontx-split-f7-single-inv-');
    const targetDir = trackedTmpDir('frontx-split-f7-single-target-');
    const aDir = trackedTmpDir('frontx-split-f7-single-a-');
    const bDir = trackedTmpDir('frontx-split-f7-single-b-');
    const bundleDir = trackedTmpDir('frontx-split-f7-single-bundle-');

    const inventory = new TemplateInventory(new FsInventoryIndex(inventoryRoot), new FsContentStore(inventoryRoot));
    fs.writeFileSync(path.join(aDir, MANIFEST_FILENAME), JSON.stringify(manifestA));
    fs.writeFileSync(path.join(aDir, REGION_PATH), contentA);
    fs.writeFileSync(path.join(bDir, MANIFEST_FILENAME), JSON.stringify(manifestB));
    fs.writeFileSync(path.join(bDir, REGION_PATH), contentB);
    fs.writeFileSync(path.join(bundleDir, MANIFEST_FILENAME), JSON.stringify(manifestBundle));

    for (const [spec, dir] of [
      ['local:frontx-fixture/region-fixture-a@offline', aDir],
      ['local:frontx-fixture/region-fixture-b@offline', bDir],
      ['local:frontx-fixture/region-fixture-bundle@offline', bundleDir],
    ] as const) {
      const install = await installCommand(spec, inventory, createLocalFetchFn(dir));
      expect(install.ok, `installing "${spec}"`).toBe(true);
    }

    const lookupFn = (name: string) => inventory.lookup(name);
    const readContentFn = createFsReadContentItemsFn(inventoryRoot);
    const writeFileFn = createFsWriteFileFn();
    const provenanceWriteFn = createFsProvenanceWriteFn();
    const readProjectFileFn = createFsReadProjectFileFn();

    const seedResult = await seedRepository(
      'region-fixture-bundle',
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
    expect(seedResult.appliedTemplates.slice().sort()).toEqual([
      'region-fixture-a',
      'region-fixture-b',
      'region-fixture-bundle',
    ]);

    const composed = fs.readFileSync(path.join(targetDir, REGION_PATH), 'utf-8');
    expect(composed).toContain('frontx:region region-fixture-a:a');
    expect(composed).toContain('frontx:region region-fixture-b:b');
  });

  it('FIXED (issue #487) — seed A, then add B: the file carries BOTH regions; A\'s already-written region-union block survives the add', async () => {
    const inventoryRoot = trackedTmpDir('frontx-split-f7-addflow-inv-');
    const targetDir = trackedTmpDir('frontx-split-f7-addflow-target-');
    const aDir = trackedTmpDir('frontx-split-f7-addflow-a-');
    const bDir = trackedTmpDir('frontx-split-f7-addflow-b-');

    const inventory = new TemplateInventory(new FsInventoryIndex(inventoryRoot), new FsContentStore(inventoryRoot));
    fs.writeFileSync(path.join(aDir, MANIFEST_FILENAME), JSON.stringify(manifestA));
    fs.writeFileSync(path.join(aDir, REGION_PATH), contentA);
    fs.writeFileSync(path.join(bDir, MANIFEST_FILENAME), JSON.stringify(manifestB));
    fs.writeFileSync(path.join(bDir, REGION_PATH), contentB);

    const installA = await installCommand(
      'local:frontx-fixture/region-fixture-a@offline',
      inventory,
      createLocalFetchFn(aDir),
    );
    expect(installA.ok).toBe(true);
    const installB = await installCommand(
      'local:frontx-fixture/region-fixture-b@offline',
      inventory,
      createLocalFetchFn(bDir),
    );
    expect(installB.ok).toBe(true);

    const lookupFn = (name: string) => inventory.lookup(name);
    const listInstalledFn = () => inventory.list();
    const readContentFn = createFsReadContentItemsFn(inventoryRoot);
    const writeFileFn = createFsWriteFileFn();
    const provenanceWriteFn = createFsProvenanceWriteFn();
    const readProvenanceRecordsFn: ReadProvenanceRecordsFn = readProvenanceRecords;
    const readProjectFileFn = createFsReadProjectFileFn();

    const seedResult = await seedRepository(
      'region-fixture-a',
      targetDir,
      lookupFn,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      createFsReadTargetDirFn(),
      readProjectFileFn,
    );
    expect(seedResult.ok).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, REGION_PATH), 'utf-8')).toContain('frontx:region region-fixture-a:a');

    // No conflict is expected here — region-fixture-a and region-fixture-b
    // declare DISJOINT region keys ('a' vs. 'b') on the same shared path, so
    // the pre-flight conflict check correctly passes this add. Issue #487's
    // defect was that materialization, once past that check, only ever
    // looked at what THIS add's own assembly contributes — never at the file
    // `addTemplate` is about to overwrite. Fixed: materialization now reads
    // the file already on disk, recognizes region-fixture-a's block as
    // recorded in this repository's provenance (not a contributor to THIS
    // add, but not unrecorded either), and carries it forward verbatim
    // alongside region-fixture-b's freshly extracted region.
    const addResult = await addTemplate(
      'region-fixture-b',
      targetDir,
      lookupFn,
      listInstalledFn,
      readContentFn,
      writeFileFn,
      readProvenanceRecordsFn,
      provenanceWriteFn,
      createFsReadTargetPathStateFn(),
      readProjectFileFn,
    );
    expect(addResult.ok).toBe(true);

    const composed = fs.readFileSync(path.join(targetDir, REGION_PATH), 'utf-8');
    expect(composed).toContain('frontx:region region-fixture-a:a');
    expect(composed).toContain('frontx:region region-fixture-b:b');
  });
});

describe('Fixture 9 (B1-fix, issue #488) — frontx upgrade preserves multi-record provenance in a shell+mfe repository', () => {
  // The upgrade engine's re-resolved baseline/target entries (via
  // `resolveTemplateAtVersion` -> `resolveToInventory`) are plain in-memory
  // `RESOLVED` entries — unlike `TemplateInventory.install`, they are never
  // written to an installed-content-path on disk, so the disk-backed
  // `createFsReadContentItemsFn` adapter (keyed by that path) cannot serve
  // them. This decodes the SAME `$frontxTemplateFiles` bundle envelope
  // `createLocalFetchFn` returns directly from the entry's in-memory
  // `.content` — the upgrade-engine equivalent of that disk-backed adapter.
  const decodeBundleContentItems: ReadContentItemsFn = async (entry) => {
    const parsed = JSON.parse(entry.content) as { $frontxTemplateFiles: Record<string, string> };
    return Object.entries(parsed.$frontxTemplateFiles).map(([itemPath, content]): ContentItem => ({ path: itemPath, content }));
  };

  /** Seeds shell, adds mfe (2 provenance records), then runs one auto-approved
   * `frontx upgrade` cycle against the shell record — the exact repro sequence
   * B1 names: "seed shell → add mfe → frontx upgrade --yes". Returns the
   * target dir so each `it` can inspect the corrupted result independently
   * (no shared mutable state between tests — order-independent by construction). */
  async function seedAddThenUpgrade(): Promise<{ targetDir: string; shellManifest: TemplateManifest }> {
    harness = await setupShellAndOverlayInventory();
    const targetDir = trackedTmpDir('frontx-split-f9-target-');

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

    const beforeUpgrade = JSON.parse(
      fs.readFileSync(path.join(targetDir, '.frontx', 'provenance.json'), 'utf-8'),
    ) as unknown;
    expect(Array.isArray(beforeUpgrade)).toBe(true);
    expect(beforeUpgrade).toHaveLength(2);

    const shellManifest = readManifest(FIXTURE_SHELL_DIR);

    // `readProvenance` (F11) only ever resolves `records[0]` — the shell
    // record, since seed always writes first — so this is a same-version,
    // effectively no-op upgrade of the FIRST record. That is deliberate: this
    // fixture exercises HOW the provenance file gets rewritten after ANY
    // upgrade, independent of whether the diff itself is empty. Per-template
    // upgrade TARGET selection (choosing to upgrade the mfe record instead)
    // is a separate, not-yet-made design decision — out of scope for #488.
    const upgradeResult = await upgradeChangeSetReviewApproval(targetDir, shellManifest.version, {
      readProvenance: createFsReadSingleProvenanceFn(),
      fetchFn: createLocalFetchFn(FIXTURE_SHELL_DIR, { excludedDirs: EXCLUDED_DIRS }),
      readProjectFile: createFsReadProjectFileFn(),
      readContentItems: decodeBundleContentItems,
      writeProjectFile: createFsWriteProjectFileFn(),
      removeProjectFile: createFsRemoveProjectFileFn(),
      writeProvenance: createFsProvenanceWriteFn(),
      presentAndGetApproval: async () => 'approved', // auto-approve, per task
    });
    expect(upgradeResult.status).toBe('applied');

    return { targetDir, shellManifest };
  }

  it('the provenance SET survives the upgrade (ADR-0021(d)/ADR-0019) — both records remain, only the upgraded record changes version, and the array shape is preserved', async () => {
    const { targetDir, shellManifest } = await seedAddThenUpgrade();

    const afterRaw = fs.readFileSync(path.join(targetDir, '.frontx', 'provenance.json'), 'utf-8');
    const after = JSON.parse(afterRaw) as unknown;

    expect(Array.isArray(after)).toBe(true);
    expect(after).toHaveLength(2);
    // The mfe record's identity string must still be present — not merely
    // "the array has two entries", but genuinely the SAME record, untouched.
    expect(afterRaw).toContain(FIXTURE_OVERLAY_IDENTITY);

    const records = after as Array<{ templateIdentity: string; scaffoldedFromVersion: string }>;
    const shellRecord = records.find((record) => record.templateIdentity === FIXTURE_SHELL_IDENTITY);
    const mfeRecord = records.find((record) => record.templateIdentity === FIXTURE_OVERLAY_IDENTITY);
    expect(shellRecord).toBeDefined();
    expect(mfeRecord).toBeDefined();
    // The upgraded (shell) record reflects the target version this cycle
    // upgraded to; the untouched (mfe) record is not asserted against a
    // specific version — only that it still exists, unmodified in shape.
    expect(shellRecord?.scaffoldedFromVersion).toBe(shellManifest.version);
  });

  it('the NEXT add-template call succeeds against the post-upgrade provenance file — the array shape it left behind is still a valid, readable SET', async () => {
    const { targetDir } = await seedAddThenUpgrade();
    if (!harness) throw new Error('unreachable: seedAddThenUpgrade always sets `harness`');

    const thirdDir = trackedTmpDir('frontx-split-f9-third-');
    fs.writeFileSync(
      path.join(thirdDir, 'frontx-template.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        name: 'frontx-template-third-fixture',
        version: '1.0.0',
        ownershipBoundaries: { exclusiveSubtrees: ['third-fixture/'], sharedFiles: [] },
      }),
    );
    const thirdInstall = await installCommand(
      'local:frontx-fixture/frontx-template-third-fixture@offline',
      harness.inventory,
      createLocalFetchFn(thirdDir),
    );
    expect(thirdInstall.ok).toBe(true);

    const addResult = await addTemplate(
      'frontx-template-third-fixture',
      targetDir,
      harness.lookupFn,
      harness.listInstalledFn,
      harness.readContentFn,
      harness.writeFileFn,
      readProvenanceRecords,
      harness.provenanceWriteFn,
      createFsReadTargetPathStateFn(),
    );
    expect(addResult.ok).toBe(true);

    const afterAdd = JSON.parse(
      fs.readFileSync(path.join(targetDir, '.frontx', 'provenance.json'), 'utf-8'),
    ) as unknown;
    expect(Array.isArray(afterAdd)).toBe(true);
    expect(afterAdd).toHaveLength(3);
  });
});
