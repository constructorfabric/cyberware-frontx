// @cpt-algo:cpt-frontx-algo-cli-scaffolding-delete-plan:p1
//
// Direct coverage for `resolveRegisteredExcludedSubtrees`
// (`../scaffold/registered-manifest.ts`) — until this suite, this module had
// no test file of its own at all; every existing assertion about it was
// indirect, through `delete-plan.test.ts`/`ownership.test.ts`'s own fixtures,
// and NONE of them ever exercised an unreadable manifest (only a genuinely
// absent one, or a fully-populated one). This file pins the one distinction
// this module exists to draw: a genuinely ABSENT manifest resolves to
// `{ known: true, excludedSubtrees: [] }`, but an UNREADABLE one — present,
// but not a regular file — resolves to `{ known: false, cause }` instead of
// either swallowing to `[]` OR throwing itself: every caller decides for
// itself what an unresolved declaration means for it (see the type's own
// doc comment).
import { describe, expect, it } from 'vitest';
import { resolveRegisteredExcludedSubtrees } from '../scaffold/registered-manifest';
import type { RegisteredManifestInventoryPort } from '../scaffold/registered-manifest';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { ReadFileFn } from '../manifest/types';
import { InventoryState } from '../inventory/types';
import type { InventoryEntry } from '../inventory/types';

const identityCanonicalize: CanonicalizeTargetFn = (rawTarget) => rawTarget;

function emptyInventory(): RegisteredManifestInventoryPort {
  return { lookup: () => undefined };
}

function inventoryWith(entries: Record<string, InventoryEntry>): RegisteredManifestInventoryPort {
  return { lookup: (name) => entries[name] };
}

function installedEntry(excludedSubtrees: string[]): InventoryEntry {
  return {
    name: 'tmpl',
    source: 'github:acme/tmpl@v1.0.0',
    ref: 'v1.0.0',
    status: InventoryState.INSTALLED,
    content: JSON.stringify({ name: 'tmpl', version: '1.0.0', excludedSubtrees, description: 'A template.' }),
  };
}

