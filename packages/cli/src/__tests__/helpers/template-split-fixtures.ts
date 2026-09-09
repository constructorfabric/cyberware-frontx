// TEST-ONLY — shared scaffolding for the multi-template e2e/pinning fixtures
// (`template-split.e2e.test.ts`, `template-split.pinning.test.ts`). Carries
// NO `@cpt` marker and traces to NO FEATURE instruction, same as
// `adapters/__tests__/local-fetch.test.ts` (the pattern this module extends):
// it introduces no new product behavior, only test-side plumbing around the
// EXISTING `FetchFn` seam and the EXISTING install/seed/add commands.
//
// The templates these fixtures install are small, self-contained, SYNTHETIC
// fixtures checked in under `__tests__/fixtures/` — `fixture-shell/` (a
// self-contained template that claims a root `package.json`) and
// `fixture-overlay/` (an add-only overlay with NO `package.json` in its
// ownership boundaries) — not the real product templates, which now live in
// a separate repository.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { joinWithinRoot } from '@gears-frontx/test-support/path-guard';
import { TemplateInventory } from '../../inventory/TemplateInventory';
import { FsInventoryIndex } from '../../adapters/fs-inventory-index';
import { FsContentStore } from '../../adapters/fs-content-store';
import { createFsReadContentItemsFn } from '../../adapters/fs-read-content-items';
import { createFsWriteFileFn } from '../../adapters/fs-project-io';
import { createFsProvenanceWriteFn, readProvenanceRecords } from '../../adapters/provenance-io';
import { createLocalFetchFn } from '../../adapters/local-fetch';
import { installCommand } from '../../commands/install';
import { pathWithinSubtree } from '../../paths/relative-path';
import { MANIFEST_FILENAME } from '../../manifest/types';
import type { TemplateManifest } from '../../manifest/types';
import type { InventoryEntry } from '../../inventory/types';
import type { ReadContentItemsFn, WriteFileFn } from '../../scaffold/types';
import type { ReadProvenanceRecordsFn } from '../../scaffold/materialize';
import type { ProvenanceWriteFn } from '../../provenance/types';

// The two small synthetic fixture templates checked in alongside this file —
// see `__tests__/fixtures/fixture-shell/` and `__tests__/fixtures/fixture-overlay/`.
export const FIXTURE_SHELL_DIR = path.resolve(__dirname, '../fixtures/fixture-shell');
export const FIXTURE_OVERLAY_DIR = path.resolve(__dirname, '../fixtures/fixture-overlay');

// The manifest-declared identity (`frontx-template.json`'s own `name` field)
// for each fixture template — this IS the inventory/provenance identity post
// manifest-declared-identity (cpt-frontx-adr-template-manifest-contract), NOT
// the repo segment (`fixture-shell`/`fixture-overlay`) the `local:`
// source-specs below name. Kept deliberately distinct from the repo segment
// so a caller that keyed lookups by the source-spec segment instead of the
// manifest's declared identity would fail loudly rather than pass by
// coincidence.
export const FIXTURE_SHELL_IDENTITY = '@fixture/shell';
export const FIXTURE_OVERLAY_IDENTITY = '@fixture/overlay';

// Mirrors `adapters/local-fetch.ts`'s `DEFAULT_EXCLUDED_DIRS` exactly. The two
// sets are restated rather than shared because this one is also the fixtures'
// own real-file oracle, and a fixture that imported the value under test could
// not detect the adapter dropping an entry from it.
//
// Passed explicitly as `createLocalFetchFn`'s `excludedDirs` option (an existing
// extension point, not a change to `local-fetch.ts`) wherever these fixtures
// fetch from `FIXTURE_SHELL_DIR`/`FIXTURE_OVERLAY_DIR`, and reused as the same
// exclusion set for the fixtures' own real-file listing so both sides of any
// comparison agree on what "the template's files" means.
export const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-lib',
  'dist-ssr',
  '.git',
  'coverage',
  '.cache',
  '.vite',
  '.mf',
  '.__mf__temp',
  '.omc',
  '.omo',
]);

export function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Reads and parses a template's manifest directly off disk (trusted,
 * source-controlled fixture content — not the validated read path). */
export function readManifest(templateDir: string): TemplateManifest {
  const raw = fs.readFileSync(joinWithinRoot(templateDir, MANIFEST_FILENAME), 'utf-8');
  return JSON.parse(raw) as TemplateManifest;
}

/** Recursively lists every file under `root`, skipping `excludedDirs`,
 * returning repo-relative POSIX-joined paths (`path.join` is POSIX on this
 * checkout's darwin/CI runners — the N3 Windows-separator caveat is a
 * documented, deferred risk, not something this fixture set re-litigates). */
