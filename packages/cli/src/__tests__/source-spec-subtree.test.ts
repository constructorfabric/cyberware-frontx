// @cpt-algo:cpt-frontx-algo-template-resolution-parse-spec:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-spec-parser-rejection:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-install-by-spec:p1
import { describe, it, expect } from 'vitest';
import { MANIFEST_FILENAME } from '../manifest/types';
import type { TemplateManifest } from '../manifest/types';
import { narrowBundleToSubtree } from '../resolver/narrow-subtree';
import { resolveToInventory } from '../resolver/resolve';
import type { FetchFn } from '../resolver/types';
import { parseSourceSpec } from '../spec-parser/parse';

// F10: cpt-frontx-algo-template-resolution-parse-spec
//   (inst-parse-extract-subtree, inst-parse-invalid-path, inst-parse-return),
// cpt-frontx-algo-template-resolution-resolve-to-inventory
//   (inst-resolve-addr, inst-resolve-subtree, inst-resolve-subtree-empty)

const BUNDLE_MARKER = '$frontxTemplateFiles';

// Neutral fixture identity: deliberately unrelated to any repository segment
// used in these specs, so nothing here can pass by the two coinciding.
function manifestOf(name: string): TemplateManifest {
  return {
    name,
    version: '1.0.0',
    excludedSubtrees: [],
    description: 'Fixture template for subtree-addressed source-spec tests.',
  };
}

function bundleOf(files: Record<string, string>): string {
  return JSON.stringify({ [BUNDLE_MARKER]: files });
}

function filesOf(content: string): Record<string, string> {
  return JSON.parse(content)[BUNDLE_MARKER] as Record<string, string>;
}

describe('parseSourceSpec — subtree segment (inst-parse-extract-subtree, inst-parse-invalid-path)', () => {
  it('parses a reference carrying a subtree into its five constituent parts', () => {
    const result = parseSourceSpec('github:acme/templates//shell@v1.2.0');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual({
      host: 'github',
      owner: 'acme',
      repo: 'templates',
      subtree: 'shell',
      ref: 'v1.2.0',
    });
  });

  it('omits the subtree field entirely for a reference written without one', () => {
    const result = parseSourceSpec('github:acme/my-template@v1.2.0');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Absent rather than undefined: a reference written before the segment
    // existed must parse into exactly the four parts it produced then.
    expect(result.value).toEqual({
      host: 'github',
      owner: 'acme',
      repo: 'my-template',
      ref: 'v1.2.0',
    });
    expect('subtree' in result.value).toBe(false);
  });

  it('splits at the first separator so a subtree may itself carry path segments', () => {
    const result = parseSourceSpec('github:acme/templates//packages/shell@v1.2.0');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.repo).toBe('templates');
    expect(result.value.subtree).toBe('packages/shell');
  });

  it('refuses a repository path carrying more than two segments', () => {
    // Before the subtree segment existed this parsed with repo === 'templates/shell',
    // which the resolver then used verbatim as the installed identity — a nested
    // inventory path when the fetch succeeded, an opaque 404 when it did not.
    const result = parseSourceSpec('github:acme/templates/shell@v1.2.0');

    expect(result.ok).toBe(false);
  });

  it('refuses a repository path carrying a single segment', () => {
    const result = parseSourceSpec('github:acme@v1.2.0');

    expect(result.ok).toBe(false);
  });

  it('refuses an empty subtree segment', () => {
    const result = parseSourceSpec('github:acme/templates//@v1.2.0');

    expect(result.ok).toBe(false);
  });

  it('refuses a subtree segment ending in a separator', () => {
    const result = parseSourceSpec('github:acme/templates//shell/@v1.2.0');

    expect(result.ok).toBe(false);
  });

  it('refuses a subtree segment that traverses above the repository', () => {
    const result = parseSourceSpec('github:acme/templates//../elsewhere@v1.2.0');

    expect(result.ok).toBe(false);
  });

  it('refuses a subtree segment carrying an empty interior segment', () => {
    const result = parseSourceSpec('github:acme/templates//packages//shell@v1.2.0');

    expect(result.ok).toBe(false);
  });

  it('refuses a subtree segment carrying a current-directory segment', () => {
    const result = parseSourceSpec('github:acme/templates//./shell@v1.2.0');

    expect(result.ok).toBe(false);
  });

  it('refuses an empty host, which the reference shape declares mandatory', () => {
    const result = parseSourceSpec(':acme/templates@v1.2.0');

    expect(result.ok).toBe(false);
  });

  it('refuses an empty version selector, which the reference shape declares mandatory', () => {
    const result = parseSourceSpec('github:acme/templates@');

    expect(result.ok).toBe(false);
  });

  it('accepts a version selector that itself carries an at-sign, since only the first one bounds it', () => {
    const result = parseSourceSpec('github:acme/templates@release@2');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ref).toBe('release@2');
  });

  it('refuses a subtree segment padded with whitespace rather than deferring the failure to acquisition', () => {
    const result = parseSourceSpec('github:acme/templates// shell@v1.2.0');

    expect(result.ok).toBe(false);
  });

  it('refuses a subtree segment carrying a backslash', () => {
    const result = parseSourceSpec('github:acme/templates//sh\\ell@v1.2.0');

    expect(result.ok).toBe(false);
  });

  // Only the FIRST colon bounds the host, so a later one reaches the subtree
  // segment, where it would designate a Windows drive once the segment is
  // resolved against the inventory root.
  it('refuses a subtree segment carrying a colon', () => {
    const result = parseSourceSpec('github:acme/templates//sh:ell@v1.2.0');

    expect(result.ok).toBe(false);
  });

});

