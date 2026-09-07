// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { BUNDLE_MARKER } from '../bundle/envelope';
import type { FetchFn, FetchResult } from '../resolver/types';

// A commit SHA, as GitHub's tarball response actually exposes it, is
// 7-to-40 lowercase-or-uppercase hex characters — not a fixed 40. Validated
// before ever being trusted as a pin (`inst-resolve-pin`'s own requirement):
// a wrong pin recorded as though immutable is worse than none, because
// nothing downstream re-checks it — `cpt-frontx-adr-project-upgrade-
// mechanism`'s baseline re-resolution takes a recorded pin on faith.
// Anything outside that range, or non-hex, is refused rather than
// half-trusted.
//
// MEASURED, not assumed: GitHub names a tarball's single root directory
// `<owner>-<repo>-<sha>`, and that `<sha>` is the ABBREVIATED form — a real
// fetch of this repository's own branch yields `gs-layer-gears-
// frontx-ee3d661/`, seven characters. A pattern requiring a full forty hex
// characters would reject every such directory: `extractPinnedSha` would
// return `undefined`, and `register` would silently record the typed,
// moving branch ref instead. Unit tests would pass throughout that failure,
// since a fixture built around a synthetic 40-character SHA never exercises
// the abbreviated shape GitHub actually produces — only a live fetch
// surfaces the gap, which is why this pattern is validated against the
// measured range rather than a fixed length.
//
// Seven is the lower bound because that is what GitHub emits; forty is the
// upper bound because that is a full SHA. Nothing shorter is accepted, so a
// stray `<owner>-<repo>-1` cannot be mistaken for a pin.
//
// KNOWN LIMITATION, recorded rather than papered over: an abbreviation is a
// PREFIX, and `cpt-frontx-adr-project-upgrade-mechanism` asks for "the exact
// immutable commit SHA". It is immutable in the property that matters — it
// names one commit and does not follow the branch, so a recorded origin
// re-resolves to the same content instead of drifting — but a prefix can in
// principle become ambiguous in a long-lived repository. Should that happen,
// GitHub fails the request rather than silently serving a different commit, so
// the failure mode is loud. Obtaining the full forty characters would require
// a SECOND API request per resolution (`/repos/:owner/:repo/commits/:ref`),
// which the tarball response itself cannot supply: its `location` carries the
// branch ref, its `content-disposition` repeats this same abbreviation, and
// its `etag` is the archive's SHA-256, not a commit id. That trade is stated
// here so a later reader can take it deliberately rather than rediscover it.
const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

// Real network `FetchFn` implementation — the source-registry actor
// (`cpt-frontx-actor-github`) this package fetches template content from at
// install (`inst-resolve-fetch`) and bounded local-update
// (`inst-bupd-fetch`) time. Given the fetch address the pure-logic resolver
// already built (`resolveToInventory`'s `buildFetchUrl`,
// `cpt-frontx-algo-template-resolution-resolve-to-inventory` inst-resolve-addr),
// this adapter performs the actual HTTP GET against the GitHub source
// registry, then GUNZIPs + UNTARs the response body (GitHub's tarball
// endpoint returns a gzipped tar of the repo at the given ref) and returns
// the `{ "$frontxTemplateFiles": { <relative path>: <file text>, ... } }`
// bundle envelope that `FsContentStore.writeBundle`
// (`packages/cli/src/adapters/fs-content-store.ts`) already materializes
// into the template's actual on-disk files
// (`cpt-frontx-dod-template-resolution-install-by-spec`, `inst-resolve-write`,
// `inst-install-materialize`) — never a single opaque blob. The envelope is
// returned as its JSON-serialized string form, alongside the immutable commit
// SHA this adapter recovers from the tarball's own top-level directory name
// (`inst-resolve-pin`) — the `FetchFn` seam contract
// (`packages/cli/src/resolver/types.ts`) widens additively to
// `Promise<string | FetchResult>` for exactly this: an adapter with a pin to
// report returns `FetchResult`, one without (still) returns a bare string.
// Pure-logic core (`resolver/resolve.ts`, `inventory/TemplateInventory.ts`)
// interprets that union; this file is the IO-only realization plugged in
// behind the same injected seam.
export interface GithubFetchOptions {
  /** Optional bearer token for authenticated requests against private repos / higher rate limits. */
  token?: string;
  /** Injectable fetch implementation — defaults to the platform global `fetch`. Enables deterministic tests. */
  fetchImpl?: typeof fetch;
  /** Extra headers merged into every request (e.g. Accept override). */
  headers?: Record<string, string>;
}

