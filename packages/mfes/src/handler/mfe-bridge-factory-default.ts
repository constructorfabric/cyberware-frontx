/**
 * Default Bridge Factory Implementation
 *
 * Creates ChildMfeBridgeImpl instances for MfeHandlerMF.
 * Extracted from mf-handler.ts for one-class-per-file cohesion.
 *
 * @packageDocumentation
 */

import { MfeBridgeFactory } from './types';
import { ChildMfeBridgeImpl } from '../bridge/ChildMfeBridge';

/**
 * Default bridge factory - creates ChildMfeBridgeImpl instances.
 * Uses the concrete ChildMfeBridgeImpl class to avoid unsafe casts.
 */
export class MfeBridgeFactoryDefault extends MfeBridgeFactory<ChildMfeBridgeImpl> {
  create(domainId: string, _entryTypeId: string, instanceId: string): ChildMfeBridgeImpl {
    return new ChildMfeBridgeImpl(domainId, instanceId);
  }

  dispose(bridge: ChildMfeBridgeImpl): void {
    bridge.destroy();
  }
}
