import { describe, it, expect } from 'vitest';
import { DefaultActionsChainsMediator } from '../actions-chains-mediator';
import { ActionHandler } from '../types';
import type { TypeSystemPlugin } from '../../type-substrate';
import type { MfeEntry } from '../../types';
import type { ExtensionDomainState } from '../../runtime/extension-manager';

// Mock-plugin-local stand-ins for the framework's well-known lifecycle action
// IDs, deliberately NOT the real GTS strings — proves the mediator's
// hierarchy-aware paths never assume any particular notation.
const MOUNT_EXT = 'mock.action.v1~mount_ext.v1~';
const UNMOUNT_EXT = 'mock.action.v1~unmount_ext.v1~';
const LOAD_EXT = 'mock.action.v1~load_ext.v1~';
// Stand-ins for the four well-known lifecycle stages, same rationale as above.
const STAGE_INIT = 'mock.stage.v1~init.v1';
const STAGE_ACTIVATED = 'mock.stage.v1~activated.v1';
const STAGE_DEACTIVATED = 'mock.stage.v1~deactivated.v1';
const STAGE_DESTROYED = 'mock.stage.v1~destroyed.v1';
// A domain-declared "is-a" derivative of mount_ext — NOT string-equal to
// MOUNT_EXT, but recognized as derived from it by the mock's isTypeOf.
const DERIVED_MOUNT_EXT = `${MOUNT_EXT}vendor.v1~`;

function createMockPlugin(): TypeSystemPlugin<unknown> {
  return {
    name: 'MockPlugin',
    version: '1.0.0',
    registerSchema(): void {},
    getSchema(): undefined {
      return undefined;
    },
    register(): void {},
    isTypeOf(typeId: string, baseTypeId: string): boolean {
      return typeId === baseTypeId || typeId.startsWith(baseTypeId);
    },
    validateInstance() {
      return { valid: true, errors: [] };
    },
    resolveLoadExtActionId(): string {
      return LOAD_EXT;
    },
    resolveMountExtActionId(): string {
      return MOUNT_EXT;
    },
    resolveUnmountExtActionId(): string {
      return UNMOUNT_EXT;
    },
    resolveLifecycleStageInitId(): string {
      return STAGE_INIT;
    },
    resolveLifecycleStageActivatedId(): string {
      return STAGE_ACTIVATED;
    },
    resolveLifecycleStageDeactivatedId(): string {
      return STAGE_DEACTIVATED;
    },
    resolveLifecycleStageDestroyedId(): string {
      return STAGE_DESTROYED;
    },
  };
}

function makeDomainState(): ExtensionDomainState {
  return {
    domain: {
      id: 'domain-1',
      actions: [],
      extensionsActions: [],
      sharedProperties: [],
      defaultActionTimeout: 5000,
      lifecycleStages: [],
      extensionsLifecycleStages: [],
      extensionsTypeId: '',
    },
    properties: new Map(),
    extensions: new Set(),
    propertySubscribers: new Map(),
    mountedExtensions: [],
    mounter: null,
    lifecycleTrigger: null,
    implementation: null,
  };
}

function makeMediator(getExtensionEntry: (id: string) => MfeEntry | undefined = () => undefined) {
  return new DefaultActionsChainsMediator({
    typeSystem: createMockPlugin(),
    getDomainState: () => makeDomainState(),
    getExtensionEntry,
  });
}

describe('DefaultActionsChainsMediator — hierarchy-aware handler resolution', () => {
  it('resolves a handler registered under a DERIVED mount_ext id when dispatched with the BASE id', async () => {
    const mediator = makeMediator();
    let handled = false;
    mediator.registerHandler(
      'domain-1',
      DERIVED_MOUNT_EXT,
      ActionHandler.fromFunction(async () => {
        handled = true;
      })
    );

    const result = await mediator.executeActionsChain({
      action: { type: MOUNT_EXT, target: 'domain-1', payload: { subject: 'ext-1' } },
    });

    expect(result.completed).toBe(true);
    expect(handled).toBe(true);
  });

  it('resolves a handler registered under the BASE mount_ext id when dispatched with a DERIVED id', async () => {
    const mediator = makeMediator();
    let handled = false;
    mediator.registerHandler(
      'domain-1',
      MOUNT_EXT,
      ActionHandler.fromFunction(async () => {
        handled = true;
      })
    );

    const result = await mediator.executeActionsChain({
      action: { type: DERIVED_MOUNT_EXT, target: 'domain-1', payload: { subject: 'ext-1' } },
    });

    expect(result.completed).toBe(true);
    expect(handled).toBe(true);
  });

  it('does not misroute an ActionHandler that happens to define its own `send` method as a CrossHopRoute', async () => {
    // Regression guard for the old duck-typed `isCrossHopRoute` check, which
    // identified a resolved handler as a cross-hop route purely by the
    // presence of a `send` method. An ordinary application `ActionHandler`
    // is free to name its own unrelated method `send` — under duck-typing
    // this handler would have been misrouted into `CrossHopRoute` handling
    // and crashed calling `registerInFlight`, which it doesn't implement.
    class HandlerWithOwnSendMethod extends ActionHandler {
      handled = false;
      sentCount = 0;

      async handleAction(): Promise<void> {
        this.handled = true;
      }

      // Unrelated application-level method that happens to share a name
      // with CrossHopRoute.send — must not affect dispatch resolution.
      async send(): Promise<void> {
        this.sentCount += 1;
      }
    }

    const mediator = makeMediator();
    const handler = new HandlerWithOwnSendMethod();
    mediator.registerHandler('domain-1', MOUNT_EXT, handler);

    const result = await mediator.executeActionsChain({
      action: { type: MOUNT_EXT, target: 'domain-1', payload: { subject: 'ext-1' } },
    });

    expect(result.completed).toBe(true);
    expect(handler.handled).toBe(true);
    expect(handler.sentCount).toBe(0);
  });

  it('still fails with NoHandlerForActionTargetError semantics for a genuinely unrelated action type', async () => {
    const mediator = makeMediator();
    mediator.registerHandler('domain-1', MOUNT_EXT, ActionHandler.fromFunction(async () => {}));

    const result = await mediator.executeActionsChain({
      action: { type: 'mock.action.v1~unrelated.v1~', target: 'domain-1' },
    });

    expect(result.completed).toBe(false);
    expect(result.path).toEqual(['mock.action.v1~unrelated.v1~']);
  });

  it('exempts a DERIVED infrastructure action from entry declaration validation', async () => {
    // Entry declares NO actions at all — if the derived load_ext id were
    // treated as a regular (non-infrastructure) action, this would throw
    // "Action type ... is not declared by target entry" before dispatch.
    const entry: MfeEntry = {
      id: 'ext-1',
      entry: 'ext-1',
      domain: 'domain-1',
      actions: [],
      domainActions: [],
      requiredProperties: [],
    } as unknown as MfeEntry;

    const mediator = makeMediator(() => entry);
    let handled = false;
    mediator.registerHandler(
      'ext-1',
      `${LOAD_EXT}vendor.v1~`,
      ActionHandler.fromFunction(async () => {
        handled = true;
      })
    );

    const result = await mediator.executeActionsChain({
      action: { type: `${LOAD_EXT}vendor.v1~`, target: 'ext-1' },
    });

    expect(result.completed).toBe(true);
    expect(handled).toBe(true);
  });
});
