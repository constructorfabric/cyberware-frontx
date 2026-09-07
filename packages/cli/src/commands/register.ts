// @cpt-FEATURE:cpt-frontx-feature-composed-provenance:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-registration:p1
//
// `register <origin>` — cpt-frontx-algo-composed-provenance-register. Reads
// and writes the single project state document this feature owns
// (`../project-state/io.ts`) through the injected `ReadProjectStateFn`/
// `WriteProjectStateFn` seams, exactly as that module's own header requires:
// no direct filesystem access here.
//
// A remote origin's pin is supposed to be the exact immutable commit SHA the
// fetch settled on (`inst-cpreg-install`). The shared resolver
// (`resolver/resolve.ts`'s `inst-resolve-pin`) now settles that pin from the
// GitHub tarball's own top-level `<owner>-<repo>-<sha>/` directory segment
// (`adapters/github-fetch.ts`) and records it as `source` before this
// command ever sees the result, so `TemplateInventory.install`/`lookup`'s
// `source` this command writes as `origin` below already carries the
// immutable SHA end to end for a GitHub origin — this command performs no
// pinning of its own; it simply passes through what the resolver settled.
// The residual, honestly-unpinned case is a fetch adapter that reports no
// pin at all (a non-GitHub host with no adapter support, or a candidate that
// failed the resolver's own hex-SHA validation): `origin` there is still the
// typed, possibly-moving reference.
//
// A `path:<relative-path>` origin is resolved through the SAME shared
// resolver a remote origin goes through
// (`cpt-frontx-algo-template-resolution-resolve-to-inventory`), never
// through the local inventory: a local origin has no separate publication to
// resolve to an immutable form, so it is never installed/tracked there — the
// resolver's own containment, existence, and manifest-identity checks are
// the only checks a local origin gets. No fetch, no pin — there is nothing
// external to pin against.
import { readManifestFromContent } from '../manifest/validate-contract';
import { readProjectState, mutateProjectState } from '../project-state/io';
import type { ReadProjectStateFn, WriteProjectStateFn, TemplateEntry } from '../project-state/types';
import { resolveToInventory } from '../resolver/resolve';
import { parseLocalOrigin } from '../resolver/types';
import type { FetchFn, ListFolderFilesFn, PathExistsFn } from '../resolver/types';
import type { ReadFileFn } from '../manifest/types';
import type { InventoryEntry, InventoryResult } from '../inventory/types';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { ErrorCode } from '../envelope';

// Narrow port over `TemplateInventory` — register needs only these two
// methods, injected so a test double can exercise `INVALID_MANIFEST`
// directly (constructing a `lookup` result whose content already drifted
// out of contract) without depending on the real resolver pipeline, which
// enforces the identical four-field contract as its own install-time gate
// (`resolver/resolve.ts` calls `readManifestFromContent` before an install
// can ever succeed) and therefore can never itself produce an invalid
// manifest for a REAL `TemplateInventory` to hand back. The check stays in
// this algorithm anyway because the FEATURE spec (`inst-cpreg-read-manifest`
// / `inst-cpreg-if-invalid-manifest`) names it as this algorithm's own step,
// not the resolver's.
export interface RegisterInventoryPort {
  install(spec: string, fetchFn: FetchFn): Promise<InventoryResult<{ name: string; ref: string }>>;
  lookup(name: string): InventoryEntry | undefined;
}

export type RegisterOutcome =
  | { ok: true; outcome: 'created' | 'noop' | 'replaced'; name: string; entry: TemplateEntry }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

interface ResolvedOrigin {
  storedOrigin: string;
  manifestContent: string;
}