// The real `enoentError` shape every real `ReadFileFn` implementation
// throws for a genuinely absent path (`adapters/fs-project-io.ts`) —
// `.code === 'ENOENT'`, mirrored here rather than imported, since this fake
// stands in for that adapter without depending on it.
function enoentLike(filePath: string): NodeJS.ErrnoException {
  const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

// A stand-in for the real `NotRegularFileError` (`adapters/fs-project-
// io.ts`) — deliberately NOT that exact class, to prove this module's own
// discrimination is structural (anything that is not ENOENT-shaped must
// propagate), never a check for that one specific class by name.
class FakeNotRegularFileError extends Error {
  constructor(filePath: string) {
    super(`"${filePath}" is a directory, not a regular file — refusing to read it.`);
    this.name = 'NotRegularFileError';
  }
}

describe('resolveRegisteredExcludedSubtrees (cpt-frontx-algo-cli-scaffolding-delete-plan)', () => {
  it('resolves a remote (inventory-installed) name\'s declared excludedSubtrees', async () => {
    const readFileFn: ReadFileFn = async () => {
      throw new Error('readFileFn must not be called for a remote-origin name');
    };
    const result = await resolveRegisteredExcludedSubtrees('tmpl', 'github:acme/tmpl@v1.0.0', {
      repoRoot: '/repo',
      inventory: inventoryWith({ tmpl: installedEntry(['docs/']) }),
      readFileFn,
      canonicalizeFn: identityCanonicalize,
    });
    expect(result).toEqual({ known: true, excludedSubtrees: ['docs/'] });
  });

  it('resolves to [] when a remote name has no inventory entry — genuinely ABSENT', async () => {
    const readFileFn: ReadFileFn = async () => {
      throw new Error('readFileFn must not be called for a remote-origin name');
    };
    const result = await resolveRegisteredExcludedSubtrees('tmpl', 'github:acme/tmpl@v1.0.0', {
      repoRoot: '/repo',
      inventory: emptyInventory(),
      readFileFn,
      canonicalizeFn: identityCanonicalize,
    });
    expect(result).toEqual({ known: true, excludedSubtrees: [] });
  });

  it('resolves a local path: origin\'s declared excludedSubtrees, read directly off disk, never through the inventory', async () => {
    const readFileFn: ReadFileFn = async (filePath) => {
      if (filePath === '/repo/vendor/tmpl/frontx-template.json') {
        return JSON.stringify({ name: 'tmpl', version: '1.0.0', excludedSubtrees: ['nested/'], description: 'A local template.' });
      }
      throw enoentLike(filePath);
    };
    const result = await resolveRegisteredExcludedSubtrees('tmpl', 'path:vendor/tmpl', {
      repoRoot: '/repo',
      inventory: emptyInventory(), // deliberately does not know "tmpl" — proves the local-origin read is used
      readFileFn,
      canonicalizeFn: identityCanonicalize,
    });
    expect(result).toEqual({ known: true, excludedSubtrees: ['nested/'] });
  });

  it('resolves to [] when a local path: origin\'s manifest is genuinely ABSENT (ENOENT)', async () => {
    const readFileFn: ReadFileFn = async (filePath) => {
      throw enoentLike(filePath);
    };
    const result = await resolveRegisteredExcludedSubtrees('tmpl', 'path:vendor/tmpl', {
      repoRoot: '/repo',
      inventory: emptyInventory(),
      readFileFn,
      canonicalizeFn: identityCanonicalize,
    });
    expect(result).toEqual({ known: true, excludedSubtrees: [] });
  });

  it('resolves to [] when a local path: origin folder can no longer be proven to stay inside the project root', async () => {
    const readFileFn: ReadFileFn = async () => {
      throw new Error('readFileFn must not be called when canonicalization already fails');
    };
    const escapingCanonicalize: CanonicalizeTargetFn = () => null;
    const result = await resolveRegisteredExcludedSubtrees('tmpl', 'path:vendor/tmpl', {
      repoRoot: '/repo',
      inventory: emptyInventory(),
      readFileFn,
      canonicalizeFn: escapingCanonicalize,
    });
    expect(result).toEqual({ known: true, excludedSubtrees: [] });
  });

  // THE DEFECT this file exists to pin: a manifest that IS there but is not
  // a regular file — a FIFO, a directory, a dangling symlink — is a
  // DIFFERENT fact from absence, and must not be swallowed into `[]`. Nor
  // does this function throw it itself (a regression introduced and closed
  // in a later round: throwing here blocked every OTHER caller's unrelated
  // template too) — it hands the failure back as `{ known: false, cause }`
  // so each caller decides for itself.
  it('resolves to { known: false } (never swallows to [], never throws) when a local path: origin\'s manifest exists but is not a regular file', async () => {
    const unreadable = new FakeNotRegularFileError('/repo/vendor/tmpl/frontx-template.json');
    const readFileFn: ReadFileFn = async () => {
      throw unreadable;
    };
    const result = await resolveRegisteredExcludedSubtrees('tmpl', 'path:vendor/tmpl', {
      repoRoot: '/repo',
      inventory: emptyInventory(),
      readFileFn,
      canonicalizeFn: identityCanonicalize,
    });
    expect(result).toEqual({ known: false, cause: unreadable });
  });

  it('resolves to [] when a local path: origin\'s manifest content fails contract validation', async () => {
    const readFileFn: ReadFileFn = async () =>
      JSON.stringify({ name: 'tmpl', version: '1.0.0', excludedSubtrees: 'not-an-array', description: 'drifted' });
    const result = await resolveRegisteredExcludedSubtrees('tmpl', 'path:vendor/tmpl', {
      repoRoot: '/repo',
      inventory: emptyInventory(),
      readFileFn,
      canonicalizeFn: identityCanonicalize,
    });
    expect(result).toEqual({ known: true, excludedSubtrees: [] });
  });
});
