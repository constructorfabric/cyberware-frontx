// @cpt-flow:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1
import { describe, it, expect, vi } from 'vitest';
import { createFsBackedDiscoveryHook, type FsExtensionDiscovery } from '../fs-hook';
import { installCommand } from '../../commands/install';
import { TemplateInventory } from '../../inventory/TemplateInventory';
import type { FetchFn } from '../../resolver/types';
import type { DiscoveryHookContext } from '../types';
import type { TemplateManifest } from '../../manifest/types';

// A contract-valid manifest, serialized to the string a `FetchFn` returns.
// "widget-kit" is deliberately different from the repository segment
// ("my-template" in the spec below), so a content root built from the
// repository name would miss the bundle anchor and surface as `errorCount: 1`.
function manifestContent(name: string, version = '1.0.0'): string {
  const manifest: TemplateManifest = {
    name,
    version,
    excludedSubtrees: [],
    description: 'Fixture template for discovery-hook wiring tests.',
  };
  return JSON.stringify(manifest);
}

function makeSuccessFetch(content: string = manifestContent('widget-kit')): FetchFn {
  return vi.fn().mockResolvedValue(content);
}

describe('createFsBackedDiscoveryHook (CLI <-> fs-discovery wiring, zero compile-time CLI->kit coupling)', () => {
  it('resolves the installed template content root and delegates the .frontx/ai/ scan to the injected discovery', async () => {
    const discover = vi.fn().mockResolvedValue({ errorCount: 2 });
    const discovery: FsExtensionDiscovery = { discover };
    const resolveContentRoot = vi.fn((context: DiscoveryHookContext) => `installed-templates/${context.name}`);

    const hook = createFsBackedDiscoveryHook(resolveContentRoot, discovery);
    const result = await hook({ name: 'my-template', ref: 'v1.0.0' });

    expect(resolveContentRoot).toHaveBeenCalledWith({ name: 'my-template', ref: 'v1.0.0' });
    expect(discover).toHaveBeenCalledWith('installed-templates/my-template');
    expect(result).toEqual({ triggered: true, errorCount: 2 });
  });

  it('is wired end-to-end through installCommand: a successful install triggers the fs-backed hook', async () => {
    const inventory = new TemplateInventory();
    const fetch = makeSuccessFetch();

    // A minimal in-process fs-shaped discovery: proves the hook's wiring
    // contract works with any conforming implementation (e.g. the kit's
    // real discoverAndActivateFromInstalledTemplateFs), without the CLI
    // importing the kit package anywhere in this file.
    const bundleAnchors: Record<string, { entries: unknown[] }> = {
      'installed-templates/widget-kit': { entries: [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1' }] },
    };
    const discovery: FsExtensionDiscovery = {
      discover: (contentRoot: string) => {
        const anchor = bundleAnchors[contentRoot];
        return { errorCount: anchor ? 0 : 1 };
      },
    };
    const hook = createFsBackedDiscoveryHook((context) => `installed-templates/${context.name}`, discovery);

    const result = await installCommand('github:acme/my-template@v1.0.0', inventory, fetch, hook);

    expect(result.ok).toBe(true);
    expect(result.discovery).toEqual({ triggered: true, errorCount: 0 });
  });
});