export function createGithubFetchFn(options: GithubFetchOptions = {}): FetchFn {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async function githubFetch(url: string): Promise<FetchResult> {
    const headers: Record<string, string> = {
      'User-Agent': '@gears-frontx/cli',
      Accept: 'application/vnd.github+json',
      ...options.headers,
    };
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }

    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-fetch
    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-fetch
    const response = await fetchImpl(url, { headers });
    if (!response.ok) {
      throw new Error(
        `GitHub fetch failed for "${url}": ${response.status} ${response.statusText}`,
      );
    }
    const tarballBytes = Buffer.from(await response.arrayBuffer());
    const { files, pinnedRef } = unpackGithubTarball(url, tarballBytes);
    const content = JSON.stringify({ [BUNDLE_MARKER]: files });
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-pin
    // GitHub always wraps a tarball's content in a single top-level
    // `<owner>-<repo>-<sha>/` directory (`unpackGithubTarball` below strips
    // exactly that segment) — the immutable commit the resolver needs to
    // pin against is sitting right there, for free, rather than requiring a
    // second API call. Reported alongside `content` rather than dropped, so
    // `resolveToInventory` can record it as the origin instead of the typed,
    // possibly-moving `@ref` (`inst-resolve-pin`).
    return { content, pinnedRef };
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-pin
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-fetch
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-fetch
  };
}

const TAR_BLOCK_SIZE = 512;

interface UnpackedGithubTarball {
  files: Record<string, string>;
  // The commit SHA recovered from the tarball's own top-level directory
  // name, when that segment's last `-`-separated component validates as a
  // hex SHA in the 7-to-40 form GitHub actually emits there
  // (`GIT_SHA_PATTERN`). `undefined` when the archive carried no top-level
  // segment at all (pathological) or the last component does not look like
  // a SHA — an absent pin is honest; a wrong one recorded as immutable is
  // not (`inst-resolve-pin`).
  pinnedRef?: string;
}

/**
 * GUNZIPs the GitHub tarball response and UNTARs it into a flat map of
 * `relative path -> file text`, stripping the single top-level
 * `<owner>-<repo>-<sha>/` directory GitHub always wraps tarball content in.
 * Fails explicitly (clear error, no silent passthrough) on undecodable gzip
 * data, a malformed tar stream, or a tarball that yields zero files.
 */