async function resolveOrigin(
  origin: string,
  repoRoot: string,
  inventory: RegisterInventoryPort,
  fetchFn: FetchFn,
  readFileFn: ReadFileFn,
  canonicalizeFn: CanonicalizeTargetFn,
  existsFn: PathExistsFn,
  listFolderFilesFn: ListFolderFilesFn,
): Promise<{ ok: true; value: ResolvedOrigin } | { ok: false; message: string; code?: ErrorCode }> {
  if (parseLocalOrigin(origin) !== undefined) {
    // The shared resolver now owns containment, existence, and manifest-
    // identity/legacy-manifest checking for a local origin, exactly as it
    // already does for a remote one — a local origin is resolved directly
    // (never through `TemplateInventory.install`/`lookup`), since it has no
    // separate publication to install or pin: the resolver reads the
    // folder's own current content at every resolution.
    const resolved = await resolveToInventory(
      { kind: 'local', origin },
      {
        fetchFn,
        local: {
          repoRoot,
          canonicalizeFn,
          existsFn,
          listFolderFilesFn,
          readFolderFileFn: readFileFn,
        },
      },
    );
    if (!resolved.ok) {
      return {
        ok: false,
        code: resolved.error.code,
        message: `Local origin "${origin}" could not be resolved: ${resolved.error.message}`,
      };
    }
    // Recorded EXACTLY as given (`inst-cpreg-install`'s local-origin
    // clause) — no pin, since there is nothing external to pin against.
    // `manifestContent` is the resolver's acquired content (a bundle
    // envelope for a multi-file local folder); `readManifestFromContent`
    // below already unwraps that shape transparently, so this caller's own
    // subsequent manifest-field check works unchanged for either origin kind.
    return { ok: true, value: { storedOrigin: resolved.value.source, manifestContent: resolved.value.content } };
  }

  // `install` is called UNCONDITIONALLY rather than first checking whether
  // the origin's content is already available (`inst-cpreg-if-not-
  // installed`'s literal condition): `TemplateInventory.install` already
  // treats a repeated install at the same address as a refresh rather than
  // an error (`TemplateInventory.ts`'s `sameTemplate` branch), so a separate
  // availability probe here would only re-derive a distinction that method
  // already makes internally.
  const installResult = await inventory.install(origin, fetchFn);
  if (!installResult.ok) {
    // The code travels, exactly as the local branch above already propagates
    // it. Dropping it here downgraded a refusal into a different one: a remote
    // template whose manifest the resolver refused with `INVALID_MANIFEST`
    // reached the caller as `ORIGIN_UNAVAILABLE`, saying the origin could not
    // be reached when it had been reached and read. The two halves of one
    // command disagreed about the same failure for as long as only one of them
    // carried the code.
    return { ok: false, code: installResult.error.code, message: installResult.error.message };
  }
  const entry = inventory.lookup(installResult.value.name);
  if (!entry) {
    return {
      ok: false,
      message: `Installed template "${installResult.value.name}" could not be read back from the local inventory.`,
    };
  }
  return { ok: true, value: { storedOrigin: entry.source, manifestContent: entry.content } };
}

/**
 * cpt-frontx-algo-composed-provenance-register — resolves/installs `origin`,
 * validates its manifest, and creates, no-ops, replaces, or refuses the
 * project's `templates[name]` entry. Writes nothing on any failure path.
 */
