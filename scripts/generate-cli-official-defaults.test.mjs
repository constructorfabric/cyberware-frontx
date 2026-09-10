// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
//
// Covers the generator that writes the CLI's official-default registry
// (`packages/cli/src/generated/official-defaults.ts`). That file is generated
// rather than hand-authored because
// `cpt-frontx-constraint-cli-template-independence` (CLI-1) forbids a
// hardcoded template package name in `packages/cli/src`, and `arch:check`
// fails on one — so the properties asserted here (keyed by MANIFEST-declared
// name, origin naming the template's own DIRECTORY, discovery by manifest
// presence) are what keep the generated map correct rather than merely
// present.
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverOfficialDefaults, renderModule } from './generate-cli-official-defaults.mjs';
import { MANIFEST_FILENAME } from './template-discovery.mjs';

/** @type {string | undefined} */
let rootDir;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

async function makeRoot() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-official-defaults-'));
  return rootDir;
}

/**
 * @param {string} dir
 * @param {Record<string, unknown>} manifest
 */
async function writeTemplate(dir, manifest) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, MANIFEST_FILENAME), JSON.stringify(manifest));
}

describe('discoverOfficialDefaults', () => {
  // The load-bearing property: the KEY is the manifest's own `name`, not the
  // directory name. That identity is what `register`/`apply` key every other
  // lookup by, so a batch entry naming a template must resolve to the same
  // identity `list`/`register` would report for it.
  it('keys each entry by the manifest-declared name and maps it to a path: origin naming the directory', async () => {
    const root = await makeRoot();
    await writeTemplate(path.join(root, 'template-shell'), { name: '@acme/shell', version: '1.0.0' });
    await writeTemplate(path.join(root, 'renamed-dir'), { name: '@acme/mfe', version: '2.0.0' });

    expect(discoverOfficialDefaults(root)).toEqual({
      '@acme/shell': 'path:template-shell',
      '@acme/mfe': 'path:renamed-dir',
    });
  });

  // Discovery is by manifest presence (ADR-0018), through the ONE shared
  // `findTemplateDirs` rule — never a `template-*` name glob.
  it('ignores a directory carrying no manifest, whatever it is named', async () => {
    const root = await makeRoot();
    await writeTemplate(path.join(root, 'template-shell'), { name: '@acme/shell', version: '1.0.0' });
    await mkdir(path.join(root, 'template-looks-like-one-but-is-not'), { recursive: true });
    await mkdir(path.join(root, 'packages'), { recursive: true });

    expect(Object.keys(discoverOfficialDefaults(root))).toEqual(['@acme/shell']);
  });

  it('fails loudly on a manifest declaring no usable name rather than emitting a bogus key', async () => {
    const root = await makeRoot();
    await writeTemplate(path.join(root, 'template-broken'), { version: '1.0.0' });

    expect(() => discoverOfficialDefaults(root)).toThrow(/declares no usable "name"/);
  });
});

describe('renderModule', () => {
  it('emits a module whose entries are sorted, so regeneration is byte-stable across filesystem ordering', () => {
    const rendered = renderModule({ '@acme/zeta': 'path:z', '@acme/alpha': 'path:a' });

    expect(rendered.indexOf('@acme/alpha')).toBeLessThan(rendered.indexOf('@acme/zeta'));
    expect(rendered).toContain('export const OFFICIAL_DEFAULT_TEMPLATES: Readonly<Record<string, string>> = {');
    expect(rendered).toContain('DO NOT EDIT');
  });

  it('is deterministic: the same map renders byte-identically, so the generator is a no-op when nothing changed', () => {
    const map = { '@acme/alpha': 'path:a', '@acme/zeta': 'path:z' };
    expect(renderModule(map)).toBe(renderModule({ '@acme/zeta': 'path:z', '@acme/alpha': 'path:a' }));
  });
});
