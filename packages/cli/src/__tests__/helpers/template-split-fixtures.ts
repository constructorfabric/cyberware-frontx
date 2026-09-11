// TEST-ONLY — shared scaffolding for the issue #470 / phase 3 template-split
// fixtures (`template-split.e2e.test.ts`, `template-split.pinning.test.ts`).
// Carries NO `@cpt` marker and traces to NO FEATURE instruction, same as
// `adapters/__tests__/local-fetch.test.ts` (the pattern this module extends):
// it introduces no new product behavior, only test-side plumbing around the
// EXISTING `FetchFn` seam and the EXISTING install/seed/add commands.
//
// SSOT for the fixtures this module supports:
// `.omc/plans/issue-470-boundary-design.md` §0 (facts F1-F18), §5 (risks),
// §6 (fixture definitions).
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

// The real on-disk templates this repository ships post-split (issue #470
// phase 2, already accepted) — the same fixture the P16 final done-gate
// assembles OFFLINE via `createLocalFetchFn` (see `adapters/__tests__/local-fetch.test.ts`).
// One level shallower than that file (`src/__tests__/helpers/` vs.
// `src/adapters/__tests__/`), hence one fewer `../`.
export const TEMPLATE_SHELL_DIR = path.resolve(__dirname, '../../../../../template-shell');
export const TEMPLATE_MFE_DIR = path.resolve(__dirname, '../../../../../template-mfe');

// The manifest-declared identity (`frontx-template.json`'s own `name` field)
// for each real template — this IS the inventory/provenance identity post
// manifest-declared-identity (cpt-frontx-adr-template-manifest-contract), NOT
// the repo segment (`frontx-template-shell`/`frontx-template-mfe`) the
// `local:` source-specs below name.
export const TEMPLATE_SHELL_IDENTITY = '@gears-frontx/frontx-template-shell';
export const TEMPLATE_MFE_IDENTITY = '@gears-frontx/frontx-template-mfe';

// Mirrors `adapters/local-fetch.ts`'s `DEFAULT_EXCLUDED_DIRS` exactly. The two
// sets are restated rather than shared because this one is also the fixtures'
// own real-file oracle, and a fixture that imported the value under test could
// not detect the adapter dropping an entry from it.
//
// `.omc` and `.omo` are the agent session-state directories among them: both
// can exist inside a template source tree during local development (confirmed
// on this checkout: `template-shell/.omc/`,
// `template-shell/src-app/mfe_packages/.omc/`, and `.omo/run-continuation/` at
// the repository root, all untracked). Neither is template content, and left
// unexcluded such a directory both (a) inflates the fixtures' "declared vs. real
// files" oracle with unrelated noise, and (b) has the walk read live session
// files that the agent session running these very tests can be rewriting
// concurrently — a failure that reports as undeclared template content and does
// not reproduce.
//
// Passed explicitly as `createLocalFetchFn`'s `excludedDirs` option (an existing
// extension point, not a change to `local-fetch.ts`) wherever these fixtures
// fetch from `TEMPLATE_SHELL_DIR`/`TEMPLATE_MFE_DIR`, and reused as the same
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
 * documented, deferred risk in the SSOT, not something this fixture set
 * re-litigates). */
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
 * fixtures' two real manifests both declare `sharedFiles: []`, so shared-file
 * membership is out of scope here. */
export function isPathWithinExclusiveSubtrees(relPath: string, exclusiveSubtrees: string[]): boolean {
  return exclusiveSubtrees.some((subtree) => pathWithinSubtree(relPath, subtree));
}

export interface ShellMfeHarness {
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
 * Installs the two REAL on-disk templates (`frontx-template-shell`,
 * `frontx-template-mfe`) OFFLINE, via the same local-fetch + fs-backed
 * inventory adapters `adapters/__tests__/local-fetch.test.ts` uses for one
 * template — into a fresh inventory root, and returns every injected seam a
 * fixture needs to drive `seedRepository`/`addTemplate` against it.
 *
 * Identity is the manifest's own declared `name`
 * (`@gears-frontx/frontx-template-shell`, `@gears-frontx/frontx-template-mfe`
 * — see `template-shell/frontx-template.json` and
 * `template-mfe/frontx-template.json`), NOT the repository segment
 * (`frontx-template-shell`/`frontx-template-mfe`) the `local:` source-spec
 * names below. This superseded the F2 assumption this comment used to make
 * (identity = repo segment) once manifest-declared identity landed
 * (cpt-frontx-adr-template-manifest-contract) — callers must key `lookupFn`
 * and any `seedRepository`/`addTemplate`/provenance assertions by the scoped
 * manifest name, not the bare source-spec segment. Throws on install
 * failure: these two installs are expected to always succeed against this
 * checkout's own shipped templates, so a failure here is a fixture-setup
 * bug, not a scenario under test.
 */
export async function setupShellAndMfeInventory(): Promise<ShellMfeHarness> {
  const inventoryRoot = makeTmpDir('frontx-split-inventory-');
  const inventory = new TemplateInventory(new FsInventoryIndex(inventoryRoot), new FsContentStore(inventoryRoot));

  const shellInstall = await installCommand(
    'local:gears-frontx/frontx-template-shell@offline',
    inventory,
    createLocalFetchFn(TEMPLATE_SHELL_DIR, { excludedDirs: EXCLUDED_DIRS }),
  );
  if (!shellInstall.ok) {
    throw new Error(`fixture setup: installing frontx-template-shell failed: ${shellInstall.message}`);
  }

  const mfeInstall = await installCommand(
    'local:gears-frontx/frontx-template-mfe@offline',
    inventory,
    createLocalFetchFn(TEMPLATE_MFE_DIR, { excludedDirs: EXCLUDED_DIRS }),
  );
  if (!mfeInstall.ok) {
    throw new Error(`fixture setup: installing frontx-template-mfe failed: ${mfeInstall.message}`);
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