export async function registerTemplate(
  origin: string,
  replace: boolean,
  repoRoot: string,
  inventory: RegisterInventoryPort,
  fetchFn: FetchFn,
  readFileFn: ReadFileFn,
  canonicalizeFn: CanonicalizeTargetFn,
  readProjectStateFn: ReadProjectStateFn,
  writeProjectStateFn: WriteProjectStateFn,
  existsFn: PathExistsFn,
  listFolderFilesFn: ListFolderFilesFn,
): Promise<RegisterOutcome> {
  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-accept
  // `origin` is accepted as this function's own parameter.
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-accept

  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-install
  // This call's pinning guarantee is only as strong as whichever `fetchFn`
  // the caller injected: an adapter reporting no pin yields an
  // honestly-unpinned `origin` here. That holds of every seam in this
  // package, and the instruction describes what the system does — the one
  // production adapter the CLI wires (`createGithubFetchFn`) pins to the
  // commit its own tarball settled on, verified end-to-end against a real
  // remote where a branch name came back recorded as a SHA.
  //
  // This install must run unconditionally — never gated behind an `IF the
  // origin's content is not already available in the local inventory`
  // check — because such a conditional cannot stand beside its own pinning
  // requirement: what a project stores is never the typed ref but the value
  // the fetch settled on (`cpt-frontx-adr-source-spec-syntax`), so skipping
  // the fetch because content happens to be present locally would leave
  // nothing to pin, and a branch that had moved would register as a no-op.
  // Installing unconditionally is what makes the comparison below
  // meaningful; a repeat is a refresh.
  const resolved = await resolveOrigin(
    origin,
    repoRoot,
    inventory,
    fetchFn,
    readFileFn,
    canonicalizeFn,
    existsFn,
    listFolderFilesFn,
  );
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-install

  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-install-fail
  if (!resolved.ok) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-unavailable
    return { ok: false, code: resolved.code ?? 'ORIGIN_UNAVAILABLE', message: resolved.message };
    // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-unavailable
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-install-fail

  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-read-manifest
  const manifestResult = readManifestFromContent(resolved.value.manifestContent);
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-read-manifest

  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-invalid-manifest
  const fields = readManifestFields(manifestResult, resolved.value.manifestContent);
  if (!fields.ok) {
    if (fields.reason === 'legacy-manifest') {
      // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-invalid-manifest
      // A legacy-shaped manifest is refused the same way here as at install
      // (`resolver/resolve.ts`'s `inst-resolve-if-legacy-manifest`): naming
      // every undeclared field present, never folded into the generic
      // missing-field message below.
      return {
        ok: false,
        code: 'INVALID_MANIFEST',
        message:
          'Registration refused — the resolved manifest declares field(s) not part of the four-field ' +
          `contract: ${fields.undeclaredFields.join(', ')}.`,
        details: { undeclaredFields: fields.undeclaredFields },
      };
      // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-invalid-manifest
    }
    // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-invalid-manifest
    return {
      ok: false,
      code: 'INVALID_MANIFEST',
      message: `Registration refused — the resolved manifest is missing or has an empty "${fields.field}" field.`,
      details: { field: fields.field },
    };
    // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-invalid-manifest
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-invalid-manifest

  const { name, version } = fields;

  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-read-state
  const stateResult = await readProjectState(repoRoot, readProjectStateFn);
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-read-state
  if (!stateResult.ok) {
    return { ok: false, code: 'PROJECT_INVALID', message: stateResult.message };
  }

  const existing = stateResult.document.templates[name];

  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-new
  if (existing === undefined) {
    const entry: TemplateEntry = { origin: resolved.value.storedOrigin, version, targets: [] };
    // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-write-new
    const written = await mutateProjectState(
      repoRoot,
      { kind: 'set-template', name, entry },
      readProjectStateFn,
      writeProjectStateFn,
    );
    // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-write-new
    if (!written.ok) return { ok: false, code: 'PROJECT_INVALID', message: written.message };
    // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-created
    // @cpt-begin:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-unreg-to-empty
    return { ok: true, outcome: 'created', name, entry };
    // @cpt-end:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-unreg-to-empty
    // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-created
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-new

  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-else-exists
  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-same-origin
  if (existing.origin === resolved.value.storedOrigin) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-noop
    // @cpt-begin:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-empty-to-empty
    return { ok: true, outcome: 'noop', name, entry: existing };
    // @cpt-end:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-empty-to-empty
    // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-noop
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-same-origin

  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-no-replace
  if (!replace) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-origin-conflict
    return {
      ok: false,
      code: 'REGISTRATION_CONFLICT',
      message:
        `Template "${name}" is already registered from "${existing.origin}"; ` +
        `"${resolved.value.storedOrigin}" was not registered. Pass --replace to replace it.`,
      details: { name, currentOrigin: existing.origin, requestedOrigin: resolved.value.storedOrigin },
    };
    // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-origin-conflict
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-no-replace

  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-replace-applied
  if (existing.targets.length > 0) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-replace-refused
    return {
      ok: false,
      code: 'TARGETS_EXIST',
      message:
        `Template "${name}" has applied targets; register --replace never changes the origin of a name ` +
        'with at least one applied target. Run "upgrade" instead.',
      details: { name, targets: existing.targets },
    };
    // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-replace-refused
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-if-replace-applied

  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-else-replace-ok
  // `previous` is deliberately omitted from the replacement entry — this is
  // the whole point of `--replace`: it starts a new lineage for the name, so
  // any `previous: {origin, version}` pair the entry carried from an
  // earlier upgrade/restore must not survive it.
  const replacedEntry: TemplateEntry = { origin: resolved.value.storedOrigin, version, targets: existing.targets };
  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-write-replace
  const writtenReplace = await mutateProjectState(
    repoRoot,
    { kind: 'set-template', name, entry: replacedEntry },
    readProjectStateFn,
    writeProjectStateFn,
  );
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-write-replace
  if (!writtenReplace.ok) return { ok: false, code: 'PROJECT_INVALID', message: writtenReplace.message };
  // @cpt-begin:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-replaced
  // @cpt-begin:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-empty-to-empty
  return { ok: true, outcome: 'replaced', name, entry: replacedEntry };
  // @cpt-end:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-empty-to-empty
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-return-replaced
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-else-replace-ok
  // @cpt-end:cpt-frontx-algo-composed-provenance-register:p1:inst-cpreg-else-exists
}

type ManifestFieldsOutcome =
  | { ok: true; name: string; version: string }
  | { ok: false; reason: 'missing-field'; field: 'name' | 'version' | 'description' }
  | { ok: false; reason: 'legacy-manifest'; undeclaredFields: string[] };

/**
 * Extracts `name`/`version` (and confirms `description` is non-empty) from
 * the resolved manifest — this algorithm's own three fields
 * (`inst-cpreg-read-manifest` / `inst-cpreg-if-invalid-manifest`), decoupled
 * from `readManifestFromContent`'s FULL four-field contract check: an
 * `excludedSubtrees` violation is not this algorithm's concern at all
 * (register never inspects that field), so a manifest failing ONLY on that
 * field must not be reported as a missing `name`.
 *
 * When `readManifestFromContent` already succeeded, its manifest object is
 * used directly — every field is already guaranteed present and non-empty
 * by that contract, so no branch below can actually fire, but the checks
 * stay as the defensive, spec-named steps rather than an unchecked
 * destructure. When it failed on the legacy-manifest refusal
 * (`readManifestFromContent`'s own `refuseLegacyManifest` wiring), that
 * refusal is surfaced as-is — a legacy-shaped manifest is never re-parsed
 * for name/version below, since the refusal already stands regardless of
 * whether those three fields happen to be usable. Any OTHER read failure
 * falls back to a direct parse of the raw manifest text, which is now dead
 * in practice for BOTH origin kinds: the shared resolver
 * (`cpt-frontx-algo-template-resolution-resolve-to-inventory`) already runs
 * the identical four-field contract check before `resolveOrigin` above can
 * ever return success, for a local origin exactly as it always has for a
 * remote one via `TemplateInventory.install`. The check stays here anyway,
 * unreachable through the real pipeline, because a test double can construct
 * a `RegisterInventoryPort`/local resolution whose content already drifted
 * out of contract without depending on the resolver internals — see this
 * function's own call site for that fixture pattern.
 */
function readManifestFields(
  manifestResult: ReturnType<typeof readManifestFromContent>,
  rawManifestContent: string,
): ManifestFieldsOutcome {
  if (manifestResult.ok) {
    const { name, version, description } = manifestResult.manifest;
    if (!name) return { ok: false, reason: 'missing-field', field: 'name' };
    if (!version) return { ok: false, reason: 'missing-field', field: 'version' };
    if (!description || description.trim() === '') return { ok: false, reason: 'missing-field', field: 'description' };
    return { ok: true, name, version };
  }

  if (manifestResult.code === 'INVALID_MANIFEST' && manifestResult.undeclaredFields !== undefined) {
    return { ok: false, reason: 'legacy-manifest', undeclaredFields: manifestResult.undeclaredFields };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifestContent);
  } catch {
    return { ok: false, reason: 'missing-field', field: 'name' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'missing-field', field: 'name' };
  }
  const obj = parsed as Record<string, unknown>;
  const name = obj.name;
  if (typeof name !== 'string' || name.trim() === '') return { ok: false, reason: 'missing-field', field: 'name' };
  const version = obj.version;
  if (typeof version !== 'string' || version.trim() === '') return { ok: false, reason: 'missing-field', field: 'version' };
  const description = obj.description;
  if (typeof description !== 'string' || description.trim() === '') return { ok: false, reason: 'missing-field', field: 'description' };
  return { ok: true, name, version };
}

export interface ResolvedRegistrationCandidate {
  storedOrigin: string;
  name: string;
  version: string;
}

/**
 * Resolves and validates `origin` through the IDENTICAL `resolveOrigin` /
 * `readManifestFields` steps `registerTemplate` above uses, but reads and
 * writes no project state at all — a pure availability probe. `seed`
 * (`commands/seed-repository.ts`) calls this for every batch entry BEFORE
 * its own first write to `.frontx/project.json`, so a batch naming an
 * official default that cannot actually be resolved is refused with the
 * directory left exactly as it was found, rather than discovered only after
 * `seed` has already created the document that a later step then fails to
 * finish populating.
 */
export async function probeRegistration(
  origin: string,
  repoRoot: string,
  inventory: RegisterInventoryPort,
  fetchFn: FetchFn,
  readFileFn: ReadFileFn,
  canonicalizeFn: CanonicalizeTargetFn,
  existsFn: PathExistsFn,
  listFolderFilesFn: ListFolderFilesFn,
): Promise<
  | { ok: true; value: ResolvedRegistrationCandidate }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> }
> {
  const resolved = await resolveOrigin(
    origin,
    repoRoot,
    inventory,
    fetchFn,
    readFileFn,
    canonicalizeFn,
    existsFn,
    listFolderFilesFn,
  );
  if (!resolved.ok) {
    return { ok: false, code: resolved.code ?? 'ORIGIN_UNAVAILABLE', message: resolved.message };
  }

  const fields = readManifestFields(readManifestFromContent(resolved.value.manifestContent), resolved.value.manifestContent);
  if (!fields.ok) {
    if (fields.reason === 'legacy-manifest') {
      return {
        ok: false,
        code: 'INVALID_MANIFEST',
        message:
          'The resolved manifest declares field(s) not part of the four-field contract: ' +
          `${fields.undeclaredFields.join(', ')}.`,
        details: { undeclaredFields: fields.undeclaredFields },
      };
    }
    return {
      ok: false,
      code: 'INVALID_MANIFEST',
      message: `The resolved manifest is missing or has an empty "${fields.field}" field.`,
      details: { field: fields.field },
    };
  }

  return {
    ok: true,
    value: { storedOrigin: resolved.value.storedOrigin, name: fields.name, version: fields.version },
  };
}