describe('narrowBundleToSubtree (inst-resolve-subtree)', () => {
  it('keeps only the files under the subtree and re-roots each retained path', () => {
    const acquired = bundleOf({
      'shell/frontx-template.json': 'shell-manifest',
      'shell/src/index.ts': 'shell-source',
      'mfe/frontx-template.json': 'mfe-manifest',
      'README.md': 'repository-readme',
    });

    const narrowed = narrowBundleToSubtree(acquired, 'shell');

    expect(narrowed.ok).toBe(true);
    if (!narrowed.ok) return;

    // Re-rooting is load-bearing, not cosmetic: downstream reads look the
    // manifest up by its exact unprefixed filename.
    expect(filesOf(narrowed.content)).toEqual({
      'frontx-template.json': 'shell-manifest',
      'src/index.ts': 'shell-source',
    });
  });

  it('refuses with empty-subtree when no acquired path lies under the subtree', () => {
    const acquired = bundleOf({ 'mfe/frontx-template.json': 'mfe-manifest' });

    const narrowed = narrowBundleToSubtree(acquired, 'shell');

    expect(narrowed.ok).toBe(false);
    if (narrowed.ok) return;
    expect(narrowed.reason).toBe('empty-subtree');
    expect(narrowed.subtree).toBe('shell');
  });

  it('refuses with no-bundle when the acquired content is a bare manifest rather than a file map', () => {
    const narrowed = narrowBundleToSubtree(JSON.stringify(manifestOf('solo')), 'shell');

    expect(narrowed.ok).toBe(false);
    if (narrowed.ok) return;
    expect(narrowed.reason).toBe('no-bundle');
  });

  it('refuses with escaping-path when re-rooting would lift a retained path out of the subtree', () => {
    // The acquired key does not escape the repository; stripping the `shell/`
    // prefix is what makes it escape, so the parser cannot have caught it.
    const acquired = bundleOf({
      'shell/frontx-template.json': 'shell-manifest',
      'shell/../../evil.txt': 'payload',
    });

    const narrowed = narrowBundleToSubtree(acquired, 'shell');

    expect(narrowed.ok).toBe(false);
    if (narrowed.ok || narrowed.reason !== 'escaping-path') {
      expect.unreachable('narrowing must refuse an escaping re-rooted path');
    }
    expect(narrowed.path).toBe('shell/../../evil.txt');
  });
});

