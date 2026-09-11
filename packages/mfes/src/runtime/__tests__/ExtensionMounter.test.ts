import { describe, it, expect, vi } from 'vitest';
import { DefaultExtensionMounter } from '../DefaultExtensionMounter';
import { ExtensionMounter } from '../ExtensionMounter';
import { MountManager } from '../mount-manager';
import type { ContainerHooks } from '../mount-strategy';
import type { ParentMfeBridge } from '../../handler/types';

// ─── Fakes ───────────────────────────────────────────────────────────────────

class FakeMountManager extends MountManager {
  readonly mountCalls: Array<{ extensionId: string; container: Element }> = [];
  readonly unmountCalls: string[] = [];

  async loadExtension(_extensionId: string): Promise<void> {}
  async preloadExtension(_extensionId: string): Promise<void> {}

  async mountExtension(extensionId: string, container: Element): Promise<ParentMfeBridge> {
    this.mountCalls.push({ extensionId, container });
    return { instanceId: extensionId, dispose: () => {} };
  }

  async unmountExtension(extensionId: string): Promise<void> {
    this.unmountCalls.push(extensionId);
  }

  releaseExtension(_extensionId: string): void {}

  setTheme(_cssVars: Record<string, string>): void {}
}

class TrackingHooks implements ContainerHooks {
  readonly created: string[] = [];
  readonly destroyed: string[] = [];

  create(extensionId: string): Element {
    this.created.push(extensionId);
    return document.createElement('div');
  }

  destroy(extensionId: string): void {
    this.destroyed.push(extensionId);
  }
}

// ─── Helper factory ───────────────────────────────────────────────────────────

function makeFixture(overrides?: { mountManager?: MountManager }) {
  const DOMAIN = 'test-domain';
  const mountManager = overrides?.mountManager ?? new FakeMountManager();
  const addMountedExtension = vi.fn<(domainId: string, extensionId: string) => void>();
  const removeMountedExtension = vi.fn<(domainId: string, extensionId: string) => void>();
  const mounted: string[] = [];
  const getMountedExtensions = (_domainId: string): readonly string[] => mounted;
  const hooks = new TrackingHooks();

  const mounter = new DefaultExtensionMounter(
    DOMAIN,
    mountManager,
    addMountedExtension,
    removeMountedExtension,
    getMountedExtensions,
    hooks
  );

  const root = document.createElement('div');
  document.body.appendChild(root);

  return { DOMAIN, mounter, mountManager, addMountedExtension, removeMountedExtension, mounted, hooks, root };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DefaultExtensionMounter', () => {
  describe('mount', () => {
    it('appends container under attached root and calls addMountedExtension callback', async () => {
      const { mounter, DOMAIN, root, addMountedExtension } = makeFixture();
      mounter.attach(root);

      const container = document.createElement('div');
      // Use a mount manager that uses the supplied container
      await mounter.mount('ext-1', container);

      expect(root.contains(container)).toBe(true);
      expect(addMountedExtension).toHaveBeenCalledWith(DOMAIN, 'ext-1');
    });

    it('throws when no root attached', async () => {
      const { mounter } = makeFixture();
      // Deliberately NOT calling attach

      await expect(mounter.mount('ext-1', document.createElement('div')))
        .rejects.toThrow(/no root attached/);
    });
  });

  describe('unmount', () => {
    it('removes container from root and calls removeMountedExtension', async () => {
      const { mounter, DOMAIN, root, removeMountedExtension } = makeFixture();
      mounter.attach(root);
      const container = document.createElement('div');
      await mounter.mount('ext-1', container);

      await mounter.unmount('ext-1');

      expect(root.contains(container)).toBe(false);
      expect(removeMountedExtension).toHaveBeenCalledWith(DOMAIN, 'ext-1');
    });

    it('idempotent: unmounting unknown id does not throw', async () => {
      const { mounter, root } = makeFixture();
      mounter.attach(root);

      await expect(mounter.unmount('non-existent')).resolves.not.toThrow();
    });
  });

  describe('detach', () => {
    it('mass-unmounts every currently-mounted extension', async () => {
      const mountManager = new FakeMountManager();
      const DOMAIN = 'det-domain';
      const mounted = ['ext-a', 'ext-b'];
      const getMountedExtensions = (_domainId: string): readonly string[] => [...mounted];
      const addMountedExtension = vi.fn();
      const removeMountedExtension = vi.fn();
      const hooks = new TrackingHooks();

      const mounter = new DefaultExtensionMounter(
        DOMAIN,
        mountManager,
        addMountedExtension,
        removeMountedExtension,
        getMountedExtensions,
        hooks
      );
      const root = document.createElement('div');
      mounter.attach(root);

      await mounter.detach();

      // Both extensions were passed to mountManager.unmountExtension
      expect(mountManager.unmountCalls).toContain('ext-a');
      expect(mountManager.unmountCalls).toContain('ext-b');
    });

    it('can attach again with a fresh root after detach', async () => {
      const { mounter } = makeFixture();
      const root1 = document.createElement('div');
      mounter.attach(root1);
      await mounter.detach();

      const root2 = document.createElement('div');
      // Should not throw
      mounter.attach(root2);

      // mount after re-attach should succeed
      await expect(mounter.mount('ext-x', document.createElement('div'))).resolves.not.toThrow();
    });
  });

  describe('in-flight mount dedup keyed on (extensionId, container)', () => {
    /** Mount manager whose `mountExtension` doesn't resolve until `release()` is called. */
    class DeferredMountManager extends MountManager {
      mountCallCount = 0;
      private release: (() => void) | undefined;
      private readonly gate = new Promise<void>((resolve) => {
        this.release = resolve;
      });

      async loadExtension(_extensionId: string): Promise<void> {}
      async preloadExtension(_extensionId: string): Promise<void> {}

      async mountExtension(extensionId: string, _container: Element): Promise<ParentMfeBridge> {
        this.mountCallCount += 1;
        await this.gate;
        return { instanceId: extensionId, dispose: () => {} };
      }

      async unmountExtension(_extensionId: string): Promise<void> {}
      releaseExtension(_extensionId: string): void {}
      setTheme(_cssVars: Record<string, string>): void {}

      settle(): void {
        this.release?.();
      }
    }

    it('same container: two overlapping mount() calls share the one in-flight mount', async () => {
      const mountManager = new DeferredMountManager();
      const { mounter, root } = makeFixture({ mountManager });
      mounter.attach(root);

      const container = document.createElement('div');
      const first = mounter.mount('ext-1', container);
      const second = mounter.mount('ext-1', container);

      mountManager.settle();
      await expect(first).resolves.not.toThrow();
      await expect(second).resolves.not.toThrow();

      expect(mountManager.mountCallCount).toBe(1);
    });

    it('different containers: the second overlapping mount() call throws a hard invariant error', async () => {
      const mountManager = new DeferredMountManager();
      const { mounter, root } = makeFixture({ mountManager });
      mounter.attach(root);

      const containerA = document.createElement('div');
      const containerB = document.createElement('div');
      const first = mounter.mount('ext-1', containerA);

      await expect(mounter.mount('ext-1', containerB)).rejects.toThrow(/ext-1/);

      mountManager.settle();
      await expect(first).resolves.not.toThrow();
    });
  });

  describe('abstract contract', () => {
    it('getMounted is not exposed on the ExtensionMounter abstract class', () => {
      const { mounter } = makeFixture();
      // The abstract base ExtensionMounter defines only attach, detach, mount, unmount.
      const base = mounter as ExtensionMounter;
      expect('getMounted' in base).toBe(false);
    });
  });
});
