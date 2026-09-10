// @cpt-algo:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1
import { describe, expect, it, vi } from 'vitest';
import { materializeOrRemoveAiBundle } from '../scaffold/ai-bundle';
import type { BundleExistsFn, CopyBundleFn, RemoveBundleFn } from '../scaffold/ai-bundle';

function fakeExists(present: boolean): BundleExistsFn {
  return vi.fn(async () => present);
}

describe('materializeOrRemoveAiBundle', () => {
  it('copies the bundle when this call just gave the name its first target and a bundle is present', async () => {
    const bundleExists = fakeExists(true);
    const copyBundle: CopyBundleFn = vi.fn(async () => undefined);
    const removeBundle: RemoveBundleFn = vi.fn(async () => undefined);

    const outcome = await materializeOrRemoveAiBundle({
      manifestName: '@acme/my-template',
      transition: { kind: 'FIRST_TARGET_GAINED', installedContentPath: '/inventory/@acme/my-template' },
      projectRoot: '/project',
      bundleExists,
      copyBundle,
      removeBundle,
    });

    expect(outcome).toBe('materialized');
    expect(bundleExists).toHaveBeenCalledWith('/inventory/@acme/my-template', '@acme/my-template');
    expect(copyBundle).toHaveBeenCalledWith('/inventory/@acme/my-template', '/project', '@acme/my-template');
    expect(removeBundle).not.toHaveBeenCalled();
  });

  it('is a no-op when the first target trigger holds but the payload carries no bundle', async () => {
    const bundleExists = fakeExists(false);
    const copyBundle: CopyBundleFn = vi.fn(async () => undefined);
    const removeBundle: RemoveBundleFn = vi.fn(async () => undefined);

    const outcome = await materializeOrRemoveAiBundle({
      manifestName: '@acme/my-template',
      transition: { kind: 'FIRST_TARGET_GAINED', installedContentPath: '/inventory/@acme/my-template' },
      projectRoot: '/project',
      bundleExists,
      copyBundle,
      removeBundle,
    });

    expect(outcome).toBe('no-op');
    expect(copyBundle).not.toHaveBeenCalled();
    expect(removeBundle).not.toHaveBeenCalled();
  });

  it('removes the bundle when this call just removed the name\'s last remaining target and the bundle exists', async () => {
    const bundleExists = fakeExists(true);
    const copyBundle: CopyBundleFn = vi.fn(async () => undefined);
    const removeBundle: RemoveBundleFn = vi.fn(async () => undefined);

    const outcome = await materializeOrRemoveAiBundle({
      manifestName: '@acme/my-template',
      transition: { kind: 'LAST_TARGET_LOST' },
      projectRoot: '/project',
      bundleExists,
      copyBundle,
      removeBundle,
    });

    expect(outcome).toBe('removed');
    expect(bundleExists).toHaveBeenCalledWith('/project', '@acme/my-template');
    expect(removeBundle).toHaveBeenCalledWith('/project', '@acme/my-template');
    expect(copyBundle).not.toHaveBeenCalled();
  });

  it('is a no-op when the last target trigger holds but there is nothing to remove', async () => {
    const bundleExists = fakeExists(false);
    const copyBundle: CopyBundleFn = vi.fn(async () => undefined);
    const removeBundle: RemoveBundleFn = vi.fn(async () => undefined);

    const outcome = await materializeOrRemoveAiBundle({
      manifestName: '@acme/my-template',
      transition: { kind: 'LAST_TARGET_LOST' },
      projectRoot: '/project',
      bundleExists,
      copyBundle,
      removeBundle,
    });

    expect(outcome).toBe('no-op');
    expect(removeBundle).not.toHaveBeenCalled();
  });

  it('is a no-op and touches nothing when neither trigger condition holds', async () => {
    const bundleExists: BundleExistsFn = vi.fn(async () => true);
    const copyBundle: CopyBundleFn = vi.fn(async () => undefined);
    const removeBundle: RemoveBundleFn = vi.fn(async () => undefined);

    const outcome = await materializeOrRemoveAiBundle({
      manifestName: '@acme/my-template',
      transition: { kind: 'NO_TRANSITION' },
      projectRoot: '/project',
      bundleExists,
      copyBundle,
      removeBundle,
    });

    expect(outcome).toBe('no-op');
    expect(bundleExists).not.toHaveBeenCalled();
    expect(copyBundle).not.toHaveBeenCalled();
    expect(removeBundle).not.toHaveBeenCalled();
  });
});