function unpackGithubTarball(url: string, tarballBytes: Buffer): UnpackedGithubTarball {
  let tarBytes: Buffer;
  try {
    tarBytes = zlib.gunzipSync(tarballBytes);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw Object.assign(
      new Error(`GitHub tarball for "${url}" is not valid gzip data: ${detail}`),
      { cause: err }
    );
  }

  const files: Record<string, string> = {};
  // Captured from the FIRST entry that carries a `/` — every entry shares
  // the identical top-level segment, so one capture suffices; entries with
  // no `/` at all (pathological) never set it, and the pin stays absent
  // rather than guessed at.
  let topLevelDir: string | undefined;
  let offset = 0;
  while (offset + TAR_BLOCK_SIZE <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) break; // end-of-archive marker

    const rawName = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/, '');
    const sizeField = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = sizeField.length > 0 ? parseInt(sizeField, 8) : 0;
    if (Number.isNaN(size) || size < 0) {
      throw new Error(`GitHub tarball for "${url}" has a malformed entry size at offset ${offset}.`);
    }
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const magic = header.subarray(257, 263).toString('ascii');
    const prefix =
      magic.startsWith('ustar') ? header.subarray(345, 500).toString('utf-8').replace(/\0.*$/, '') : '';
    const entryName = prefix ? `${prefix}/${rawName}` : rawName;

    offset += TAR_BLOCK_SIZE;
    if (offset + size > tarBytes.length) {
      throw new Error(`GitHub tarball for "${url}" is truncated at entry "${entryName}".`);
    }
    const content = tarBytes.subarray(offset, offset + size);
    offset += Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;

    // '0' and '\0' are regular files; directories ('5'), pax/global-pax
    // extended headers ('x'/'g'), and other typeflags carry no materializable
    // file content for this adapter's purposes.
    if (typeflag !== '0' && typeflag !== '\0') continue;

    // Strip the single top-level `<owner>-<repo>-<sha>/` directory segment
    // GitHub always wraps tarball content in.
    const separatorIndex = entryName.indexOf('/');
    if (topLevelDir === undefined && separatorIndex >= 0) {
      topLevelDir = entryName.slice(0, separatorIndex);
    }
    const relativePath = separatorIndex >= 0 ? entryName.slice(separatorIndex + 1) : entryName;
    if (relativePath.length === 0) continue;

    files[relativePath] = content.toString('utf-8');
  }

  if (Object.keys(files).length === 0) {
    throw new Error(`GitHub tarball for "${url}" unpacked to zero files.`);
  }

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-pin
  // Owner and repo may themselves contain `-`, so the SHA is the LAST
  // `-`-separated component of `<owner>-<repo>-<sha>`, not a fixed-offset
  // slice. `lastIndexOf('-')` finds that split without allocating an array
  // for every other component we would otherwise discard.
  const pinnedRef = extractPinnedSha(topLevelDir);
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-pin

  return pinnedRef !== undefined ? { files, pinnedRef } : { files };
}

// @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-pin
// A wrong pin recorded as though immutable is worse than none — it would be
// trusted by every later re-resolution
// (`cpt-frontx-adr-project-upgrade-mechanism`'s baseline story) while
// addressing nothing. So this returns `undefined`, never a best-effort
// guess, whenever the candidate does not match `GIT_SHA_PATTERN` — the 7-to-40
// hex form GitHub's tarball root directory actually carries, as that
// pattern's own comment sets out.
function extractPinnedSha(topLevelDir: string | undefined): string | undefined {
  if (topLevelDir === undefined) return undefined;
  const lastDash = topLevelDir.lastIndexOf('-');
  if (lastDash === -1) return undefined;
  const candidate = topLevelDir.slice(lastDash + 1);
  return GIT_SHA_PATTERN.test(candidate) ? candidate : undefined;
}
// @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-pin

// Inventory-root path resolution — the local inventory store root
// (`cpt-frontx-adr-template-acquisition-and-location`) that
// `resolveInstalledContentPath` (`fs-installed-content-path.ts`) resolves
// every installed template's on-disk path relative to. Not itself a
// CDSL-designated instruction (like `resolveInstalledContentPath`, it carries
// no @cpt-begin/@cpt-end marker of its own), but the IO-only decision this
// phase must supply: where the tracked local inventory lives on disk.
//
// Precedence: an explicit `FRONTX_INVENTORY_ROOT` override — resolved against
// `cwd` when given as a relative path — takes precedence over the default
// per-user home-directory location (`~/.frontx/inventory`), so a developer or
// CI job can redirect the inventory into a project-local or ephemeral
// directory without changing any calling code.
export interface ResolveInventoryRootOptions {
  cwd?: string;
  env?: Partial<Record<string, string | undefined>>;
}

export function resolveInventoryRoot(options: ResolveInventoryRootOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env.FRONTX_INVENTORY_ROOT;
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(options.cwd ?? process.cwd(), override);
  }
  return path.join(os.homedir(), '.frontx', 'inventory');
}
