// @cpt-flow:cpt-frontx-flow-template-resolution-install:p1
// @cpt-flow:cpt-frontx-flow-template-resolution-list:p1
// @cpt-flow:cpt-frontx-flow-template-resolution-update-local:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
// @cpt-state:cpt-frontx-state-template-resolution-inventory-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-install-by-spec:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-list-inventory:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-bounded-local-update:p1
import { describe, it, expect, vi } from 'vitest';
import { TemplateInventory } from '../inventory/TemplateInventory';
import { InventoryState } from '../inventory/types';
import { listCommand } from '../commands/list';
import type { FetchFn } from '../resolver/types';
import type { TemplateManifest } from '../manifest/types';

// A contract-valid manifest, serialized to the string a `FetchFn` returns.
// Callers deliberately pick a `name` different from the repository segment
// in the spec they install by, so a test asserting on the installed identity
// proves it comes from the manifest rather than from the repository name.
function manifestContent(name: string, version = '1.0.0'): string {
  const manifest: TemplateManifest = {
    name,
    version,
    excludedSubtrees: [],
    description: 'Fixture template for inventory resolution tests.',
  };
  return JSON.stringify(manifest);
}

function makeSuccessFetch(content: string): FetchFn {
  return vi.fn().mockResolvedValue(content);
}

function makeFailFetch(message = 'Network error'): FetchFn {
  return vi.fn().mockRejectedValue(new Error(message));
}

