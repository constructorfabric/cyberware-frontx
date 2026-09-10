// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-staged-mode:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-manifest-identity:p1
import path from 'node:path';
import { readManifestFromContent } from '../manifest/validate-contract';
import { isSafeRelativePath } from '../paths/relative-path';
import { MANIFEST_FILENAME } from '../manifest/types';
import { BUNDLE_MARKER } from '../bundle/envelope';
import type { StructuredRef } from '../spec-parser/types';
import { formatTemplateAddress } from '../spec-parser/parse';
import { narrowBundleToSubtree } from './narrow-subtree';
import { LOCAL_ORIGIN_PREFIX } from './types';
import type { FetchFn, ResolveDeps, ResolveOrigin, ResolveResult } from './types';
import { NotRegularFileError, UnreachablePathError, PathUnreadableError } from '../adapters/fs-project-io';

// @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-origin-kind-check
/**
 * `cpt-frontx-algo-template-resolution-resolve-to-inventory` — the one
 * resolver every install, register, apply, and upgrade routes acquisition
 * and pinning through (`cpt-frontx-constraint-cli-shared-resolver`, CLI-2).
 * Branches on the input's own `kind`: a `{kind:'local', origin}` names a
 * folder inside the project's own tree and never touches the network or the
 * local inventory store; a `{kind:'remote', ref}` fetches from the source
 * registry exactly as before. Both arms converge on the SAME manifest-
 * identity resolution (`resolveManifestIdentity` below), so a local origin
 * gets legacy-manifest refusal and identity validation for free, from the
 * identical check a remote origin has always gone through, rather than a
 * second, independently-maintained formulation.
 */
export async function resolveToInventory(origin: ResolveOrigin, deps: ResolveDeps): Promise<ResolveResult> {
  if (origin.kind === 'local') {
    return resolveLocalOrigin(origin.origin, deps);
  }
  return resolveRemoteOrigin(origin.ref, deps.fetchFn);
}
// @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-origin-kind-check

