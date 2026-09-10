import type { ChildMfeBridge, SharedProperty } from '@gears-frontx/framework';
import { vi, type Mock } from 'vitest';

type PropertyCallback = Parameters<ChildMfeBridge['subscribeToProperty']>[1];

type CreateMfeBridgeFixtureOptions = {
  extDomainId: string;
  extensionId: string;
  initialProperties?: Record<string, unknown>;
  executeActionsChain?: Mock<ChildMfeBridge['executeActionsChain']>;
  registerActionHandler?: Mock<ChildMfeBridge['registerActionHandler']>;
};

type RecordedUnsubscribe = {
  propertyName: string;
  unsubscribe: ReturnType<typeof vi.fn>;
};

export type MfeBridgeFixture = {
  bridge: ChildMfeBridge;
  executeActionsChain: Mock<ChildMfeBridge['executeActionsChain']>;
  getProperty: Mock<ChildMfeBridge['getProperty']>;
  propertyCallbacks: Map<string, PropertyCallback[]>;
  registerActionHandler: Mock<ChildMfeBridge['registerActionHandler']>;
  setProperty: (propertyName: string, value: unknown) => void;
  subscribeToProperty: Mock<ChildMfeBridge['subscribeToProperty']>;
  unsubscriptions: RecordedUnsubscribe[];
};

/**
 * Creates a ChildMfeBridge test double with tracked property subscriptions.
 */
export function createMfeBridgeFixture(
  options: CreateMfeBridgeFixtureOptions
): MfeBridgeFixture {
  const propertyValues = new Map<string, unknown>(
    Object.entries(options.initialProperties ?? {})
  );
  const propertyCallbacks = new Map<string, PropertyCallback[]>();
  const unsubscriptions: RecordedUnsubscribe[] = [];
  const executeActionsChain =
    options.executeActionsChain ??
    vi.fn<ChildMfeBridge['executeActionsChain']>().mockResolvedValue(undefined);
  const registerActionHandler =
    options.registerActionHandler ??
    vi.fn<ChildMfeBridge['registerActionHandler']>();

  const getProperty = vi.fn<ChildMfeBridge['getProperty']>((propertyName: string) => {
    if (!propertyValues.has(propertyName)) {
      return undefined;
    }

    return {
      id: propertyName,
      value: propertyValues.get(propertyName),
    } satisfies SharedProperty;
  });

  const subscribeToProperty = vi.fn<ChildMfeBridge['subscribeToProperty']>(
    (propertyName: string, callback: PropertyCallback) => {
      const callbacks = propertyCallbacks.get(propertyName) ?? [];
      callbacks.push(callback);
      propertyCallbacks.set(propertyName, callbacks);

      const unsubscribe = vi.fn();
      unsubscriptions.push({ propertyName, unsubscribe });
      return unsubscribe;
    }
  );

  const setProperty = (propertyName: string, value: unknown) => {
    propertyValues.set(propertyName, value);

    for (const callback of propertyCallbacks.get(propertyName) ?? []) {
      callback({
        id: propertyName,
        value,
      });
    }
  };

  return {
    bridge: {
      extDomainId: options.extDomainId,
      extensionId: options.extensionId,
      executeActionsChain,
      registerActionHandler,
      getProperty,
      subscribeToProperty,
    },
    executeActionsChain,
    getProperty,
    propertyCallbacks,
    registerActionHandler,
    setProperty,
    subscribeToProperty,
    unsubscriptions,
  };
}
