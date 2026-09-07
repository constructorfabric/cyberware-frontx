// @cpt-algo:cpt-frontx-algo-composed-provenance-project-state-io:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-atomic-project-state:p1
//
// Atomic read/write of the single repository-local project state document,
// `.frontx/project.json` (FEATURE §3 "Atomic Project State Read/Write").
// Pure logic only — no direct `fs` calls here; the injected
// `ReadProjectStateFn`/`WriteProjectStateFn` seams (`./types.ts`) are what a
// caller plugs a real filesystem adapter into (`adapters/fs-project-io.ts`),
// mirroring the `upgrade/`+`adapters/fs-project-io.ts`
// `ReadProjectFileFn`/`WriteProjectFileFn` split already established in this
// codebase. The one instruction this file does NOT implement,
// `inst-psio-write-atomic` (write to a temp file beside the destination,
// then rename into place), is the real adapter's own concern: this pure
// layer only knows it calls `writeProjectStateFn` and trusts the contract
// that call is atomic, exactly as `provenance/write.ts` trusts
// `ProvenanceWriteFn` without knowing how its real implementation persists.
import path from 'node:path';
import { FRONTX_NAMESPACE_ROOT } from '../manifest/types';
import type {
  MutateProjectStateResult,
  ProjectStateDocument,
  ProjectStateMutation,
  ReadProjectStateFn,
  ReadProjectStateResult,
  TemplateEntry,
  WriteProjectStateFn,
} from './types';

// @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-locate
/** The document's one location inside the repository root. */
export function projectStatePath(repoRoot: string): string {
  return path.join(repoRoot, FRONTX_NAMESPACE_ROOT, 'project.json');
}
// @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-locate

// The OLD per-template `.frontx/provenance.json` record — this feature's
// own header (`./types.ts`) says it is "slated for deletion once callers
// migrate" — is never itself read by this module's normal logic; it is
// referenced here ONLY so `loadProjectStateDocument` can detect the one
// combination ADR-0019 ("More Information") requires be refused rather than
// silently treated as an empty project: this legacy file present with no
// `.frontx/project.json` alongside it.
function legacyProvenancePath(repoRoot: string): string {
  return path.join(repoRoot, FRONTX_NAMESPACE_ROOT, 'provenance.json');
}

function initialProjectStateDocument(): ProjectStateDocument {
  return { formatVersion: 1, templates: {}, projectOwnedRoots: [] };
}

function isRecordShaped(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPreviousOriginShaped(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecordShaped(value) && typeof value.origin === 'string' && typeof value.version === 'string')
  );
}

function isTemplateEntryShaped(value: unknown): value is TemplateEntry {
  return (
    isRecordShaped(value) &&
    typeof value.origin === 'string' &&
    typeof value.version === 'string' &&
    Array.isArray(value.targets) &&
    value.targets.every((target) => typeof target === 'string') &&
    isPreviousOriginShaped(value.previous)
  );
}

/**
 * Guards the top-level shape `{ formatVersion, templates, projectOwnedRoots
 * }` and every `templates[name]` entry within it (`inst-psio-if-malformed`).
 * Returns `null` — never throws — on any shape violation, so the caller can
 * turn that into `PROJECT_INVALID` naming the document rather than letting
 * an unrelated TypeError surface deeper in a caller that trusts the parsed
 * type, the same discipline `provenance/validate.ts` applies to the older
 * per-template store.
 */
function parseProjectStateDocument(raw: string): ProjectStateDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecordShaped(parsed)) return null;
  // Exactly `1`, not merely a number: this store owns exactly one schema
  // generation today, and a document stamped with a future `formatVersion`
  // this build does not understand must be refused rather than silently
  // read (and, on a mutation, silently rewritten) as if it were the current
  // shape — a version comparison this narrow is the only thing that can
  // ever detect that mismatch, since every OTHER structural check below
  // would accept a same-shaped document regardless of which generation
  // wrote it.
  if (parsed.formatVersion !== 1) return null;
  if (!isRecordShaped(parsed.templates)) return null;
  for (const entry of Object.values(parsed.templates)) {
    if (!isTemplateEntryShaped(entry)) return null;
  }
  if (!Array.isArray(parsed.projectOwnedRoots) || !parsed.projectOwnedRoots.every((p) => typeof p === 'string')) {
    return null;
  }
  return {
    formatVersion: parsed.formatVersion as 1,
    templates: parsed.templates as Record<string, TemplateEntry>,
    projectOwnedRoots: parsed.projectOwnedRoots as string[],
  };
}

/**
 * Loads the current document, or the initial empty shape when none exists
 * yet — never writing anything for a mere load (`inst-psio-if-absent` /
 * `inst-psio-absent-default` / `inst-psio-if-present` / `inst-psio-read` /
 * `inst-psio-if-malformed` / `inst-psio-return-invalid`). Shared by both the
 * read-only entrypoint and the mutation entrypoint below, since both begin
 * by establishing the current document the same way.
 */
