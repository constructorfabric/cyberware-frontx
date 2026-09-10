// @cpt-flow:cpt-frontx-flow-template-resolution-install:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-manifest-identity:p1
import { describe, it, expect } from 'vitest';
import { InventoryIndex } from '../inventory/InventoryIndex';
import { InventoryStore } from '../inventory/InventoryStore';
import { TemplateInventory } from '../inventory/TemplateInventory';
import { InventoryState } from '../inventory/types';
import type { ContentStorePort } from '../inventory/types';
import { MANIFEST_FILENAME } from '../manifest/types';
import type { TemplateManifest } from '../manifest/types';
import { resolveToInventory } from '../resolver/resolve';
import type { FetchFn } from '../resolver/types';
import { parseSourceSpec } from '../spec-parser/parse';

// F10: cpt-frontx-algo-template-resolution-resolve-to-inventory
//   (inst-resolve-name, inst-resolve-identity-missing, inst-resolve-collision-check),
// cpt-frontx-algo-template-resolution-bounded-update
//   (inst-bupd-identity-mismatch),
// cpt-frontx-flow-template-resolution-install,
// cpt-frontx-dod-template-resolution-manifest-identity

const BUNDLE_MARKER = '$frontxTemplateFiles';

// Every fixture below declares a manifest name that differs from the
// repository segment of the reference that acquires it. A fixture where the
// two agree cannot distinguish identity-from-manifest from the repository-
// derived naming this feature replaced.
function manifestOf(name: string): TemplateManifest {
  return {
    name,
    version: '1.0.0',
    excludedSubtrees: [],
    description: 'Fixture template for manifest-identity resolution tests.',
  };
}

function bundleOf(manifest: TemplateManifest): string {
  return JSON.stringify({
    [BUNDLE_MARKER]: {
      [MANIFEST_FILENAME]: JSON.stringify(manifest),
      'src/index.ts': 'template-source',
    },
  });
}

// A repository bundle whose files sit under `subtree`, as the acquired
// content does before the resolver narrows and re-roots it.
function subtreeBundleOf(subtree: string, manifest: TemplateManifest): string {
  return JSON.stringify({
    [BUNDLE_MARKER]: {
      [`${subtree}/${MANIFEST_FILENAME}`]: JSON.stringify(manifest),
      [`${subtree}/src/index.ts`]: 'template-source',
    },
  });
}

function fetchOf(content: string): FetchFn {
  return async () => content;
}

// A content store carrying the real adapter's write/replace asymmetry: `write`
// materializes over whatever is already there, `replace` clears the content
// path first (packages/cli/src/adapters/fs-content-store.ts). The in-memory
// `InventoryStore` implements both as one `Map.set`, so a case built on it
// cannot see which operation a reinstall chose and passes either way.
class AccumulatingStore implements ContentStorePort {
  private readonly materialized: Map<string, Record<string, string>> = new Map();

  write(name: string, content: string): void {
    this.materialized.set(name, { ...(this.materialized.get(name) ?? {}), ...filesOf(content) });
  }

  replace(name: string, content: string): void {
    this.materialized.set(name, filesOf(content));
  }

  read(name: string): string | undefined {
    const files = this.materialized.get(name);
    return files === undefined ? undefined : JSON.stringify({ [BUNDLE_MARKER]: files });
  }

  has(name: string): boolean {
    return this.materialized.has(name);
  }
}

// The files an envelope materializes into. Every fixture in this file is an
// envelope, so this parses one here rather than reaching for the reader the
// code under test uses — a double that shares that reader would break with it
// instead of catching it.
function filesOf(content: string): Record<string, string> {
  return (JSON.parse(content) as Record<string, Record<string, string>>)[BUNDLE_MARKER] ?? {};
}

async function resolveSpec(spec: string, content: string) {
  const parsed = parseSourceSpec(spec);
  if (!parsed.ok) throw new Error(`fixture spec did not parse: ${spec}`);
  return resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn: fetchOf(content) });
}