async function resolveLocalOrigin(rawOrigin: string, deps: ResolveDeps): Promise<ResolveResult> {
  const local = deps.local;
  if (!local) {
    // A caller constructing `{kind:'local', origin}` without supplying
    // `deps.local` is a wiring bug, not a resolvable input: every caller
    // that can produce this origin kind (`commands/register.ts`,
    // `scaffold/assembler.ts`, `upgrade/payload.ts`) always supplies the
    // matching deps in the same call. Thrown rather than folded into
    // `INVALID_PATH` so a missing seam fails loudly in development instead
    // of being silently misreported as a user-facing path error.
    throw new Error(
      `resolveToInventory: local origin "${rawOrigin}" requires deps.local (canonicalizeFn/existsFn/` +
        'listFolderFilesFn/readFolderFileFn) to be supplied.',
    );
  }

  const relativePath = rawOrigin.slice(LOCAL_ORIGIN_PREFIX.length);

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-local-path-check
  // Canonicalize AND confirm existence — two separate checks, because
  // canonicalization alone cannot prove the second: the real adapter walks
  // up to the nearest EXISTING ancestor and returns a canonical spelling
  // even for a path that does not itself exist yet (deliberate for a
  // pre-flight TARGET check elsewhere in this package, wrong here). The
  // project root itself (canonically `.`, never `''` per every real
  // adapter's own documented contract) is refused alongside an escape:
  // a root-spelled local origin folder would later subtract EVERYTHING from
  // its own template's effective ownership at every target it is applied
  // to (`scaffold/effective-ownership.ts`'s sixth subtraction term) — a
  // domain-specific consequence, but refusing it here, once, in the shared
  // resolver keeps every caller from having to reject it a second time.
  const canonical = local.canonicalizeFn(relativePath);
  const isRoot = canonical === '.' || canonical === '';
  const absoluteDir = canonical !== null && !isRoot ? path.join(local.repoRoot, canonical) : null;
  const exists = absoluteDir !== null && (await local.existsFn(absoluteDir));
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-local-path-check

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-local-path-fail-check
  if (canonical === null || isRoot || absoluteDir === null || !exists) {
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-local-path-fail
    // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
    return {
      ok: false,
      error: {
        code: 'INVALID_PATH',
        message:
          `Local origin "${rawOrigin}" could not be proven to stay inside the project root, ` +
          'names the project root itself, or does not exist.',
      },
    };
    // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-local-path-fail
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-local-path-fail-check

  // Recorded EXACTLY as given, never pinned: a local origin has no separate
  // publication to resolve to an immutable form
  // (`cpt-frontx-adr-source-spec-syntax`).
  const source = rawOrigin;

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-local-path-read
  // The manifest is read FIRST, on its own — before enumerating the rest of
  // the folder — so a folder whose manifest is legacy-shaped or otherwise
  // unusable is refused by the shared manifest-identity tail below without
  // ever walking the folder's other content (mirrors, for a local origin,
  // the fact that `readManifestFromContent` already unwraps a bundle down to
  // its manifest entry before validating it). A genuinely absent manifest is
  // not special-cased: it is handed to the identical tail as an empty
  // string, which fails the same "no readable manifest" refusal a corrupt
  // remote manifest already produces, rather than a local-specific second
  // formulation of the same check.
  //
  // A TYPED refusal from the read seam is different: something real stands
  // at the manifest path and was inspected (a FIFO, socket, device,
  // directory, or dangling symlink; an ancestor that is not a directory; or
  // a path the probe accepts but cannot actually open) — folding that into
  // the same empty string this branch uses for absence would report it to
  // `readManifestFromContent` as unparseable JSON, which is not what
  // happened: nothing was ever parsed, because nothing was ever read.
  // Refusing here, naming what actually stood in the way, is what keeps
  // `register`/`install`/`apply`'s own eventual refusal message truthful.
  let manifestText: string;
  try {
    manifestText = await local.readFolderFileFn(path.join(absoluteDir, MANIFEST_FILENAME));
  } catch (error) {
    if (error instanceof NotRegularFileError || error instanceof UnreachablePathError || error instanceof PathUnreadableError) {
      return {
        ok: false,
        error: {
          code: 'CONTENT_CONFLICT',
          message: `Local origin "${rawOrigin}"'s manifest could not be read: ${error.message}`,
        },
      };
    }
    manifestText = '';
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-local-path-read

  const identity = resolveManifestIdentity(manifestText, source);
  if (!identity.ok) return identity.result;

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-local-path-continue
  // The manifest is valid — proceed to the acquired content the shared tail
  // needs, per this step's own text: the folder's current content, enriched
  // from the bare manifest text just validated into the full bundle
  // envelope (`bundle/envelope.ts`'s `$frontxTemplateFiles`) every other
  // multi-file acquisition in this codebase already uses, so the shared tail
  // above, and every downstream reader of `InventoryReadyRecord.content`,
  // sees the identical shape regardless of origin kind.
  let content: string;
  try {
    const relativeFiles = await local.listFolderFilesFn(absoluteDir);
    const files: Record<string, string> = { [MANIFEST_FILENAME]: manifestText };
    for (const relativeFile of relativeFiles) {
      if (relativeFile === MANIFEST_FILENAME) continue; // already read above; never re-read
      files[relativeFile] = await local.readFolderFileFn(path.join(absoluteDir, relativeFile));
    }
    content = JSON.stringify({ [BUNDLE_MARKER]: files });
  } catch (readError) {
    const detail = readError instanceof Error ? readError.message : String(readError);
    return {
      ok: false,
      error: { code: 'INVALID_PATH', message: `Local origin "${rawOrigin}"'s content could not be read: ${detail}` },
    };
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-local-path-continue

  return { ok: true, value: { name: identity.name, content, ref: '', source } };
}

async function resolveRemoteOrigin(ref: StructuredRef, fetchFn: FetchFn): Promise<ResolveResult> {
  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-addr
  // An address shape belongs to the host that serves it: this resolver
  // constructs one only for a host `SUPPORTED_HOST_ADDRESS_BUILDERS` (below)
  // actually carries a pinning fetch adapter for, refusing every other host
  // BEFORE `source`/`url` are built and before any fetch, rather than handing
  // it a fabricated address that either fails as an unreachable registry
  // (misreporting an unsupported host as a reachability problem) or — worse —
  // succeeds against something this resolver cannot pin, leaving an unpinned,
  // moving `@ref` for `inst-resolve-pin` to record as if it were an origin.

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-host-unsupported
  if (!isSupportedHost(ref.host)) {
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-host-unsupported-fail
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message:
          `Source-spec names host "${ref.host}", which this resolver carries no fetch adapter for. ` +
          `Supported host(s): ${SUPPORTED_HOSTS.join(', ')}.`,
      },
    };
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-host-unsupported-fail
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-host-unsupported

  // `source` starts as the TYPED source-spec — the address the fetch itself
  // must use (`buildFetchUrl` below needs the ref the developer actually
  // typed, not a pin that does not exist until the fetch returns). It is
  // reassigned once the pin is settled (`inst-resolve-pin`), below, so every
  // use from that point on — the identity/legacy-manifest error messages and
  // the final returned record — carries the pinned form instead.
  let source = buildSourceSpec(ref);
  const url = buildFetchUrl(ref);
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-addr

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-fetch
  let content: string;
  let pinnedRef: string | undefined;
  try {
    const fetchOutcome = await fetchFn(url);
    // `FetchFn` returns `string | FetchResult` (`resolver/types.ts`) — a
    // bare string is an adapter with nothing to report (e.g.
    // `adapters/local-fetch.ts`), narrowed here with a plain `typeof` check
    // rather than a cast, since the union is a real structural distinction,
    // not an assertion to trust.
    if (typeof fetchOutcome === 'string') {
      content = fetchOutcome;
    } else {
      content = fetchOutcome.content;
      pinnedRef = fetchOutcome.pinnedRef;
    }
  } catch (err) {
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-fetch-fail-check
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-fetch-fail
    const message =
      err instanceof Error
        ? `Failed to fetch template from registry: ${err.message}`
        : 'Failed to fetch template from registry: unreachable';
    return { ok: false, error: { message } };
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-fetch-fail
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-fetch-fail-check
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-fetch

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-subtree
  if (ref.subtree !== undefined) {
    const narrowed = narrowBundleToSubtree(content, ref.subtree);
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-subtree-empty
    if (!narrowed.ok) {
      // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-subtree-empty-fail
      // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
      // The narrowing's own discriminated `reason` decides the code, instead of
      // every subtree failure arriving codeless and being painted over by the
      // dispatcher's `?? 'ORIGIN_UNAVAILABLE'` fallback. That fallback made a
      // path escaping its subtree once re-rooted — a containment refusal —
      // indistinguishable from a subtree that simply holds no content at the
      // referenced version, and reported the origin as unavailable for both.
      // They are different findings: one sends a developer to check the ref,
      // the other to check what the template actually carries.
      return {
        ok: false,
        error: {
          // Only the code this layer owns. `ResolutionError.code` is deliberately
          // narrow: the resolver names the failures that are its own to name, and a
          // caller supplies `ORIGIN_UNAVAILABLE` for the rest. An empty subtree and
          // a non-bundle payload are exactly that rest — the origin did not yield
          // what was addressed, which is the caller's default and what the criteria
          // ask for. A path escaping its subtree once re-rooted is a containment
          // refusal this layer detects, so this layer must name it.
          ...(narrowed.reason === 'escaping-path' ? { code: 'INVALID_PATH' as const } : {}),
          message: `${narrowed.message} Source-spec: "${source}".`,
        },
      };
      // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
      // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-subtree-empty-fail
    }
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-subtree-empty
    content = narrowed.content;
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-subtree

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-pin
  // Settle the pin BEFORE identity resolution, per this step's own place in
  // the algorithm (step 7, ahead of step 8's manifest read) — every message
  // built from `source` from this point on (the legacy-manifest and
  // identity-missing refusals below, and the final returned record) already
  // carries the immutable form rather than the typed one.
  //
  // `pinnedRef` is present only when the fetch adapter both supports pinning
  // and validated its candidate (`github-fetch.ts`'s `extractPinnedSha`); a
  // `path:` origin never reaches this function at all
  // (`inst-resolve-local-path-read` records its origin unpinned by a
  // separate, earlier branch), and any other adapter that reports none
  // — deliberately or because it has nothing to pin against, like the
  // TEST-ONLY `adapters/local-fetch.ts` — falls back to today's pre-existing
  // behavior: the typed ref, honestly unpinned, exactly as `register`'s own
  // header has always documented for that case. Now that
  // `inst-resolve-host-unsupported` refuses any host outside
  // `SUPPORTED_HOST_ADDRESS_BUILDERS` before this point is ever reached, the
  // real `github-fetch.ts` adapter always reports a pin, so this fallback is
  // reachable in production only were `github-fetch.ts` itself to stop
  // reporting one; today it is exercised solely through an injected test
  // `FetchFn` that deliberately reports none, which is exactly what the
  // existing fixtures above do.
  if (pinnedRef !== undefined) {
    source = buildSourceSpec({ ...ref, ref: pinnedRef });
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-pin

  // Identity is what the template's own manifest declares, not the
  // repository the reference named (`cpt-frontx-adr-template-manifest-
  // contract`) — the same shared check a local origin's content goes through.
  const identity = resolveManifestIdentity(content, source);
  if (!identity.ok) return identity.result;

  // ONE return serves BOTH of the algorithm's terminal branches, because this
  // resolver never writes anything: it acquires content and hands it back, and
  // whether that content ever reaches a slot is the CALLER's separate step.
  //
  //   - For an upgrade or a restore (`inst-resolve-if-upgrade-candidate`), the
  //     content is held in memory and materialized nowhere — no slot, no other
  //     address inside the inventory store, no index entry
  //     (`inst-resolve-stage-candidate`), and this value IS the handle that
  //     branch returns (`inst-resolve-return-staged`). Nothing was written, so
  //     there is no location for the invocation to discard, none for a
  //     concurrent upgrade or restore of the same name to collide with, and
  //     none for a killed process to orphan.
  //   - For `install`, `register`, or the bounded local update
  //     (`inst-resolve-else-slot`), `TemplateInventory` takes this same value
  //     and performs the collision check, the store write
  //     (`inst-resolve-write`) and the index update (`inst-resolve-index`)
  //     itself.
  //
  // The two branches therefore differ only in what the CALLER does next, which
  // is why they share one return rather than one of them writing here. An
  // earlier revision of the FEATURE had this algorithm materialize an
  // upgrade's content into an invocation-scoped staging location inside the
  // inventory store; that requirement was retired precisely because nothing
  // consumed such a copy — an upgrade's commit promotes by re-resolving the
  // now-recorded origin — while it added an orphaned-residue cost the
  // governing ADR itself recorded as a downside.
  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-write
  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-index
  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-if-upgrade-candidate
  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-stage-candidate
  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-else-slot
  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-return
  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-return-staged
  return { ok: true, value: { name: identity.name, content, ref: ref.ref, source } };
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-return-staged
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-return
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-else-slot
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-stage-candidate
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-if-upgrade-candidate
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-index
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-write
}

type IdentityResolution = { ok: true; name: string } | { ok: false; result: ResolveResult };

// Steps 8-10 of the algorithm (`inst-resolve-name` / `inst-resolve-if-
// legacy-manifest` / `inst-resolve-identity-missing`), shared verbatim by
// both origin kinds — a remote resolution has always run this; a local
// origin now runs the identical check rather than a bypass's own
// independent one (the very triplication this checkpoint retires).
function resolveManifestIdentity(content: string, source: string): IdentityResolution {
  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-name
  const manifestResult = readManifestFromContent(content);
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-name

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-if-legacy-manifest
  // A legacy manifest (`readManifestFromContent` runs `refuseLegacyManifest`
  // before the four-field contract check) is reported distinctly from a
  // merely-unreadable-or-invalid one: the undeclared fields are named
  // plainly, never folded into the generic "no readable manifest" phrasing
  // below, so the caller sees exactly what a manual conversion needs to
  // remove.
  if (!manifestResult.ok && manifestResult.code === 'INVALID_MANIFEST' && manifestResult.undeclaredFields !== undefined) {
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-legacy-manifest-fail
    // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
    return {
      ok: false,
      result: {
        ok: false,
        error: {
          message:
            `Template resolved from "${source}" declares a legacy manifest field(s) not part of ` +
            `the four-field contract: ${manifestResult.undeclaredFields.join(', ')}.`,
          code: 'INVALID_MANIFEST',
          undeclaredFields: manifestResult.undeclaredFields,
        },
      },
    };
    // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-legacy-manifest-fail
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-if-legacy-manifest

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-identity-missing
  if (!manifestResult.ok) {
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-identity-missing-fail
    // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
    // The read enforces the whole manifest contract, so this branch is
    // reached by a missing `version` as much as by a missing identity — the
    // DoD's own vocabulary for it is `INVALID_MANIFEST`
    // (`cpt-frontx-dod-template-resolution-manifest-identity`).
    return {
      ok: false,
      result: {
        ok: false,
        error: {
          code: 'INVALID_MANIFEST',
          message: `Template resolved from "${source}" has no readable manifest, so its identity could not be established: ${manifestResult.message}.`,
        },
      },
    };
    // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-identity-missing-fail
  }

  const name = manifestResult.manifest.name;
  if (!isUsableIdentityPath(name)) {
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-identity-missing-fail
    // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
    return {
      ok: false,
      result: {
        ok: false,
        error: {
          code: 'INVALID_MANIFEST',
          message: `Template resolved from "${source}" declares the identity "${name}", which is not usable as an installed content path.`,
        },
      },
    };
    // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-identity-missing-fail
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-identity-missing

  return { ok: true, name };
}

// Re-serialize the structured reference back into the source-spec that
// re-resolves it. The subtree segment MUST survive this round trip: a
// provenance record stores this string, and an upgrade re-resolves through it
// (cpt-frontx-adr-project-provenance-record). Dropping the segment here would
// silently re-resolve the repository root instead of the template.
function buildSourceSpec(ref: StructuredRef): string {
  return `${formatTemplateAddress(ref)}@${ref.ref}`;
}

// The one definition of which hosts this resolver carries a pinning fetch
// adapter for, keyed to how each host's address is built. `inst-resolve-
// host-unsupported` (the refusal above) and `buildFetchUrl` (below) both read
// THIS map rather than each independently naming `'github'` — a second,
// hand-maintained list of supported hosts is exactly the drift this
// codebase's "one formulation, never a second" discipline forbids. Today it
// holds exactly one host; adding another is an additive entry here, per
// `cpt-frontx-adr-source-spec-syntax`'s own evolvability note, that neither
// invalidates a reference already written nor requires touching the refusal.
const SUPPORTED_HOST_ADDRESS_BUILDERS: Record<string, (ref: StructuredRef) => string> = {
  github: (ref) => `https://api.github.com/repos/${ref.owner}/${ref.repo}/tarball/${ref.ref}`,
};

const SUPPORTED_HOSTS = Object.keys(SUPPORTED_HOST_ADDRESS_BUILDERS);

function isSupportedHost(host: string): boolean {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_HOST_ADDRESS_BUILDERS, host);
}

function buildFetchUrl(ref: StructuredRef): string {
  // Build a canonical fetch URL from the structured reference. The subtree is
  // deliberately absent: acquisition stays whole-repository and the subtree is
  // a filter applied to the acquired content
  // (cpt-frontx-adr-source-spec-syntax). Reached only for a host
  // `inst-resolve-host-unsupported` has already confirmed is present in
  // `SUPPORTED_HOST_ADDRESS_BUILDERS` — there is no fallback branch here
  // because, after that refusal, there is nothing left to fall back to.
  return SUPPORTED_HOST_ADDRESS_BUILDERS[ref.host](ref);
}

// A declared identity is usable when it addresses a location inside the
// inventory root. A scoped name such as `@scope/template` is admitted — the
// manifest contract already treats a scoped identity as a path when a template
// declares its own `.frontx/ai/<identity>/` bundle subtree.
//
// The manifest contract owns this rule and `readManifestFromContent` above
// enforces it, so reaching the refusal below means a caller resolved content
// past that gate. It is kept as the barrier closest to the filesystem, since
// this identity becomes a real path in the content store.
function isUsableIdentityPath(value: string): boolean {
  return isSafeRelativePath(value);
}