describe('TemplateInventory', () => {
  describe('install', () => {
    // inst-install-invoke, inst-install-parse, inst-install-resolve,
    // inst-install-fetch, inst-install-materialize, inst-install-success
    it('valid spec installs to inventory keyed by the manifest identity, at pinned ref', async () => {
      const inv = new TemplateInventory();
      const fetch = makeSuccessFetch(manifestContent('widget-kit'));
      const result = await inv.install('github:acme/my-template@v1.0.0', fetch);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('widget-kit');
      expect(result.value.ref).toBe('v1.0.0');
      expect(inv.lookup('widget-kit')?.name).toBe('widget-kit');
    });

    // inst-resolve-collision-fail — the identity is the index key, so a SECOND
    // source-spec resolving to an identity already tracked is a collision
    // rather than an update. It names both sources because the developer's next
    // move depends on which one they meant, and it leaves the occupant's
    // content untouched: an install that half-replaced a template already in
    // use would be worse than a refusal.
    it('refuses with REGISTRATION_CONFLICT when the resolved identity is already tracked for a different spec, naming both sources', async () => {
      const inv = new TemplateInventory();
      await inv.install('github:acme/first@v1.0.0', makeSuccessFetch(manifestContent('widget-kit')));
      const occupant = inv.lookup('widget-kit');

      const result = await inv.install('github:other/second@v2.0.0', makeSuccessFetch(manifestContent('widget-kit')));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('REGISTRATION_CONFLICT');
      expect(result.error.message).toContain('github:acme/first@v1.0.0');
      expect(result.error.message).toContain('github:other/second@v2.0.0');
      // The occupying entry is byte-identical to what it was before.
      expect(inv.lookup('widget-kit')).toEqual(occupant);
    });

    // inst-resolve-collision-fail, nesting arm — `@acme/tools/extra` would be
    // materialized inside the content path of an installed `@acme/tools` (or
    // the reverse), so a bounded update of either would clear the other from
    // disk. Refused for that reason rather than for path equality.
    it('refuses with REGISTRATION_CONFLICT when the resolved identity nests with an installed one, naming the occupant', async () => {
      const inv = new TemplateInventory();
      await inv.install('github:acme/tools@v1.0.0', makeSuccessFetch(manifestContent('@acme/tools')));

      const result = await inv.install('github:acme/extra@v1.0.0', makeSuccessFetch(manifestContent('@acme/tools/extra')));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('REGISTRATION_CONFLICT');
      expect(result.error.message).toContain('@acme/tools');
      // Nothing was written under the nested identity.
      expect(inv.lookup('@acme/tools/extra')).toBeUndefined();
    });

    // inst-install-parse-check, inst-install-parse-reject
    it('invalid spec rejected, no inventory write', async () => {
      const inv = new TemplateInventory();
      const fetch = makeSuccessFetch(manifestContent('widget-kit'));
      const result = await inv.install('acme/my-template@v1.0.0', fetch);
      expect(result.ok).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
      const entries = await inv.list();
      expect(entries).toHaveLength(0);
    });

    // inst-install-reach-check, inst-install-reach-fail
    it('unreachable registry aborts, no inventory write', async () => {
      const inv = new TemplateInventory();
      const fetch = makeFailFetch('Connection refused');
      const result = await inv.install('github:acme/my-template@v1.0.0', fetch);
      expect(result.ok).toBe(false);
      const entries = await inv.list();
      expect(entries).toHaveLength(0);
    });
  });

  describe('list', () => {
    // inst-list-invoke, inst-list-read, inst-list-format, inst-list-return
    it('returns all installed entries under their manifest-declared identities', async () => {
      const inv = new TemplateInventory();
      await inv.install('github:acme/template-a@v1.0.0', makeSuccessFetch(manifestContent('alpha-kit')));
      await inv.install('github:acme/template-b@v2.0.0', makeSuccessFetch(manifestContent('beta-kit')));
      const entries = await inv.list();
      expect(entries).toHaveLength(2);
      const names = entries.map((e) => e.name);
      expect(names).toContain('alpha-kit');
      expect(names).toContain('beta-kit');
    });

    // inst-list-empty-check, inst-list-empty-return
    it('returns empty on empty inventory', async () => {
      const inv = new TemplateInventory();
      const entries = await inv.list();
      expect(entries).toHaveLength(0);
    });

    // Acceptance criterion (FEATURE.md:430): `list` satisfies
    // `cpt-frontx-cli-nfr-template-scale`'s inventory threshold — at least 100
    // installed templates with version identity, no more than 2s at p95 on a
    // normal developer workstation. Deliberately NOT a p95-sampling harness:
    // one in-memory run against a generous margin is more useful than a
    // flaky percentile computed from a handful of samples, and this is an
    // in-memory `TemplateInventory` so the measurement is of `listCommand`
    // itself rather than of any filesystem the real CLI would add on top.
    // `listCommand` always re-validates every entry's stored manifest
    // (`storedManifestFields` -> `readManifestFromContent`) now that `version`
    // (like `description`) is manifest-declared rather than the inventory's
    // resolved ref — there is no longer a cheaper path that skips that work.
    it('lists 100 installed templates with version identity well inside the 2-second p95 budget', async () => {
      const inv = new TemplateInventory();
      const TOTAL = 100;
      for (let i = 0; i < TOTAL; i += 1) {
        await inv.install(`github:acme/tpl-${i}@v1.0.0`, makeSuccessFetch(manifestContent(`tpl-${i}`, '1.0.0')));
      }

      const startedAtMs = performance.now();
      const entries = await listCommand(inv);
      const elapsedMs = performance.now() - startedAtMs;

      expect(entries).toHaveLength(TOTAL);
      expect(entries.every((e) => typeof e.version === 'string' && e.version.length > 0)).toBe(true);
      // Measured ~a few milliseconds locally for 100 in-memory entries —
      // asserting at 500ms keeps over 1.5s of margin against the 2000ms p95
      // budget so this does not flake on a slower or more loaded machine.
      expect(elapsedMs).toBeLessThan(500);
    });
  });

  describe('update-local', () => {
    // inst-update-invoke, inst-update-lookup, inst-update-parse, inst-update-fetch,
    // inst-update-write, inst-update-success
    it('replaces existing entry, no scaffolded projects touched', async () => {
      const inv = new TemplateInventory();
      await inv.install('github:acme/my-template@v1.0.0', makeSuccessFetch(manifestContent('widget-kit', '1.0.0')));
      const result = await inv.updateLocal(
        'widget-kit',
        'github:acme/my-template@v2.0.0',
        makeSuccessFetch(manifestContent('widget-kit', '2.0.0')),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.ref).toBe('v2.0.0');

      const entries = await inv.list();
      const entry = entries.find((e) => e.name === 'widget-kit');
      expect(entry?.ref).toBe('v2.0.0');
    });

    // inst-update-notfound-check, inst-update-notfound
    it('returns not-found error for non-existent entry', async () => {
      const inv = new TemplateInventory();
      const result = await inv.updateLocal(
        'nonexistent',
        'github:acme/nonexistent@v1.0.0',
        makeSuccessFetch(manifestContent('ghost-kit')),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/not.found|nonexistent/i);
    });
  });

  describe('state machine', () => {
    // inst-state-to-resolved, inst-state-to-installed, inst-state-to-updated
    it('cycles UNRESOLVED → RESOLVED → INSTALLED → UPDATED', async () => {
      const inv = new TemplateInventory();

      // Initially UNRESOLVED (no entry) — queried by the manifest identity
      // the install below will resolve to, not by the repository segment.
      const initial = inv.getState('widget-kit');
      expect(initial).toBe(InventoryState.UNRESOLVED);

      // After install: INSTALLED (passes through RESOLVED internally)
      await inv.install('github:acme/my-template@v1.0.0', makeSuccessFetch(manifestContent('widget-kit', '1.0.0')));
      const afterInstall = inv.getState('widget-kit');
      expect(afterInstall).toBe(InventoryState.INSTALLED);

      // After update: UPDATED
      await inv.updateLocal(
        'widget-kit',
        'github:acme/my-template@v2.0.0',
        makeSuccessFetch(manifestContent('widget-kit', '2.0.0')),
      );
      const afterUpdate = inv.getState('widget-kit');
      expect(afterUpdate).toBe(InventoryState.UPDATED);
    });
  });
});