export function listRealFiles(root: string, excludedDirs: Set<string> = EXCLUDED_DIRS, relativeDir = ''): string[] {
  // `relativeDir` accumulates across recursive calls below (each level appends
  // one more real directory-entry name via `path.join`), so by the time it
  // reaches here it is a genuinely dynamic, already-multi-segment relative
  // path — not a set of individually-known segments this call site could
  // hand to `joinWithinRoot(root, ...segments)`. Left as `path.join`: every
  // segment composing it originated from `fs.readdirSync` on `root` itself,
  // not from untrusted input.
  const absoluteDir = path.join(root, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) continue;
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRealFiles(root, excludedDirs, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

/** The exclusive-subtree half of the ownership-boundary content filter
 * `scaffold/assembler.ts`'s (unexported) `isWithinDeclaredBoundaries` applies,
 * so these fixtures can compute a "what should this template materialize"
 * oracle without reaching into that module's private helper. Calls the same
 * `pathWithinSubtree` the assembler calls rather than restating the rule: a
 * restated copy is an oracle that can agree with itself while disagreeing with
 * the code under test. Deliberately narrower than the real function: these
 * fixtures' two manifests both declare `sharedFiles: []`, so shared-file
 * membership is out of scope here. */
export function isPathWithinExclusiveSubtrees(relPath: string, exclusiveSubtrees: string[]): boolean {
  return exclusiveSubtrees.some((subtree) => pathWithinSubtree(relPath, subtree));
}

export interface ShellOverlayHarness {
  inventory: TemplateInventory;
  inventoryRoot: string;
  lookupFn: (name: string) => InventoryEntry | undefined;
  listInstalledFn: () => Promise<InventoryEntry[]>;
  readContentFn: ReadContentItemsFn;
  writeFileFn: WriteFileFn;
  provenanceWriteFn: ProvenanceWriteFn;
  readProvenanceRecordsFn: ReadProvenanceRecordsFn;
  cleanup: () => void;
}

/**
 * Installs the two synthetic fixture templates (`fixture-shell`,
 * `fixture-overlay`) OFFLINE, via the same local-fetch + fs-backed inventory
 * adapters `adapters/__tests__/local-fetch.test.ts` uses for one template —
 * into a fresh inventory root, and returns every injected seam a fixture
 * needs to drive `seedRepository`/`addTemplate` against it.
 *
 * Identity is the manifest's own declared `name`
 * (`@fixture/shell`, `@fixture/overlay` — see `fixtures/fixture-shell/frontx-template.json`
 * and `fixtures/fixture-overlay/frontx-template.json`), NOT the repo segment
 * (`fixture-shell`/`fixture-overlay`) the `local:` source-specs below name —
 * callers must key `lookupFn` and any `seedRepository`/`addTemplate`/provenance
 * assertions by the scoped manifest name, not the bare source-spec segment.
 * Throws on install failure: these two installs are expected to always
 * succeed against these checked-in fixtures, so a failure here is a
 * fixture-setup bug, not a scenario under test.
 */
export async function setupShellAndOverlayInventory(): Promise<ShellOverlayHarness> {
  const inventoryRoot = makeTmpDir('frontx-split-inventory-');
  const inventory = new TemplateInventory(new FsInventoryIndex(inventoryRoot), new FsContentStore(inventoryRoot));

  const shellInstall = await installCommand(
    'local:fixture-org/fixture-shell@offline',
    inventory,
    createLocalFetchFn(FIXTURE_SHELL_DIR, { excludedDirs: EXCLUDED_DIRS }),
  );
  if (!shellInstall.ok) {
    throw new Error(`fixture setup: installing fixture-shell failed: ${shellInstall.message}`);
  }

  const overlayInstall = await installCommand(
    'local:fixture-org/fixture-overlay@offline',
    inventory,
    createLocalFetchFn(FIXTURE_OVERLAY_DIR, { excludedDirs: EXCLUDED_DIRS }),
  );
  if (!overlayInstall.ok) {
    throw new Error(`fixture setup: installing fixture-overlay failed: ${overlayInstall.message}`);
  }

  return {
    inventory,
    inventoryRoot,
    lookupFn: (name) => inventory.lookup(name),
    listInstalledFn: () => inventory.list(),
    readContentFn: createFsReadContentItemsFn(inventoryRoot),
    writeFileFn: createFsWriteFileFn(),
    provenanceWriteFn: createFsProvenanceWriteFn(),
    readProvenanceRecordsFn: readProvenanceRecords,
    cleanup: () => fs.rmSync(inventoryRoot, { recursive: true, force: true }),
  };
}