async function loadProjectStateDocument(
  repoRoot: string,
  readProjectStateFn: ReadProjectStateFn,
): Promise<{ ok: true; document: ProjectStateDocument } | { ok: false; message: string }> {
  const location = projectStatePath(repoRoot);
  // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-if-present
  const raw = await readProjectStateFn(location);
  // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-if-present

  // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-if-absent
  if (raw === null) {
    // The absence of `.frontx/project.json` is deliberately NOT a failure on
    // its own — the marked default below stands for every ordinary empty
    // project. The ONE combination ADR-0019 ("More Information") requires be
    // refused instead is this absence PLUS a legacy `.frontx/
    // provenance.json` alongside it: a repository an older CLI version
    // created, never migrated to this single-document model. Guessing a
    // translation from that old per-template record is explicitly out of
    // scope; the developer recreates or re-registers instead.
    const legacyPath = legacyProvenancePath(repoRoot);
    const legacyRaw = await readProjectStateFn(legacyPath);
    if (legacyRaw !== null) {
      return {
        ok: false,
        message:
          `"${legacyPath}" is a legacy provenance record from an older CLI version; this repository was never ` +
          'migrated to the current .frontx/project.json model. Recreate the project or re-register its ' +
          'templates against the current model before running this command.',
      };
    }
    // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-absent-default
    return { ok: true, document: initialProjectStateDocument() };
    // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-absent-default
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-if-absent

  // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-read
  const document = parseProjectStateDocument(raw);
  // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-read

  // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-if-malformed
  if (document === null) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-return-invalid
    return { ok: false, message: `Project state document at "${location}" could not be parsed as { formatVersion, templates, projectOwnedRoots }` };
    // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-return-invalid
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-if-malformed

  return { ok: true, document };
}

/**
 * A read-only request (`inst-psio-if-read` / `inst-psio-return-read`):
 * returns the current document (or the initial empty shape) and writes
 * nothing.
 */
export async function readProjectState(
  repoRoot: string,
  readProjectStateFn: ReadProjectStateFn,
): Promise<ReadProjectStateResult> {
  const loaded = await loadProjectStateDocument(repoRoot, readProjectStateFn);
  // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-if-read
  if (!loaded.ok) {
    return { ok: false, error: 'PROJECT_INVALID', message: loaded.message };
  }
  // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-return-read
  return { ok: true, document: loaded.document };
  // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-return-read
  // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-if-read
}

/**
 * Applies exactly one described mutation to an in-memory copy of the
 * current document and nothing else (`inst-psio-construct-copy`) — a pure
 * data transform, never a raw JSON patch.
 */
function applyMutation(document: ProjectStateDocument, mutation: ProjectStateMutation): ProjectStateDocument {
  switch (mutation.kind) {
    case 'set-template':
      return {
        ...document,
        templates: { ...document.templates, [mutation.name]: mutation.entry },
      };
    case 'remove-template': {
      const { [mutation.name]: _removed, ...rest } = document.templates;
      return { ...document, templates: rest };
    }
    case 'add-owned-root':
      return document.projectOwnedRoots.includes(mutation.path)
        ? document
        : { ...document, projectOwnedRoots: [...document.projectOwnedRoots, mutation.path] };
    case 'remove-owned-root':
      return {
        ...document,
        projectOwnedRoots: document.projectOwnedRoots.filter((existing) => existing !== mutation.path),
      };
  }
}

/**
 * A described mutation (`inst-psio-if-mutate`): reads the current document,
 * constructs the fully modified copy reflecting exactly the described
 * change (`inst-psio-construct-copy`), and writes it back through the
 * injected `writeProjectStateFn` — trusted to write-through-temp-then-rename
 * (`inst-psio-write-atomic`, realized by the real adapter in
 * `adapters/fs-project-io.ts`, not by this pure-logic layer) — before
 * returning the written document (`inst-psio-return-written`).
 */
export async function mutateProjectState(
  repoRoot: string,
  mutation: ProjectStateMutation,
  readProjectStateFn: ReadProjectStateFn,
  writeProjectStateFn: WriteProjectStateFn,
): Promise<MutateProjectStateResult> {
  const loaded = await loadProjectStateDocument(repoRoot, readProjectStateFn);
  if (!loaded.ok) {
    return { ok: false, error: 'PROJECT_INVALID', message: loaded.message };
  }

  // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-if-mutate
  // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-construct-copy
  const nextDocument = applyMutation(loaded.document, mutation);
  // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-construct-copy

  const location = projectStatePath(repoRoot);
  await writeProjectStateFn(location, JSON.stringify(nextDocument, null, 2));

  // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-return-written
  return { ok: true, document: nextDocument };
  // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-return-written
  // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-if-mutate
}
