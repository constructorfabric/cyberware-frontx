/**
 * Extension Manager — State Types and Abstract Interface
 *
 * State interfaces and abstract extension manager contract.
 * Extracted from the legacy screensets package in Phase 7 (extension-domain governance).
 *
 * @packageDocumentation
 * @internal
 */

import type { ExtensionDomain, Extension, MfeEntry } from '../types';
import type { ParentMfeBridge, ChildMfeBridge } from '../handler/types';
import type { ExtensionMounter } from './ExtensionMounter';
import type { DomainLifecycleTrigger } from './DomainLifecycleTrigger';
import type { ExtensionDomainImplementation } from './ExtensionDomainImplementation';

/**
 * State for a registered extension domain.
 * INTERNAL: Used by ActionsChainsMediator for domain resolution.
 */
export interface ExtensionDomainState {
  domain: ExtensionDomain;
  properties: Map<string, unknown>;
  extensions: Set<string>;
  propertySubscribers: Map<string, Set<(propertyTypeId: string, value: unknown) => void>>;
  /** Insertion-ordered list of currently-mounted extension IDs for this domain. */
  mountedExtensions: string[];
  /** Per-domain mount facade; null until set by setDomainImplementation. */
  mounter: ExtensionMounter | null;
  /** Per-domain lifecycle trigger; null until set by setDomainImplementation. */
  lifecycleTrigger: DomainLifecycleTrigger | null;
  /** Domain implementation instance; null until set by setDomainImplementation. */
  implementation: ExtensionDomainImplementation | null;
}

/**
 * State for a registered extension.
 */
export interface ExtensionState {
  extension: Extension;
  entry: MfeEntry;
  /** Retained for the extension's whole registration lifetime — released only by `releaseExtension`. */
  bridge: ParentMfeBridge | null;
  /** Retained for the extension's whole registration lifetime — released only by `releaseExtension`. */
  childBridge: ChildMfeBridge | null;
  loadState: 'idle' | 'loading' | 'loaded' | 'error';
  mountState: 'unmounted' | 'mounting' | 'mounted' | 'error';
  container: Element | null;
  lifecycle: import('../handler/types').MfeEntryLifecycle<import('../handler/types').ChildMfeBridge> | null;
  error?: Error;
  /** Shadow root created during mount (default handler flow) */
  shadowRoot?: ShadowRoot;
}

export type LifecycleTriggerCallback = (extensionId: string, stageId: string) => Promise<void>;
export type DomainLifecycleTriggerCallback = (domainId: string, stageId: string) => Promise<void>;

export abstract class ExtensionManager {
  abstract registerDomain(domain: ExtensionDomain): void;
  abstract unregisterDomain(domainId: string): Promise<void>;
  abstract registerExtension(extension: Extension): Promise<void>;
  abstract unregisterExtension(extensionId: string): Promise<void>;
  abstract updateSharedProperty(propertyId: string, value: unknown): void;
  abstract getDomainProperty(domainId: string, propertyTypeId: string): unknown;
  abstract getMountedExtensions(domainId: string): readonly string[];
  abstract addMountedExtension(domainId: string, extensionId: string): void;
  abstract removeMountedExtension(domainId: string, extensionId: string): void;
  abstract setDomainImplementation(
    domainId: string,
    mounter: ExtensionMounter,
    lifecycleTrigger: DomainLifecycleTrigger,
    implementation: ExtensionDomainImplementation
  ): void;
}