describe('resolveToInventory — subtree-addressed references (inst-resolve-addr, inst-resolve-subtree, inst-resolve-subtree-empty)', () => {
  const repositoryBundle = bundleOf({
    [`shell/${MANIFEST_FILENAME}`]: JSON.stringify(manifestOf('acme-shell')),
    'shell/src/index.ts': 'shell-source',
    [`mfe/${MANIFEST_FILENAME}`]: JSON.stringify(manifestOf('acme-mfe')),
  });

  function fetchOf(content: string, urls: string[]): FetchFn {
    return async (url: string) => {
      urls.push(url);
      return content;
    };
  }

  // Criterion: a subtree whose acquired content carries a path that escapes the
  // subtree once re-rooted is refused with `INVALID_PATH`, and nothing is
  // written to the local inventory. The code is what the assertion is about:
  // every subtree failure used to arrive codeless and be painted over by the
  // dispatcher's `?? 'ORIGIN_UNAVAILABLE'` default, so a containment refusal
  // was reported as an unreachable origin. `narrowBundleToSubtree` had the
  // discriminated reason all along; its caller discarded it.
  it('refuses an escaping re-rooted path with INVALID_PATH, distinctly from an origin that yields nothing', async () => {
    const escaping = bundleOf({
      [`shell/${MANIFEST_FILENAME}`]: JSON.stringify(manifestOf('shell')),
      'shell/../sibling/evil.txt': 'reaches outside the subtree once re-rooted',
    });
    const parsed = parseSourceSpec('github:acme/templates//shell@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn: fetchOf(escaping, []) });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_PATH');
    expect(result.error.message).toContain('outside the subtree');
  });

  // The companion half: a subtree holding no content at the referenced version
  // carries NO resolver-owned code, because the origin failing to yield what
  // was addressed is the caller's `ORIGIN_UNAVAILABLE` to name. Asserted so the
  // two refusals stay distinguishable — that distinction is the whole point of
  // the change above, and an accidental widening here would erase it.
  it('leaves an empty subtree without a resolver-owned code, so the caller names it', async () => {
    const empty = bundleOf({ [`other/${MANIFEST_FILENAME}`]: JSON.stringify(manifestOf('other')) });
    const parsed = parseSourceSpec('github:acme/templates//shell@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn: fetchOf(empty, []) });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBeUndefined();
    expect(result.error.message).toContain('holds no content');
  });

  it('narrows the acquired content to the addressed subtree and leaves the sibling out', async () => {
    const parsed = parseSourceSpec('github:acme/templates//shell@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn: fetchOf(repositoryBundle, []) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(filesOf(result.value.content)).sort()).toEqual([
      MANIFEST_FILENAME,
      'src/index.ts',
    ]);
  });

  it('records a source-spec that retains the subtree so a later re-resolution addresses the same template', async () => {
    const parsed = parseSourceSpec('github:acme/templates//shell@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn: fetchOf(repositoryBundle, []) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A provenance record stores this string and upgrade re-resolves through
    // it; dropping the segment would silently re-resolve the repository root.
    expect(result.value.source).toBe('github:acme/templates//shell@v1.0.0');
  });

  it('fetches the whole repository, keeping the subtree out of the acquisition address', async () => {
    const parsed = parseSourceSpec('github:acme/templates//shell@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const urls: string[] = [];
    await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn: fetchOf(repositoryBundle, urls) });

    expect(urls).toEqual(['https://api.github.com/repos/acme/templates/tarball/v1.0.0']);
  });

  it('refuses a reference whose subtree carries a path that escapes once re-rooted, before returning any record', async () => {
    const parsed = parseSourceSpec('github:acme/templates//shell@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const hostile = bundleOf({
      [`shell/${MANIFEST_FILENAME}`]: JSON.stringify(manifestOf('acme-shell')),
      'shell/../../evil.txt': 'payload',
    });
    const result = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn: fetchOf(hostile, []) });

    // The resolver must refuse before it returns a record, so nothing reaches
    // the content store and no guard further down has to catch it by throwing.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('shell/../../evil.txt');
  });

  it('refuses a subtree-addressed reference whose acquired content is not a bundle', async () => {
    const parsed = parseSourceSpec('github:acme/templates//shell@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await resolveToInventory(
      { kind: 'remote', ref: parsed.value },
      { fetchFn: fetchOf(JSON.stringify(manifestOf('acme-shell')), []) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('not a multi-file bundle');
  });

  it('refuses a reference whose subtree holds no content at the referenced version', async () => {
    const parsed = parseSourceSpec('github:acme/templates//absent@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn: fetchOf(repositoryBundle, []) });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The appended source-spec already carries the subtree name, so only the
    // whole clause proves the narrowing message names it too.
    expect(result.error.message).toContain('Subtree "absent" holds no content');
  });

  it('resolves two subtrees of one repository at one version to two distinct identities', async () => {
    const shell = parseSourceSpec('github:acme/templates//shell@v1.0.0');
    const mfe = parseSourceSpec('github:acme/templates//mfe@v1.0.0');
    if (!shell.ok || !mfe.ok) {
      expect.unreachable('both fixture references must parse');
    }

    const shellResult = await resolveToInventory({ kind: 'remote', ref: shell.value }, { fetchFn: fetchOf(repositoryBundle, []) });
    const mfeResult = await resolveToInventory({ kind: 'remote', ref: mfe.value }, { fetchFn: fetchOf(repositoryBundle, []) });

    expect(shellResult.ok).toBe(true);
    expect(mfeResult.ok).toBe(true);
    if (!shellResult.ok || !mfeResult.ok) return;
    expect([shellResult.value.name, mfeResult.value.name]).toEqual(['acme-shell', 'acme-mfe']);
  });
});
