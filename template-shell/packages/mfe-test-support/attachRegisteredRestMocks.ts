import type { ApiPluginBase, ApiProtocol } from '@gears-frontx/framework';

type ProtocolRestProbe = {
  plugins?: {
    add?: (plugin: ApiPluginBase) => void;
  };
};

/**
 * REST protocol instance that exposes the plugin registry `add` API used when
 * attaching mock plugins in tests.
 */
type WiringRestProtocol = ApiProtocol & {
  plugins: { add: (plugin: ApiPluginBase) => void };
};

export type ApiServiceWithPlugins = {
  getPlugins(): Iterable<readonly [ApiProtocol, Iterable<ApiPluginBase>]>;
};

const MOCK_PLUGIN = Symbol.for('frontx:plugin:mock');

function isWiringRestProtocol(protocol: ApiProtocol): protocol is WiringRestProtocol {
  return (
    typeof protocol === 'object' &&
    protocol !== null &&
    'plugins' in protocol &&
    typeof (protocol as ProtocolRestProbe).plugins?.add === 'function'
  );
}

function isMockPluginLike(plugin: ApiPluginBase): boolean {
  const ctor = plugin.constructor as { readonly [MOCK_PLUGIN]?: boolean } | undefined;
  return Boolean(ctor && MOCK_PLUGIN in ctor);
}

/**
 * Test-only helper that mirrors the framework's mock-mode wiring for REST services.
 * Services register mock plugins in their constructors; isolated service tests
 * need to attach them explicitly.
 */
export function attachRegisteredRestMocks(service: ApiServiceWithPlugins): void {
  for (const [protocol, plugins] of service.getPlugins()) {
    if (!isWiringRestProtocol(protocol)) {
      continue;
    }

    for (const plugin of plugins) {
      if (isMockPluginLike(plugin)) {
        protocol.plugins.add(plugin);
      }
    }
  }
}
