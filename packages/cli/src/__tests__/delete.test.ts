// @cpt-flow:cpt-frontx-flow-cli-scaffolding-delete-target:p1
// @cpt-state:cpt-frontx-state-cli-scaffolding-delete-op:p1
import { describe, expect, it, vi } from 'vitest';
import { deleteTarget } from '../commands/delete';
import type { ConfirmDeletionFn } from '../commands/delete';
import type { DeletePlanInventoryPort, ListTargetFilesFn, ListUnenumerableTargetEntriesFn } from '../scaffold/delete-plan';
import { InventoryState } from '../inventory/types';
import type { InventoryEntry } from '../inventory/types';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { ProjectStateDocument, ReadProjectStateFn, WriteProjectStateFn, TemplateEntry } from '../project-state/types';
import type { ReadFileFn } from '../manifest/types';
import type { AssertPathWithinRootFn } from '../scaffold/types';
import { TargetNotDirectoryError } from '../adapters/fs-project-io';

const identityCanonicalize: CanonicalizeTargetFn = (rawTarget) => rawTarget;

// Every fixture below uses `'/repo'`, a notional root with no real
// filesystem backing — real symlink-escape resolution is not this suite's
// concern, that seam has its own real-fs coverage in `__tests__/fs-
// containment.test.ts` (mirrors this file's own `identityCanonicalize`
// convention for the identical reason).
const noopAssertPathWithinRoot: AssertPathWithinRootFn = () => undefined;

function fakeProjectState(initial: ProjectStateDocument): {
  read: ReadProjectStateFn;
  write: WriteProjectStateFn;
  written: () => ProjectStateDocument;
} {
  let stored = JSON.stringify(initial);
  const write: WriteProjectStateFn = vi.fn(async (_absolutePath, content) => {
    stored = content;
  });
  return {
    read: async () => stored,
    write,
    written: () => JSON.parse(stored) as ProjectStateDocument,
  };
}

function fakeInventory(manifestsByName: Record<string, { excludedSubtrees: string[] }> = {}): DeletePlanInventoryPort {
  return {
    lookup: (name: string): InventoryEntry | undefined => {
      const manifest = manifestsByName[name];
      if (!manifest) return undefined;
      return {
        name,
        source: `github:acme/${name}@v1.0.0`,
        ref: 'v1.0.0',
        status: InventoryState.INSTALLED,
        content: JSON.stringify({
          name,
          version: '1.0.0',
          excludedSubtrees: manifest.excludedSubtrees,
          description: 'A template.',
        }),
      };
    },
  };
}

function fakeListTargetFiles(filesByAbsoluteDir: Record<string, string[]>): ListTargetFilesFn {
  return async (absoluteDir: string) => filesByAbsoluteDir[absoluteDir] ?? [];
}

// None of the fixtures below register a `path:` (local) origin, so this
// fake is never actually invoked — kept failing rather than a harmless
// stub so a fixture that starts using a local origin without also wiring a
// real `readFileFn` fails loudly instead of silently re-introducing the
// exact `inventory.lookup`-only bug this checkpoint fixed
// (`scaffold/delete-plan.ts`'s own `inst-dp-compute-ownership` step).
// Every entry a path->content fixture reports is a regular file, so nothing
// inside the target is unenumerable.
const noUnenumerableEntries: ListUnenumerableTargetEntriesFn = async () => [];

const neverCalledReadFileFn: ReadFileFn = async () => {
  throw new Error('readFileFn should not be called for a remote-origin fixture');
};

function fakeRemoveFile(): { remove: (absolutePath: string) => Promise<void>; removed: () => string[] } {
  const removedPaths: string[] = [];
  return {
    remove: async (absolutePath: string) => {
      removedPaths.push(absolutePath);
    },
    removed: () => removedPaths,
  };
}

function neverConfirm(): ConfirmDeletionFn {
  return async () => {
    throw new Error('confirmDeletionFn must not be called in this mode');
  };
}

function fixedConfirm(decision: 'confirmed' | 'declined'): ConfirmDeletionFn {
  return async () => decision;
}

