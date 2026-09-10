// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-install-by-spec:p1
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, it, expect, vi } from 'vitest';
import { createGithubFetchFn, resolveInventoryRoot } from '../github-fetch';
import { parseSourceSpec } from '../../spec-parser/parse';
import { resolveToInventory } from '../../resolver/resolve';

const TAR_BLOCK_SIZE = 512;

/** Builds a minimal ustar-format tar buffer wrapping `files` under a single
 * top-level `<owner>-<repo>-<sha>/` directory, matching the shape a GitHub
 * tarball-endpoint response has (before gzip). */
function makeGithubTarball(files: Record<string, string>, topLevelDir = 'acme-my-template-abc123'): Buffer {
  const chunks: Buffer[] = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const contentBuffer = Buffer.from(content, 'utf-8');
    const header = Buffer.alloc(TAR_BLOCK_SIZE);
    const name = `${topLevelDir}/${relativePath}`;
    header.write(name, 0, 'utf-8');
    header.write('0000644\0', 100, 'ascii'); // mode
    header.write('0000000\0', 108, 'ascii'); // uid
    header.write('0000000\0', 116, 'ascii'); // gid
    header.write(`${contentBuffer.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii'); // size
    header.write('00000000000\0', 136, 'ascii'); // mtime
    header.write('        ', 148, 'ascii'); // checksum placeholder (blanks) — permissive reader ignores it
    header.write('0', 156, 'ascii'); // typeflag: regular file
    header.write('ustar\x00\x00', 257, 'ascii'); // magic + version
    chunks.push(header);
    const padded = Math.ceil(contentBuffer.length / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    const contentBlock = Buffer.alloc(padded);
    contentBuffer.copy(contentBlock);
    chunks.push(contentBlock);
  }
  chunks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2)); // end-of-archive marker
  return Buffer.concat(chunks);
}

function makeGithubTarballResponse(files: Record<string, string>): Response {
  const gzipped = zlib.gzipSync(makeGithubTarball(files));
  return new Response(gzipped, { status: 200, statusText: 'OK' });
}

describe('createGithubFetchFn', () => {
  // inst-resolve-fetch / inst-resolve-addr — real fetch against the source
  // registry (cpt-frontx-actor-github) at the resolved ref, end-to-end
  // through parseSourceSpec -> resolveToInventory -> the real FetchFn, which
  // now GUNZIPs + UNTARs the tarball response into the
  // `$frontxTemplateFiles` bundle envelope `FsContentStore.writeBundle`
  // consumes.
  it('(a) fetches template content from the source registry, unpacks the tarball, and returns the bundle envelope — happy path', async () => {
    // Real contract fixture: the manifest FILENAME is `frontx-template.json`
    // (MANIFEST_FILENAME, `manifest/types.ts`) and identity is carried by the
    // `name` field (`manifest/validate-contract.ts`) — NOT `frontx.template.json`
    // with an `identity` field, which is not a shape this codebase ever reads.
    // "acme-widgets" is deliberately different from the repository segment
    // ("my-template" in the source-spec below), proving identity comes from
    // the manifest rather than from the repository name.
    const manifestJson = JSON.stringify({
      name: 'acme-widgets',
      version: '1.0.0',
      excludedSubtrees: [],
      description: 'Fixture template for GitHub fetch resolution tests.',
    });
    const fetchImpl = vi.fn(async () =>
      makeGithubTarballResponse({ 'frontx-template.json': manifestJson, 'src/index.ts': 'export {};' }),
    ) as unknown as typeof fetch;

    const fetchFn = createGithubFetchFn({ fetchImpl });

    const parsed = parseSourceSpec('github:acme/my-template@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const resolved = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn });

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(JSON.parse(resolved.value.content)).toEqual({
        $frontxTemplateFiles: {
          'frontx-template.json': manifestJson,
          'src/index.ts': 'export {};',
        },
      });
      expect(resolved.value.name).toBe('acme-widgets');
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/my-template/tarball/v1.0.0',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  // inst-resolve-write / inst-install-materialize — malformed/undecodable
  // tarball content fails explicitly rather than silently passing through.
  it('(d) rejects with a clear error when the response body is not valid gzip data', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not-gzip-bytes', { status: 200, statusText: 'OK' }),
    ) as unknown as typeof fetch;

    const fetchFn = createGithubFetchFn({ fetchImpl });

    await expect(fetchFn('https://api.github.com/repos/acme/my-template/tarball/v1.0.0')).rejects.toThrow(
      /not valid gzip data/,
    );
  });

  // inst-resolve-fetch-fail / inst-bupd-fetch-fail — rejection/error case:
  // the source registry returns a non-OK status; the real FetchFn throws so
  // the resolver reports a resolution error and writes nothing.
  it('(b) rejects when the source registry responds with a non-OK status', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not found', { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof fetch;

    const fetchFn = createGithubFetchFn({ fetchImpl });

    await expect(fetchFn('https://api.github.com/repos/acme/missing/tarball/v1.0.0')).rejects.toThrow(
      /404/,
    );

    const parsed = parseSourceSpec('github:acme/missing@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const resolved = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.error.message).toContain('Failed to fetch template from registry');
    }
  });

  // inst-resolve-pin — the tarball's own top-level `<owner>-<repo>-<sha>/`
  // segment is the immutable pin, captured for free from content already
  // fetched. The resolved `source` records the SHA, never the typed
  // `@v1.0.0` the developer wrote, while the fetch URL itself still
  // addresses the typed ref (that is what must be fetched).
  it('(e) captures the tarball\'s top-level SHA as the pin, and the resolved source-spec records it instead of the typed ref', async () => {
    const sha = '1234567890123456789012345678901234567890'; // 40 hex chars
    const manifestJson = JSON.stringify({
      name: 'acme-widgets',
      version: '1.0.0',
      excludedSubtrees: [],
      description: 'Fixture template for GitHub fetch pin tests.',
    });
    const gzipped = zlib.gzipSync(
      makeGithubTarball({ 'frontx-template.json': manifestJson }, `acme-my-template-${sha}`),
    );
    const fetchImpl = vi.fn(async () => new Response(gzipped, { status: 200, statusText: 'OK' })) as unknown as typeof fetch;

    const fetchFn = createGithubFetchFn({ fetchImpl });

    const parsed = parseSourceSpec('github:acme/my-template@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const resolved = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn });

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.source).toBe(`github:acme/my-template@${sha}`);
    }
    // The fetch itself still addresses the TYPED ref — the pin does not
    // exist until this very fetch returns, so it cannot steer its own URL.
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/my-template/tarball/v1.0.0',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  // inst-resolve-pin — owner and repo may themselves contain `-`, so the SHA
  // must be read as the LAST `-`-separated component, not a fixed-offset
  // slice that would misfire on `ac-me-my-templ-ate-<sha>`.
  it('(f) recovers the correct SHA when the owner and repository segments themselves contain hyphens', async () => {
    const sha = 'abcdef0123abcdef0123abcdef0123abcdef0123'; // 40 hex chars
    const manifestJson = JSON.stringify({
      name: 'acme-widgets',
      version: '1.0.0',
      excludedSubtrees: [],
      description: 'Fixture template for GitHub fetch pin tests.',
    });
    const gzipped = zlib.gzipSync(
      makeGithubTarball({ 'frontx-template.json': manifestJson }, `ac-me-my-templ-ate-${sha}`),
    );
    const fetchImpl = vi.fn(async () => new Response(gzipped, { status: 200, statusText: 'OK' })) as unknown as typeof fetch;

    const fetchFn = createGithubFetchFn({ fetchImpl });

    const parsed = parseSourceSpec('github:ac-me/my-templ-ate@v2.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const resolved = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn });

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.source).toBe(`github:ac-me/my-templ-ate@${sha}`);
    }
  });

  // inst-resolve-pin — a root segment whose last component is not hex-like
  // (or is the wrong length) yields NO pin: a wrong pin recorded as though
  // immutable is worse than none, so resolution falls back to the typed ref
  // rather than trusting a bogus candidate.
  // REGRESSION, found by a live fetch and not by any fixture: GitHub's tarball
  // root carries the ABBREVIATED sha, not the 40-character form. A real fetch
  // of this repository produced `gs-layer-gears-frontx-ee3d661/` — seven
  // characters — which a 40-only pattern rejected, so pinning silently never
  // fired in production while every unit test passed against a synthetic
  // 40-char fixture.
  it('accepts the 7-character abbreviated sha GitHub actually emits in the tarball root', async () => {
    const gzipped = zlib.gzipSync(
      makeGithubTarball({ 'frontx-template.json': '{"name":"t","version":"1.0.0","excludedSubtrees":[],"description":"d"}' }, 'gs-layer-gears-frontx-ee3d661'),
    );
    const fetchFn = createGithubFetchFn({
      fetchImpl: async () => new Response(gzipped, { status: 200, statusText: 'OK' }),
    });

    const result = await fetchFn('https://api.github.com/repos/gs-layer/gears-frontx/tarball/develop');

    expect(typeof result).not.toBe('string');
    if (typeof result === 'string') return;
    expect(result.pinnedRef).toBe('ee3d661');
  });

  // The floor still holds: something too short to be any sha is not a pin, so
  // a stray trailing segment cannot be recorded as though immutable.
  it('reports no pin for a trailing component too short to be a sha', async () => {
    const gzipped = zlib.gzipSync(makeGithubTarball({ 'frontx-template.json': '{"name":"t","version":"1.0.0","excludedSubtrees":[],"description":"d"}' }, 'owner-repo-1'));
    const fetchFn = createGithubFetchFn({
      fetchImpl: async () => new Response(gzipped, { status: 200, statusText: 'OK' }),
    });

    const result = await fetchFn('https://api.github.com/repos/owner/repo/tarball/develop');

    if (typeof result === 'string') return;
    expect(result.pinnedRef).toBeUndefined();
  });

  it('(g) yields no pin, and falls back to the typed ref, when the top-level segment\'s last component is not a valid hex SHA', async () => {
    const manifestJson = JSON.stringify({
      name: 'acme-widgets',
      version: '1.0.0',
      excludedSubtrees: [],
      description: 'Fixture template for GitHub fetch pin tests.',
    });
    // Last component is hex-shaped but only 6 characters — too short to be a
    // real commit SHA, and must not be half-trusted.
    const gzipped = zlib.gzipSync(makeGithubTarball({ 'frontx-template.json': manifestJson }, 'acme-my-template-abc123'));
    const fetchImpl = vi.fn(async () => new Response(gzipped, { status: 200, statusText: 'OK' })) as unknown as typeof fetch;

    const fetchFn = createGithubFetchFn({ fetchImpl });

    const parsed = parseSourceSpec('github:acme/my-template@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const resolved = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn });

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.source).toBe('github:acme/my-template@v1.0.0');
    }
  });

  it('(c) attaches an Authorization header when a token is supplied', async () => {
    const fetchImpl = vi.fn(async () =>
      makeGithubTarballResponse({ 'frontx.template.json': '{}' }),
    ) as unknown as typeof fetch;
    const fetchFn = createGithubFetchFn({ fetchImpl, token: 'abc123' });

    await fetchFn('https://api.github.com/repos/acme/my-template/tarball/v1.0.0');

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer abc123' }) }),
    );
  });
});

describe('resolveInventoryRoot', () => {
  // Inventory-root path resolution — homedir default vs cwd-relative override.
  it('(a) defaults to ~/.frontx/inventory under the user home directory', () => {
    const result = resolveInventoryRoot({ env: {} });
    expect(result).toBe(path.join(os.homedir(), '.frontx', 'inventory'));
  });

  it('(b) resolves a relative FRONTX_INVENTORY_ROOT override against the given cwd', () => {
    const result = resolveInventoryRoot({
      cwd: '/workspace/project',
      env: { FRONTX_INVENTORY_ROOT: '.frontx-inventory' },
    });
    expect(result).toBe(path.resolve('/workspace/project', '.frontx-inventory'));
  });

  it('(c) uses an absolute FRONTX_INVENTORY_ROOT override verbatim, ignoring cwd', () => {
    const result = resolveInventoryRoot({
      cwd: '/workspace/project',
      env: { FRONTX_INVENTORY_ROOT: '/custom/inventory-root' },
    });
    expect(result).toBe('/custom/inventory-root');
  });
});
