/**
 * DefaultExtensionMounter - Concrete per-domain mount facade
 *
 * Composes `MountManager` (MFE load/mount/unmount primitives) and an
 * `ExtensionManager` reference (for mount-set bookkeeping) to implement the
 * per-domain `ExtensionMounter` contract.
 *
 * One instance is constructed by the registry per registered domain inside
 * `registerDomain` and exposed to the domain implementation via
 * `DomainContext.mounter`. The React `ExtensionDomainSlot` accesses this
 * instance via `registry.getMounter(domainId)`.
 *
 * @packageDocumentation
 * @internal
 */

import { ExtensionMounter } from './ExtensionMounter';
import type { MountManager } from './mount-manager';
import type { ContainerHooks } from './mount-strategy';

/**
 * @internal
 */
export class DefaultExtensionMounter extends ExtensionMounter {
  private attachedRoot: Element | null = null;

  // Tracks the per-extension containers so detach can remove them from root.
  private readonly containers = new Map<string, Element>();

  /**
   * The in-flight `mount()` call for an extension currently being mounted,
   * keyed by extension id, together with the container that call was given.
   * A second concurrent `mount()` call for the same extension id AND THE
   * SAME container object awaits the first's promise instead of running the
   * mount pipeline (and appending a second, duplicate container) a second
   * time.
   *
   * `container` is never supplied by an external caller or action payload —
   * every mount strategy creates it internally via `this.hooks.create(extensionId)`
   * before calling `mounter.mount(extensionId, container)`. So a second
   * concurrent call for the same extension id with a DIFFERENT container can
   * only mean a bug in the calling strategy's own internal state management
   * (e.g. it created a container twice for what it thought were two mounts
   * of the same extension). That is not a legitimate case to route around
   * gracefully — see the hard invariant check in `mount()` below.
   */
  private readonly inFlightMountsByExtension = new Map<string, { promise: Promise<void>; container: Element }>();

  constructor(
    private readonly domainId: string,
    private readonly mountManager: MountManager,
    private readonly addMountedExtension: (domainId: string, extensionId: string) => void,
    private readonly removeMountedExtension: (domainId: string, extensionId: string) => void,
    private readonly getMountedExtensions: (domainId: string) => readonly string[],
    // hooks is used in detach() to destroy containers for each extension
    private readonly hooks: ContainerHooks
  ) {
    super();
  }

  attach(root: Element): void {
    this.attachedRoot = root;
  }

  async detach(): Promise<void> {
    // Mass-unmount every currently-mounted extension so the registry and
    // any framework slice stay consistent.
    const mounted = Array.from(this.getMountedExtensions(this.domainId));
    for (const extId of mounted) {
      await this.mountManager.unmountExtension(extId);
      this.hooks.destroy(extId);
      this.containers.delete(extId);
    }
    this.attachedRoot = null;
  }

  async mount(extensionId: string, container: Element): Promise<void> {
    if (!this.attachedRoot) {
      throw new Error(
        `ExtensionMounter.mount: no root attached for domain '${this.domainId}'. ` +
        'Call attach(element) before mounting extensions.'
      );
    }

    const inFlight = this.inFlightMountsByExtension.get(extensionId);
    if (inFlight) {
      if (inFlight.container !== container) {
        // Impossible in correct code: no caller of `mount()` ever supplies a
        // container from outside this mounter's own strategy — it is always
        // freshly created via `hooks.create(extensionId)` immediately before
        // this call. Two different containers for the same extension id
        // while a mount is in flight means the calling strategy's own state
        // tracking is broken (e.g. it invoked `mount()` twice for what it
        // believed were two distinct mounts of the same extension). This is
        // a hard internal-invariant violation, not a race to handle
        // gracefully — no cleanup of the mismatched container is performed.
        throw new Error(
          `ExtensionMounter.mount: internal invariant violated for extension ` +
          `'${extensionId}' in domain '${this.domainId}' — a mount is already ` +
          'in flight for this extension with a DIFFERENT container. This ' +
          'indicates a bug in the calling mount strategy, not a legitimate ' +
          'concurrent-mount scenario.'
        );
      }
      return inFlight.promise;
    }

    const mountWork = (async (): Promise<void> => {
      await this.mountManager.mountExtension(extensionId, container);

      // Append the container under the attached root and record it.
      // Capture the root after the await completes and check it explicitly,
      // since a concurrent detach() call could have cleared it during the await.
      const root = this.attachedRoot;
      if (!root) {
        throw new Error(
          `ExtensionMounter.mount: domain '${this.domainId}' root was detached ` +
          `during mounting of extension '${extensionId}'. The domain's root element ` +
          'must remain attached for the entire duration of the mount operation.'
        );
      }

      root.appendChild(container);
      this.containers.set(extensionId, container);

      this.addMountedExtension(this.domainId, extensionId);
    })();

    this.inFlightMountsByExtension.set(extensionId, { promise: mountWork, container });
    try {
      await mountWork;
    } finally {
      this.inFlightMountsByExtension.delete(extensionId);
    }
  }

  async unmount(extensionId: string): Promise<void> {
    await this.mountManager.unmountExtension(extensionId);

    // Remove the container from the attached root if still present.
    const container = this.containers.get(extensionId);
    if (container && this.attachedRoot) {
      if (this.attachedRoot.contains(container)) {
        this.attachedRoot.removeChild(container);
      }
    }
    this.containers.delete(extensionId);

    this.removeMountedExtension(this.domainId, extensionId);
  }
}