describe('resolveToInventory — identity (inst-resolve-name, inst-resolve-identity-missing)', () => {
  it('takes the identity the manifest declares rather than the repository segment', async () => {
    const result = await resolveSpec(
      'github:acme/some-repository@v1.0.0',
      bundleOf(manifestOf('declared-identity')),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('declared-identity');
  });

  it('admits a scoped identity, which the manifest contract already treats as a path', async () => {
    const result = await resolveSpec(
      'github:acme/some-repository@v1.0.0',
      bundleOf(manifestOf('@acme/scoped-template')),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('@acme/scoped-template');
  });

  it('refuses acquired content whose manifest cannot be read', async () => {
    const result = await resolveSpec(
      'github:acme/some-repository@v1.0.0',
      JSON.stringify({ [BUNDLE_MARKER]: { 'src/index.ts': 'template-source' } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The message blames the unreadable manifest rather than the identity: the
    // manifest read enforces the whole contract, so a missing `version` reaches
    // this branch too.
    expect(result.error.message).toContain('has no readable manifest');
  });

  it('refuses an identity that would escape the inventory root', async () => {
    const result = await resolveSpec(
      'github:acme/some-repository@v1.0.0',
      bundleOf(manifestOf('../outside')),
    );

    // Path usability is part of the manifest contract, so the refusal comes
    // from the manifest read; the resolver's own check behind it exists only
    // for a caller that reaches it without that gate.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('usable as a repository-relative path');
  });

  it('refuses an absolute identity', async () => {
    const result = await resolveSpec(
      'github:acme/some-repository@v1.0.0',
      bundleOf(manifestOf('/etc/template')),
    );

    expect(result.ok).toBe(false);
  });

  it('refuses an identity carrying a Windows drive designator', async () => {
    const result = await resolveSpec(
      'github:acme/some-repository@v1.0.0',
      bundleOf(manifestOf('C:/outside')),
    );

    expect(result.ok).toBe(false);
  });
});

describe('TemplateInventory — manifest identity across install and bounded update (inst-resolve-collision-check, inst-bupd-identity-mismatch)', () => {
  it('refuses a second source declaring an identity another source already occupies', async () => {
    const inventory = new TemplateInventory();
    const shared = manifestOf('ui-template');

    const first = await inventory.install('github:acme/ui@v1.0.0', fetchOf(bundleOf(shared)));
    const second = await inventory.install('github:contoso/ui@v1.0.0', fetchOf(bundleOf(shared)));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    // Both sources are named, so the developer can act without re-deriving
    // which install occupies the identity.
    expect(second.error.message).toContain('github:acme/ui@v1.0.0');
    expect(second.error.message).toContain('github:contoso/ui@v1.0.0');
  });

  it('leaves the occupying content path untouched when it refuses a colliding install', async () => {
    const store = new InventoryStore();
    const inventory = new TemplateInventory(new InventoryIndex(), store);
    const occupant = bundleOf(manifestOf('ui-template'));
    // The intruder carries a file the occupant does not, so the content read
    // below distinguishes "refused" from "wrote the same bytes again".
    const intruder = JSON.stringify({
      [BUNDLE_MARKER]: {
        [MANIFEST_FILENAME]: JSON.stringify(manifestOf('ui-template')),
        'src/intruder.ts': 'intruder-source',
      },
    });

    await inventory.install('github:acme/ui@v1.0.0', fetchOf(occupant));
    await inventory.install('github:contoso/ui@v1.0.0', fetchOf(intruder));

    // The refused install must not have reached the occupant's content path:
    // `FsContentStore.write` materializes each bundle key without clearing
    // first, so a partial overwrite would leave a mixture of two templates
    // under one identity.
    expect(store.read('ui-template')).toBe(occupant);
    const entries = await inventory.list();
    expect(entries.map((entry) => entry.source)).toEqual(['github:acme/ui@v1.0.0']);
  });

  it('refuses an install over an entry whose recorded source no longer parses, rather than writing over unknown origin', async () => {
    const index = new InventoryIndex();
    const store = new InventoryStore();
    const occupant = bundleOf(manifestOf('ui-template'));
    // An entry recorded by an older grammar: its source cannot be parsed, so
    // the address comparison cannot establish that it is the same template.
    index.record({
      name: 'ui-template',
      source: 'acme/ui@v1.0.0',
      ref: 'v1.0.0',
      status: InventoryState.INSTALLED,
      content: occupant,
    });
    store.write('ui-template', occupant);
    const inventory = new TemplateInventory(index, store);

    const result = await inventory.install('github:acme/ui@v1.0.0', fetchOf(occupant));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('acme/ui@v1.0.0');
    expect(store.read('ui-template')).toBe(occupant);
  });

  it('refuses an identity that would nest inside an installed one, since they are not separate directories', async () => {
    const inventory = new TemplateInventory();

    const outer = await inventory.install(
      'github:acme/tools@v1.0.0',
      fetchOf(bundleOf(manifestOf('@acme/tools'))),
    );
    const inner = await inventory.install(
      'github:acme/extra@v1.0.0',
      fetchOf(bundleOf(manifestOf('@acme/tools/extra'))),
    );

    // A bounded update of `@acme/tools` clears its content path recursively and
    // would take `@acme/tools/extra` with it, leaving the inner template listed
    // in the index with nothing on disk.
    expect(outer.ok).toBe(true);
    expect(inner.ok).toBe(false);
    if (inner.ok) return;
    expect(inner.error.message).toContain('@acme/tools');
  });

  it('clears the content path when re-installing the same address, so a file the new version dropped is gone', async () => {
    const store = new AccumulatingStore();
    const inventory = new TemplateInventory(new InventoryIndex(), store);
    const withExtra = JSON.stringify({
      [BUNDLE_MARKER]: {
        [MANIFEST_FILENAME]: JSON.stringify(manifestOf('ui-template')),
        'src/index.ts': 'v1',
        'src/dropped.ts': 'v1-only',
      },
    });
    const withoutExtra = bundleOf(manifestOf('ui-template'));

    await inventory.install('github:acme/ui@v1.0.0', fetchOf(withExtra));
    const bumped = await inventory.install('github:acme/ui@v2.0.0', fetchOf(withoutExtra));

    expect(bumped.ok).toBe(true);
    // A plain write would have materialized over the previous version, leaving
    // `src/dropped.ts` behind; only clearing the content path first leaves
    // exactly the files the new version carries.
    expect(store.read('ui-template')).toBe(withoutExtra);
  });

  it('admits a newer version of the same template address, since a bump is not a collision', async () => {
    const inventory = new TemplateInventory();

    await inventory.install('github:acme/ui@v1.0.0', fetchOf(bundleOf(manifestOf('ui-template'))));
    const bumped = await inventory.install(
      'github:acme/ui@v2.0.0',
      fetchOf(bundleOf(manifestOf('ui-template'))),
    );

    // The guard compares the template address, not the whole source-spec:
    // comparing the spec would refuse an ordinary version bump while leaving
    // the case it exists to catch untouched.
    expect(bumped.ok).toBe(true);
    const entries = await inventory.list();
    expect(entries.map((entry) => entry.ref)).toEqual(['v2.0.0']);
  });

  it('refuses a bounded update whose new source-spec resolves to a different template', async () => {
    const inventory = new TemplateInventory();

    const installed = await inventory.install(
      'github:acme/templates//shell@v1.0.0',
      fetchOf(subtreeBundleOf('shell', manifestOf('acme-shell'))),
    );
    const substituted = await inventory.updateLocal(
      'acme-shell',
      'github:acme/templates//mfe@v1.0.0',
      fetchOf(subtreeBundleOf('mfe', manifestOf('acme-mfe'))),
    );

    expect(installed.ok).toBe(true);
    expect(substituted.ok).toBe(false);
    if (substituted.ok) return;
    expect(substituted.error.message).toContain('acme-mfe');

    // A bounded update replaces the entry's content wholesale, so an accepted
    // substitution would have left `acme-mfe` sitting under `acme-shell`.
    const entries = await inventory.list();
    expect(entries.map((entry) => entry.name)).toEqual(['acme-shell']);
    expect(entries[0]?.source).toBe('github:acme/templates//shell@v1.0.0');
  });

  it('installs two templates from one repository when their manifests declare different identities', async () => {
    const inventory = new TemplateInventory();

    const shell = await inventory.install(
      'github:acme/templates//shell@v1.0.0',
      fetchOf(
        JSON.stringify({
          [BUNDLE_MARKER]: {
            [`shell/${MANIFEST_FILENAME}`]: JSON.stringify(manifestOf('acme-shell')),
          },
        }),
      ),
    );
    const mfe = await inventory.install(
      'github:acme/templates//mfe@v1.0.0',
      fetchOf(
        JSON.stringify({
          [BUNDLE_MARKER]: {
            [`mfe/${MANIFEST_FILENAME}`]: JSON.stringify(manifestOf('acme-mfe')),
          },
        }),
      ),
    );

    expect(shell.ok).toBe(true);
    expect(mfe.ok).toBe(true);
    const entries = await inventory.list();
    expect(entries.map((entry) => entry.name).sort()).toEqual(['acme-mfe', 'acme-shell']);
  });
});
