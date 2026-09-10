/**
 * Cross-Runtime Action Chain Routing Tests
 *
 * Tests for Phase 22: Cross-Runtime Action Chain Routing
 * Verifies ChildDomainForwardingHandler, child domain registration, and cleanup.
 *
 * Domain and action IDs here are a mock notation rather than the real GTS
 * strings: the bridge treats them as opaque routing keys, and MFES-1 forbids
 * @gears-frontx/mfes from carrying type-format literals at all.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChildMfeBridgeImpl } from '../../src/bridge/ChildMfeBridge';
import { ParentMfeBridgeImpl } from '../../src/bridge/ParentMfeBridge';
import { ChildDomainForwardingHandler } from '../../src/bridge/ChildDomainForwardingHandler';
import { ActionHandler } from '../../src/mediator/types';

describe('Cross-Runtime Action Chain Routing', () => {
  let childBridge: ChildMfeBridgeImpl;
  let parentBridge: ParentMfeBridgeImpl;

  beforeEach(() => {
    childBridge = new ChildMfeBridgeImpl(
      'mock.ext.domain.v1~parent.domain.v1',
      'test-instance'
    );
    parentBridge = new ParentMfeBridgeImpl(childBridge);
    childBridge.setParentBridge(parentBridge);
    // These tests exercise an already-mounted bridge pair; production code
    // reaches this state via `RuntimeBridgeFactory.acquireBridge`, which
    // activates the child bridge as its final step.
    childBridge.activate();
  });

  describe('ChildDomainForwardingHandler', () => {
    it('should forward action to child domain via bridge transport', async () => {
      // Setup: Mock the parent bridge sendActionsChain
      vi.spyOn(parentBridge, 'sendActionsChain').mockResolvedValue(undefined);

      // Create forwarding handler class instance
      const handler = new ChildDomainForwardingHandler(
        parentBridge,
        'mock.ext.domain.v1~child.domain.v1'
      );

      // Act: Handle an action
      await handler.handleAction(
        'mock.ext.action.v1~test.action.v1',
        { foo: 'bar' }
      );

      // Assert: sendActionsChain was called with correct chain
      expect(parentBridge.sendActionsChain).toHaveBeenCalledWith({
        action: {
          type: 'mock.ext.action.v1~test.action.v1',
          target: 'mock.ext.domain.v1~child.domain.v1',
          payload: { foo: 'bar' },
        },
      });
    });

    it('should propagate errors from child domain', async () => {
      // Setup: Mock failed chain result
      const testError = new Error('Test error');
      vi.spyOn(parentBridge, 'sendActionsChain').mockRejectedValue(testError);

      // Create forwarding handler class instance
      const handler = new ChildDomainForwardingHandler(
        parentBridge,
        'mock.ext.domain.v1~child.domain.v1'
      );

      // Act & Assert: Should propagate error
      await expect(
        handler.handleAction(
          'mock.ext.action.v1~test.action.v1',
          undefined
        )
      ).rejects.toThrow('Test error');
    });
  });

  describe('ChildMfeBridgeImpl.registerChildDomain', () => {
    it('should call registered callback and track domain ID', () => {
      // Setup: Mock callbacks
      const registerCallback = vi.fn();
      const unregisterCallback = vi.fn();
      childBridge.setChildDomainCallbacks(registerCallback, unregisterCallback);

      // Act: Register a child domain
      childBridge.registerChildDomain('mock.ext.domain.v1~child.domain.v1');

      // Assert: Callback was called
      expect(registerCallback).toHaveBeenCalledWith('mock.ext.domain.v1~child.domain.v1');
      expect(registerCallback).toHaveBeenCalledTimes(1);
    });

    it('should throw if callback not wired', () => {
      // Act & Assert: Should throw error
      expect(() => {
        childBridge.registerChildDomain('mock.ext.domain.v1~child.domain.v1');
      }).toThrow('registerChildDomain callback not wired');
    });
  });

  describe('ChildMfeBridgeImpl.unregisterChildDomain', () => {
    it('should call unregister callback and remove domain ID from tracking', () => {
      // Setup: Mock callbacks and register a domain
      const registerCallback = vi.fn();
      const unregisterCallback = vi.fn();
      childBridge.setChildDomainCallbacks(registerCallback, unregisterCallback);
      childBridge.registerChildDomain('mock.ext.domain.v1~child.domain.v1');

      // Act: Unregister the domain
      childBridge.unregisterChildDomain('mock.ext.domain.v1~child.domain.v1');

      // Assert: Callback was called
      expect(unregisterCallback).toHaveBeenCalledWith('mock.ext.domain.v1~child.domain.v1');
      expect(unregisterCallback).toHaveBeenCalledTimes(1);
    });

    it('should no-op silently if callback is null', () => {
      // Act & Assert: Should not throw
      expect(() => {
        childBridge.unregisterChildDomain('mock.ext.domain.v1~child.domain.v1');
      }).not.toThrow();
    });
  });

  describe('ChildMfeBridgeImpl.destroy', () => {
    it('should unregister all tracked child domains before nulling callbacks', () => {
      // Setup: Register multiple child domains
      const registerCallback = vi.fn();
      const unregisterCallback = vi.fn();
      childBridge.setChildDomainCallbacks(registerCallback, unregisterCallback);

      childBridge.registerChildDomain('mock.ext.domain.v1~child1.v1');
      childBridge.registerChildDomain('mock.ext.domain.v1~child2.v1');
      childBridge.registerChildDomain('mock.ext.domain.v1~child3.v1');

      // Act: Cleanup
      childBridge.destroy();

      // Assert: All domains were unregistered
      expect(unregisterCallback).toHaveBeenCalledTimes(3);
      expect(unregisterCallback).toHaveBeenCalledWith('mock.ext.domain.v1~child1.v1');
      expect(unregisterCallback).toHaveBeenCalledWith('mock.ext.domain.v1~child2.v1');
      expect(unregisterCallback).toHaveBeenCalledWith('mock.ext.domain.v1~child3.v1');
    });

    it('should verify callbacks are called before being nulled', () => {
      // Setup: Register a child domain
      const unregisterCallback = vi.fn();
      childBridge.setChildDomainCallbacks(vi.fn(), unregisterCallback);
      childBridge.registerChildDomain('mock.ext.domain.v1~child.v1');

      // Act: Cleanup
      childBridge.destroy();

      // Assert: Unregister was called (proves callback was still wired)
      expect(unregisterCallback).toHaveBeenCalledWith('mock.ext.domain.v1~child.v1');

      // Verify subsequent registerChildDomain throws (proves callback is now null)
      expect(() => {
        childBridge.registerChildDomain('mock.ext.domain.v1~new.domain.v1');
      }).toThrow('registerChildDomain callback not wired');
    });

    it('should clear the tracked domain IDs set', () => {
      // Setup: Register domains
      const registerCallback = vi.fn();
      const unregisterCallback = vi.fn();
      childBridge.setChildDomainCallbacks(registerCallback, unregisterCallback);
      childBridge.registerChildDomain('mock.ext.domain.v1~child1.v1');
      childBridge.registerChildDomain('mock.ext.domain.v1~child2.v1');

      // Act: Cleanup
      childBridge.destroy();

      // Reset the mock to verify subsequent cleanup doesn't call unregister again
      unregisterCallback.mockClear();

      // Wire callbacks again (simulating re-use scenario)
      childBridge.setChildDomainCallbacks(registerCallback, unregisterCallback);

      // Call cleanup again
      childBridge.destroy();

      // Assert: No unregister calls (set was cleared)
      expect(unregisterCallback).not.toHaveBeenCalled();
    });
  });

  describe('End-to-End Integration', () => {
    it('should route action from parent mediator through child bridge to child registry', async () => {
      // Setup: Mock child registry executeActionsChain
      const childRegistryExecute = vi.fn().mockResolvedValue(undefined);

      // Wire parent -> child transport
      childBridge.onActionsChain(childRegistryExecute);

      // Create register callback that creates forwarding handler
      const handlers = new Map<string, ActionHandler>();
      const registerCallback = (domainId: string) => {
        const handler = new ChildDomainForwardingHandler(parentBridge, domainId);
        handlers.set(domainId, handler);
      };
      const unregisterCallback = (domainId: string) => {
        handlers.delete(domainId);
      };

      childBridge.setChildDomainCallbacks(registerCallback, unregisterCallback);

      // Register child domain
      const childDomainId = 'mock.ext.domain.v1~child.domain.v1';
      childBridge.registerChildDomain(childDomainId);

      // Verify handler was registered
      expect(handlers.has(childDomainId)).toBe(true);

      // Act: Simulate parent mediator invoking the forwarding handler
      const handler = handlers.get(childDomainId)!;
      await handler.handleAction(
        'mock.ext.action.v1~test.action.v1',
        { data: 'test' }
      );

      // Assert: Child registry received the action chain
      expect(childRegistryExecute).toHaveBeenCalledWith({
        action: {
          type: 'mock.ext.action.v1~test.action.v1',
          target: childDomainId,
          payload: { data: 'test' },
        },
      });
    });

    it('should remove forwarding handler from parent mediator on cleanup', () => {
      // Setup: Register domain with callbacks
      const handlers = new Map<string, ActionHandler>();
      const registerCallback = (domainId: string) => {
        const handler = new ChildDomainForwardingHandler(parentBridge, domainId);
        handlers.set(domainId, handler);
      };
      const unregisterCallback = (domainId: string) => {
        handlers.delete(domainId);
      };

      childBridge.setChildDomainCallbacks(registerCallback, unregisterCallback);
      const childDomainId = 'mock.ext.domain.v1~child.domain.v1';
      childBridge.registerChildDomain(childDomainId);

      // Verify handler is registered
      expect(handlers.has(childDomainId)).toBe(true);

      // Act: Cleanup (simulating unmount)
      childBridge.destroy();

      // Assert: Handler was removed
      expect(handlers.has(childDomainId)).toBe(false);
    });

    it('should not affect parent domain handlers', async () => {
      // This test verifies that cross-runtime wiring doesn't interfere with
      // parent domain handler resolution. Since we're testing bridge-level
      // components in isolation, we verify that the forwarding handler
      // only affects child domains, not parent domains.

      // Setup: Register child domain
      const childDomains = new Set<string>();
      const registerCallback = (domainId: string) => {
        childDomains.add(domainId);
      };
      const unregisterCallback = (domainId: string) => {
        childDomains.delete(domainId);
      };

      childBridge.setChildDomainCallbacks(registerCallback, unregisterCallback);
      childBridge.registerChildDomain('mock.ext.domain.v1~child.domain.v1');

      // Assert: Only child domain is tracked
      expect(childDomains.size).toBe(1);
      expect(childDomains.has('mock.ext.domain.v1~child.domain.v1')).toBe(true);

      // Parent domain should NOT be in the set
      expect(childDomains.has('mock.ext.domain.v1~parent.domain.v1')).toBe(false);
    });
  });
});