function entry(targets: string[], overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  return { origin: 'github:acme/tmpl@v1', version: '1.0.0', targets, ...overrides };
}

describe('deleteTarget (cpt-frontx-flow-cli-scaffolding-delete-target)', () => {
  it('refuses TARGET_NOT_APPLIED and deletes/reads nothing', async () => {
    const { read, write } = fakeProjectState({ formatVersion: 1, templates: {}, projectOwnedRoots: [] });
    const { remove, removed } = fakeRemoveFile();

    const result = await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: false, dryRun: false, yes: false },
      fakeInventory(),
      identityCanonicalize,
      fakeListTargetFiles({}),
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      neverConfirm(),
    );

    expect(result).toMatchObject({ ok: false, code: 'TARGET_NOT_APPLIED' });
    expect(removed()).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  // The real `createFsListTargetFilesFn` (`../adapters/fs-project-io.ts`)
  // throws this typed error when a registered, applied target's own
  // on-disk location is no longer a directory — modeled here with a fake
  // that throws it, rather than a real filesystem, since this suite's own
  // convention keeps command-level tests fake-backed (the adapter's own
  // real-fs coverage lives in `adapters/__tests__/fs-project-io.test.ts`).
  // `deleteTarget` must convert it to a structured `CONTENT_CONFLICT`
  // refusal — never let it propagate as an uncaught exception, which would
  // reach `cli.ts`'s own top-level catch with no JSON envelope at all.
  it('refuses CONTENT_CONFLICT, naming the target, when the target itself is no longer a directory', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: entry(['packages/app']) },
      projectOwnedRoots: [],
    };
    const { read, write } = fakeProjectState(initialDocument);
    const { remove, removed } = fakeRemoveFile();
    const throwingListTargetFiles: ListTargetFilesFn = async () => {
      throw new TargetNotDirectoryError('/repo/packages/app');
    };

    const result = await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: true, dryRun: false, yes: true },
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      throwingListTargetFiles,
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      neverConfirm(),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'CONTENT_CONFLICT',
      // Project-relative, like every other path this package reports. The
      // adapter's own error carries the absolute path it actually stat'd; the
      // command translates it before it reaches an envelope.
      details: { target: 'packages/app', path: 'packages/app' },
    });
    // Nothing was deleted, and the project state document is untouched — the
    // refusal fired before this call ever reached its own removal or
    // project-state-mutation steps.
    expect(removed()).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  // `--dry-run` reaches the identical `computePlan()` helper, and a shape
  // drift must be caught there too, before this flow ever reports the
  // delete/preserve lists as if the target were enumerable.
  it('also refuses CONTENT_CONFLICT under --dry-run, rather than reporting an empty plan', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: entry(['packages/app']) },
      projectOwnedRoots: [],
    };
    const { read, write } = fakeProjectState(initialDocument);
    const { remove } = fakeRemoveFile();
    const throwingListTargetFiles: ListTargetFilesFn = async () => {
      throw new TargetNotDirectoryError('/repo/packages/app');
    };

    const result = await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: true, dryRun: true, yes: false },
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      throwingListTargetFiles,
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      neverConfirm(),
    );

    expect(result).toMatchObject({ ok: false, code: 'CONTENT_CONFLICT' });
  });

  it('--dry-run reports the plan without deleting or requiring confirmation', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: entry(['packages/app']) },
      projectOwnedRoots: [],
    };
    const { read, write } = fakeProjectState(initialDocument);
    const { remove, removed } = fakeRemoveFile();

    const result = await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: false, dryRun: true, yes: false },
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({ '/repo/packages/app': ['src/index.ts'] }),
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      neverConfirm(),
    );

    expect(result).toMatchObject({ ok: true, outcome: 'dry-run', toDelete: ['packages/app/src/index.ts'] });
    expect(removed()).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  it('--json without --yes returns CONFIRMATION_REQUIRED and never reads stdin or deletes', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: entry(['packages/app']) },
      projectOwnedRoots: [],
    };
    const { read, write } = fakeProjectState(initialDocument);
    const { remove, removed } = fakeRemoveFile();

    const result = await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: true, dryRun: false, yes: false },
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({ '/repo/packages/app': ['src/index.ts'] }),
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      neverConfirm(),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'CONFIRMATION_REQUIRED',
      details: { target: 'packages/app', toDelete: ['packages/app/src/index.ts'], toPreserve: [] },
    });
    expect(removed()).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  it('--json --yes recomputes the plan and deletes, removing the target from targets[]', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: entry(['packages/app', 'packages/other']) },
      projectOwnedRoots: [],
    };
    const { read, write, written } = fakeProjectState(initialDocument);
    const { remove, removed } = fakeRemoveFile();

    const result = await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: true, dryRun: false, yes: true },
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({ '/repo/packages/app': ['src/index.ts'] }),
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      neverConfirm(),
    );

    expect(result).toMatchObject({
      ok: true,
      outcome: 'deleted',
      templateName: 'appTemplate',
      wasLastTarget: false,
      toDelete: ['packages/app/src/index.ts'],
    });
    expect(removed()).toEqual(['/repo/packages/app/src/index.ts']);
    expect(written().templates.appTemplate.targets).toEqual(['packages/other']);
  });

  it('detects wasLastTarget when the deleted target was the template\'s only one', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: entry(['packages/app']) },
      projectOwnedRoots: [],
    };
    const { read, write, written } = fakeProjectState(initialDocument);
    const { remove } = fakeRemoveFile();
    const removeAiBundle = vi.fn(async () => {});

    const result = await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: true, dryRun: false, yes: true },
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({ '/repo/packages/app': [] }),
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      neverConfirm(),
      removeAiBundle,
    );

    expect(result).toMatchObject({ ok: true, outcome: 'deleted', wasLastTarget: true });
    expect(written().templates.appTemplate.targets).toEqual([]);
    expect(removeAiBundle).toHaveBeenCalledWith('appTemplate');
  });

  it('bundle-cleanup failure after the last target is deleted reports success with a named residue, never ok:false over a completed deletion', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: entry(['packages/app']) },
      projectOwnedRoots: [],
    };
    const { read, write, written } = fakeProjectState(initialDocument);
    const { remove, removed } = fakeRemoveFile();
    const removeAiBundle = vi.fn(async () => {
      throw new Error('".frontx/ai/appTemplate" could not be proven to stay inside the project root.');
    });

    const result = await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: true, dryRun: false, yes: true },
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({ '/repo/packages/app': ['src/index.ts'] }),
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      neverConfirm(),
      removeAiBundle,
    );

    // The envelope reports success: the deletion this call was asked to
    // perform genuinely happened and is genuinely recorded — asserted
    // below against the same fakes' actual state, not just the return
    // value's own claim.
    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'deleted') throw new Error('expected a deleted outcome');
    expect(result.wasLastTarget).toBe(true);
    expect(result.aiBundleResidue).toMatchObject({
      manifestName: 'appTemplate',
      path: '.frontx/ai/appTemplate',
    });
    expect(result.aiBundleResidue?.message).toContain('could not be proven to stay inside the project root');

    // On-disk and project-state outcome actually matches what the envelope
    // claims: the target's files are gone and its entry's targets[] is
    // empty — the residue names ONLY the bundle cleanup, nothing else.
    expect(removed()).toEqual(['/repo/packages/app/src/index.ts']);
    expect(written().templates.appTemplate.targets).toEqual([]);
  });

  it('does not call the optional AI-bundle seam when this was not the last target', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: entry(['packages/app', 'packages/other']) },
      projectOwnedRoots: [],
    };
    const { read, write } = fakeProjectState(initialDocument);
    const { remove } = fakeRemoveFile();
    const removeAiBundle = vi.fn(async () => {});

    await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: true, dryRun: false, yes: true },
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({ '/repo/packages/app': [] }),
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      neverConfirm(),
      removeAiBundle,
    );

    expect(removeAiBundle).not.toHaveBeenCalled();
  });

  it('interactive confirmation deletes on "confirmed"', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: entry(['packages/app']) },
      projectOwnedRoots: [],
    };
    const { read, write, written } = fakeProjectState(initialDocument);
    const { remove, removed } = fakeRemoveFile();

    const result = await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: false, dryRun: false, yes: false },
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({ '/repo/packages/app': ['src/index.ts'] }),
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      fixedConfirm('confirmed'),
    );

    expect(result).toMatchObject({ ok: true, outcome: 'deleted' });
    expect(removed()).toEqual(['/repo/packages/app/src/index.ts']);
    expect(written().templates.appTemplate.targets).toEqual([]);
  });

  it('interactive decline (the default) deletes nothing and leaves project state unchanged', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: entry(['packages/app']) },
      projectOwnedRoots: [],
    };
    const { read, write, written } = fakeProjectState(initialDocument);
    const { remove, removed } = fakeRemoveFile();

    const result = await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: false, dryRun: false, yes: false },
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({ '/repo/packages/app': ['src/index.ts'] }),
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      fixedConfirm('declined'),
    );

    expect(result).toMatchObject({ ok: true, outcome: 'declined' });
    expect(removed()).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    expect(written().templates.appTemplate.targets).toEqual(['packages/app']);
  });

  it('the target `.` (project root) case: a nested other template\'s target and a projectOwnedRoots entry are preserved, never deleted', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: {
        appTemplate: entry(['.']),
        adminTemplate: entry(['admin']),
      },
      projectOwnedRoots: ['docs'],
    };
    const { read, write, written } = fakeProjectState(initialDocument);
    const { remove, removed } = fakeRemoveFile();

    const result = await deleteTarget(
      '.',
      '/repo',
      { jsonMode: true, dryRun: false, yes: true },
      fakeInventory({ appTemplate: { excludedSubtrees: [] }, adminTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({
        '/repo': ['src/index.ts', '.git/config', '.DS_Store', 'Thumbs.db', 'admin/index.ts', 'docs/readme.md'],
      }),
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      noopAssertPathWithinRoot,
      read,
      write,
      neverConfirm(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'deleted') throw new Error('expected a deleted outcome');
    expect(result.toDelete).toEqual(['src/index.ts']);
    expect(removed()).toEqual(['/repo/src/index.ts']);
    expect(written().templates.appTemplate.targets).toEqual([]);
    expect(written().templates.adminTemplate.targets).toEqual(['admin']);
  });

  // Every fixture above passes `noopAssertPathWithinRoot`, which never
  // refuses anything — none of them would notice if `deleteTarget` stopped
  // calling `assertPathWithinRootFn` at all, or stopped honouring its
  // refusal. This case uses a REAL assertion that throws for one specific
  // `toDelete` path (the CONTAINMENT ESCAPE FIX `delete.ts` itself documents
  // — a target directory a developer replaced with a symlink to somewhere
  // outside `/repo` between `apply` and this `delete`), so the suite
  // actually exercises the abort path rather than assuming it exists.
  it('aborts with INVALID_PATH, deleting nothing, when a planned deletion path escapes the project root', async () => {
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: entry(['packages/app']) },
      projectOwnedRoots: [],
    };
    const { read, write, written } = fakeProjectState(initialDocument);
    const { remove, removed } = fakeRemoveFile();
    const throwOnEscapedPath: AssertPathWithinRootFn = (absolutePath) => {
      if (absolutePath.includes('escaped-symlink')) {
        throw new Error(`"${absolutePath}" could not be proven to stay inside the project root.`);
      }
    };

    const result = await deleteTarget(
      'packages/app',
      '/repo',
      { jsonMode: true, dryRun: false, yes: true },
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({ '/repo/packages/app': ['src/index.ts', 'escaped-symlink/data.ts'] }),
      noUnenumerableEntries,
      neverCalledReadFileFn,
      remove,
      throwOnEscapedPath,
      read,
      write,
      neverConfirm(),
    );

    expect(result).toMatchObject({ ok: false, code: 'INVALID_PATH' });
    // Fail-closed for the WHOLE plan, not just the offending path: the
    // legitimate `src/index.ts` entry is left alone too, and the project
    // state document is untouched.
    expect(removed()).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    expect(written().templates.appTemplate.targets).toEqual(['packages/app']);
  });
});
