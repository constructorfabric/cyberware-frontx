/**
 * Tests for microfrontends plugin - Phase 7.9
 *
 * Tests plugin propagation and JSON loading ONLY.
 * Flux integration tests (actions, effects, slice) are in Phase 13.8.
 *
 * See also: packages/framework/__tests__/plugins/microfrontends/plugin.test.ts
 * for Phase 13.8 Flux-integration coverage. The two suites are intentionally
 * separated: Phase 7.9 exercises registry wiring and schema loading; Phase 13
 * exercises slice/effects/actions.
 *
 * @packageDocumentation
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eventBus, resetStore } from '@gears-frontx/state';
import { gtsPlugin } from '@gears-frontx/gts-plugin';
import type { TypeSystemPlugin } from '@gears-frontx/mfes';
import type { JSONSchema } from '@gears-frontx/gts-plugin';
import { createFrontX } from '../../src/createFrontX';
import { microfrontends } from '../../src/plugins/microfrontends';
import { loadLayoutDomains } from '../../src/plugins/microfrontends/gts/loader';
import { themeSchema, languageSchema, extensionScreenSchema } from '@gears-frontx/frontx-template-shell';
import type { MfeRegistry } from '@gears-frontx/framework';
import { TestContainerProvider } from '../../src/testing/TestContainerProvider';
import { resetSharedQueryClient } from '../../src/testing';
import type { FrontXApp } from '../../src/types';

function getAppMfeRegistry(app: FrontXApp): MfeRegistry {
  const registry = app.mfeRegistry;
  if (!registry) {
    throw new Error('expected mfeRegistry on app');
  }
  return registry;
}

describe('microfrontends plugin - Phase 7.9', () => {
  const [sidebarDomain, popupDomain, screenDomain, overlayDomain] = loadLayoutDomains();
  let apps: FrontXApp[] = [];
  // NOTE: We deliberately reuse the module-scoped `gtsPlugin` singleton across
  // every test in this file. The `mfeRegistryFactory` is itself a
  // process-wide singleton that caches the very first TypeSystemPlugin it was
  // built with, and rejects subsequent .build(...) calls with a *different*
  // plugin identity (even if both are named "gts"). That makes a fresh
  // `new GtsPlugin()` per test incompatible with the registry factory.
  //
  // Schema registration below is idempotent: the three first-class schemas are
  // static and do not mutate between tests, so sharing the singleton does not
  // leak test-specific state.
  const typeSystem: TypeSystemPlugin = gtsPlugin;

  beforeAll(() => {
    typeSystem.registerSchema(themeSchema);
    typeSystem.registerSchema(languageSchema);
    typeSystem.registerSchema(extensionScreenSchema);
  });

  afterEach(() => {
    apps.forEach((app) => {
      app.destroy();
    });
    apps = [];
    vi.restoreAllMocks();
    eventBus.clearAll();
    resetStore();
    resetSharedQueryClient();
  });

  function buildApp(): FrontXApp {
    const app = createFrontX()
      .use(microfrontends({ typeSystem }))
      .build();
    apps.push(app);
    return app;
  }

  describe('plugin factory', () => {
    it('accepts required typeSystem parameter and returns a valid plugin object', () => {
      const plugin = microfrontends({ typeSystem });

      expect(plugin).toHaveProperty('name', 'microfrontends');
      expect(plugin).toHaveProperty('dependencies');
      expect(plugin).toHaveProperty('onInit');
      expect(plugin).toHaveProperty('provides');
      expect(plugin.provides).toHaveProperty('registries');
    });

    it('accepts optional mfeHandlers config', () => {
      const plugin = microfrontends({ typeSystem, mfeHandlers: [] });

      expect(plugin.name).toBe('microfrontends');
    });
  });

  describe('7.9.1 - plugin obtains mfeRegistry from framework', () => {
    it('provides mfeRegistry via provides.registries', () => {
      const plugin = microfrontends({ typeSystem });

      expect(plugin.provides).toBeDefined();
      expect(plugin.provides?.registries).toBeDefined();
      expect(plugin.provides?.registries?.mfeRegistry).toBeDefined();
    });

    it('makes mfeRegistry available on the app object', () => {
      const app = buildApp();

      expect(app.mfeRegistry).toBeDefined();
      expect(typeof app.mfeRegistry).toBe('object');
    });

    it('exposes mfeRegistry with MFE methods', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);

      expect(typeof registry.registerDomain).toBe('function');
      expect(typeof registry.typeSystem).toBe('object');
      expect(registry.typeSystem.name).toBe('gts');
    });
  });

  describe('7.9.2 - same TypeSystemPlugin instance is propagated through layers', () => {
    it('uses the same TypeSystemPlugin instance throughout', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);

      expect(registry.typeSystem).toBe(typeSystem);
      expect(registry.typeSystem.version).toBe('1.0.0');

      expect(typeof registry.typeSystem.registerSchema).toBe('function');
      expect(typeof registry.typeSystem.getSchema).toBe('function');
      expect(typeof registry.typeSystem.register).toBe('function');
      expect(typeof registry.typeSystem.isTypeOf).toBe('function');
    });

    it('has a consistent plugin reference across multiple calls', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);

      expect(registry.typeSystem).toBe(registry.typeSystem);
    });
  });

  describe('7.9.3 - runtime.registerDomain() works for base domains at runtime', () => {
    it('registers sidebar domain and exposes it via getDomain', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);
      const provider = new TestContainerProvider();

      registry.registerDomain(sidebarDomain, provider.prepareForDomain(sidebarDomain));

      expect(registry.getDomain(sidebarDomain.id)).toBeDefined();
      expect(registry.getDomain(sidebarDomain.id)?.id).toBe(sidebarDomain.id);
    });

    it('registers popup domain and exposes it via getDomain', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);
      const provider = new TestContainerProvider();

      registry.registerDomain(popupDomain, provider.prepareForDomain(popupDomain));

      expect(registry.getDomain(popupDomain.id)).toBeDefined();
    });

    it('registers screen domain and exposes it via getDomain', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);
      const provider = new TestContainerProvider();

      registry.registerDomain(screenDomain, provider.setRegistry(registry).prepareForDomain(screenDomain));

      expect(registry.getDomain(screenDomain.id)).toBeDefined();
    });

    it('registers overlay domain and exposes it via getDomain', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);
      const provider = new TestContainerProvider();

      registry.registerDomain(overlayDomain, provider.setRegistry(registry).prepareForDomain(overlayDomain));

      expect(registry.getDomain(overlayDomain.id)).toBeDefined();
    });

    it('registers all base domains so each can be queried back', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);
      const provider = new TestContainerProvider();
      provider.setRegistry(registry);

      registry.registerDomain(sidebarDomain, provider.prepareForDomain(sidebarDomain));
      registry.registerDomain(popupDomain, provider.prepareForDomain(popupDomain));
      registry.registerDomain(screenDomain, provider.prepareForDomain(screenDomain));
      registry.registerDomain(overlayDomain, provider.prepareForDomain(overlayDomain));

      expect(registry.getDomain(sidebarDomain.id)?.id).toBe(sidebarDomain.id);
      expect(registry.getDomain(popupDomain.id)?.id).toBe(popupDomain.id);
      expect(registry.getDomain(screenDomain.id)?.id).toBe(screenDomain.id);
      expect(registry.getDomain(overlayDomain.id)?.id).toBe(overlayDomain.id);
    });

    it('returns undefined for unregistered domains', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);

      expect(
        registry.getDomain(
          'gts.frontx.mfes.ext.domain.v1~unknown.domain.v1'
        )
      ).toBeUndefined();
    });
  });

  describe('7.9.4 - JSON schema loading works correctly', () => {
    it('loads first-class citizen schemas during plugin construction', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);

      const coreSchemas = [
        'gts.frontx.mfes.mfe.entry.v1~',
        'gts.frontx.mfes.ext.domain.v1~',
        'gts.frontx.mfes.ext.extension.v1~',
        'gts.frontx.mfes.comm.shared_property.v1~',
        'gts.frontx.mfes.comm.action.v1~',
        'gts.frontx.mfes.comm.actions_chain.v1~',
        'gts.frontx.mfes.lifecycle.stage.v1~',
        'gts.frontx.mfes.lifecycle.hook.v1~',
      ];

      for (const schemaId of coreSchemas) {
        const schema = registry.typeSystem.getSchema(schemaId);
        expect(schema).toBeDefined();
        expect(schema).toHaveProperty('$id');
      }
    });

    it('validates schema availability via getSchema', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);

      // registry.typeSystem is schema-agnostic (TypeSystemPlugin<unknown>); this
      // app wires the GTS plugin, so view the schemas as JSONSchema here.
      const entrySchema = registry.typeSystem.getSchema('gts.frontx.mfes.mfe.entry.v1~') as JSONSchema | undefined;
      expect(entrySchema).toBeDefined();
      expect(entrySchema?.$id).toContain('gts.frontx.mfes.mfe.entry.v1~');

      const domainSchema = registry.typeSystem.getSchema('gts.frontx.mfes.ext.domain.v1~') as JSONSchema | undefined;
      expect(domainSchema).toBeDefined();
      expect(domainSchema?.$id).toContain('gts.frontx.mfes.ext.domain.v1~');
    });

    it('returns undefined for non-existent schemas', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);

      const nonExistentSchema = registry.typeSystem.getSchema('gts.nonexistent.schema.v1~');
      expect(nonExistentSchema).toBeUndefined();
    });
  });

  describe('7.9.5 - JSON instance loading works correctly', () => {
    it('loads base domain instances from JSON with expected ids', () => {
      expect(sidebarDomain.id).toContain('frontx.screensets.layout.sidebar');
      expect(popupDomain.id).toContain('frontx.screensets.layout.popup');
      expect(screenDomain.id).toContain('frontx.screensets.layout.screen');
      expect(overlayDomain.id).toContain('frontx.screensets.layout.overlay');
    });

    it('validates the loaded domain instance when registered', () => {
      const app = buildApp();
      const registry = getAppMfeRegistry(app);
      const provider = new TestContainerProvider();

      registry.registerDomain(sidebarDomain, provider.prepareForDomain(sidebarDomain));

      expect(registry.getDomain(sidebarDomain.id)).toBeDefined();
    });

    it('loads lifecycle stages from JSON', () => {
      expect(sidebarDomain.lifecycleStages).toBeDefined();
      expect(Array.isArray(sidebarDomain.lifecycleStages)).toBe(true);
      expect(sidebarDomain.lifecycleStages.length).toBe(4);

      const stageIds = sidebarDomain.lifecycleStages;
      expect(stageIds).toContain('gts.frontx.mfes.lifecycle.stage.v1~frontx.mfes.lifecycle.init.v1');
      expect(stageIds).toContain('gts.frontx.mfes.lifecycle.stage.v1~frontx.mfes.lifecycle.activated.v1');
      expect(stageIds).toContain('gts.frontx.mfes.lifecycle.stage.v1~frontx.mfes.lifecycle.deactivated.v1');
      expect(stageIds).toContain('gts.frontx.mfes.lifecycle.stage.v1~frontx.mfes.lifecycle.destroyed.v1');
    });

    it('loads base actions from JSON', () => {
      expect(sidebarDomain.actions).toBeDefined();
      expect(Array.isArray(sidebarDomain.actions)).toBe(true);
      expect(sidebarDomain.actions.length).toBe(3);

      expect(sidebarDomain.actions).toContain('gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.load_ext.v1~');
      expect(sidebarDomain.actions).toContain('gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.mount_ext.v1~');
      expect(sidebarDomain.actions).toContain('gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.unmount_ext.v1~');
    });

    it('handles screen domain with swap semantics (load_ext + mount_ext, no unmount_ext)', () => {
      expect(screenDomain.actions.length).toBe(2);
      expect(screenDomain.actions).toContain('gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.load_ext.v1~');
      expect(screenDomain.actions).toContain('gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.mount_ext.v1~');
      expect(screenDomain.actions).not.toContain('gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.unmount_ext.v1~');
    });
  });

  describe('base domain factories', () => {
    it('creates sidebar domain with correct structure', () => {
      const domain = sidebarDomain;

      expect(domain).toMatchObject({
        id: 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.sidebar.v1',
        sharedProperties: [
          'gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.theme.v1~',
          'gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.language.v1~',
        ],
        actions: [
          'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.load_ext.v1~',
          'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.mount_ext.v1~',
          'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.unmount_ext.v1~',
        ],
        extensionsActions: [],
        defaultActionTimeout: 30000,
      });
      expect(domain.lifecycleStages).toHaveLength(4);
      expect(domain.extensionsLifecycleStages).toHaveLength(4);
    });

    it('creates popup domain with correct structure', () => {
      const domain = popupDomain;

      expect(domain).toMatchObject({
        id: 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.popup.v1',
        sharedProperties: [
          'gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.theme.v1~',
          'gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.language.v1~',
        ],
        actions: [
          'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.load_ext.v1~',
          'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.mount_ext.v1~',
          'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.unmount_ext.v1~',
        ],
        extensionsActions: [],
        defaultActionTimeout: 30000,
      });
      expect(domain.lifecycleStages).toHaveLength(4);
      expect(domain.extensionsLifecycleStages).toHaveLength(4);
    });

    it('creates screen domain with only load_ext action', () => {
      const domain = screenDomain;

      expect(domain).toMatchObject({
        id: 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1',
        sharedProperties: [
          'gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.theme.v1~',
          'gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.language.v1~',
        ],
        actions: [
          'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.load_ext.v1~',
          'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.mount_ext.v1~',
        ],
        extensionsActions: [],
        defaultActionTimeout: 30000,
      });
      expect(domain.actions).toHaveLength(2);
      expect(domain.lifecycleStages).toHaveLength(1);
      expect(domain.extensionsLifecycleStages).toHaveLength(4);
    });

    it('creates overlay domain with correct structure', () => {
      const domain = overlayDomain;

      expect(domain).toMatchObject({
        id: 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.overlay.v1',
        sharedProperties: [
          'gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.theme.v1~',
          'gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.language.v1~',
        ],
        actions: [
          'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.load_ext.v1~',
          'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.mount_ext.v1~',
          'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.unmount_ext.v1~',
        ],
        extensionsActions: [],
        defaultActionTimeout: 30000,
      });
      expect(domain.lifecycleStages).toHaveLength(4);
      expect(domain.extensionsLifecycleStages).toHaveLength(4);
    });
  });
});
