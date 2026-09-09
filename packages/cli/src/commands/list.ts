// @cpt-FEATURE:cpt-frontx-feature-template-resolution:p1
// @cpt-flow:cpt-frontx-flow-template-resolution-list:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-list-inventory:p1
import { readManifestFromContent } from '../manifest/validate-contract';
import { TemplateInventory } from '../inventory/TemplateInventory';
import { resolveToInventory } from '../resolver/resolve';
import { parseLocalOrigin } from '../resolver/types';
import type { FetchFn, PathExistsFn, ListFolderFilesFn, ReadFolderFileFn } from '../resolver/types';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { TemplateEntry } from '../project-state/types';
import { OFFICIAL_DEFAULT_TEMPLATES, officialDefaultOrigin } from './official-defaults';
import { ok } from '../envelope';
import type { OkEnvelope } from '../envelope';

export interface ListEntry {
  name: string;
  origin: string;
  // The version the entry's own manifest declares — §1.5's `version` bullet:
  // "version means the same thing in all three sets ... the version the
  // entry's own manifest declares. ... It is never the reference an origin
  // was resolved through: the immutable value a remote fetch settled on
  // already travels inside `origin`." Read through the same manifest read
  // `description` is read through below, so the two can never diverge.
  // Absent, never the ref and never a placeholder, in exactly the same case
  // `description` is absent: a damaged (`manifestUnreadable`) entry, per
  // §1.5's "For a damaged installed entry the key is absent, on exactly the
  // ground the next bullet states for `description`."
  version?: string;
  // The description the entry's own manifest declares, absent when it declares
  // none. Absent rather than empty on purpose: the machine-readable form is what
  // a calling program selects a template by, and a placeholder there is a
  // declaration the template never made
  // (cpt-frontx-flow-template-resolution-list inst-list-format-machine).
  description?: string;
  // Present, and only ever `true`, when the entry's stored manifest did not
  // satisfy the manifest contract, so no description could be read from it.
  //
  // This is what keeps `description`'s absence honest. Without it a consumer
  // reads one absence as two different facts — "this template declares no
  // description" and "this template's manifest is broken" — and reports the
  // first for both. The failure mode that makes it worth a field: a future
  // tightening of the manifest contract would invalidate stored manifests
  // wholesale, and every template would be reported as declaring no description
  // rather than as needing reinstallation.
  //
  // Absent (not `false`) in the ordinary case, matching `description`'s own
  // convention, so a conforming entry carries no key for a problem it does not
  // have.
  manifestUnreadable?: true;
}

/**
 * Enumerates the local inventory's own installed entries (`inst-list-read` /
 * `inst-list-format`). This is the raw local-inventory view — every entry the
 * `TemplateInventory` tracks, WHETHER OR NOT it is also registered to the
 * current project. `buildListCatalog` below is what narrows this down to the
 * `installed` set §1.5 defines (entries not yet registered) and combines it
 * with `defaults`/`registered`; this function stays the smaller, reusable
 * primitive both it and any other caller needing the bare inventory read from.
 */
export async function listCommand(inventory: TemplateInventory): Promise<ListEntry[]> {
  const entries = await inventory.list();
  return entries.map((e) => {
    // Identity and origin address need no manifest read (inst-list-format), so
    // they sit outside the marked region below. `version` no longer does: §1.5
    // fixes it as the version the entry's OWN MANIFEST declares, never `e.ref`
    // (the inventory's resolved reference), so it is read together with
    // `description` from the single manifest read below — the two can never
    // diverge, and both are absent together for a damaged entry.
    const identity = { name: e.name, origin: e.source };

    // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-format-machine
    const stored = storedManifestFields(e.content);
    if (!stored.ok) return { ...identity, manifestUnreadable: true };
    return {
      ...identity,
      version: stored.version,
      ...(stored.description !== undefined ? { description: stored.description } : {}),
    };
    // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-format-machine
  });
}

type StoredManifestFieldsResult =
  | { ok: true; version: string; description?: string }
  | { ok: false; reason: 'manifest-unreadable' };

// The version and description declared by the manifest an inventory entry
// recorded at install time, read through the same single manifest read path
// every other consumer uses (cpt-frontx-dod-template-manifest-single-
// description) so the listing cannot diverge from what validation accepted,
// and so `version` and `description` can never be reported from two different
// reads of the same entry.
//
// `readManifestFromContent` rejects on ANY manifest-contract violation, not
// only on unparseable JSON, so an entry whose stored manifest has since drifted
// out of contract — a malformed ownership boundary, a missing version — reaches
// the `ok: false` branch. That case is reported as its own outcome rather than
// folded into "no description": a caller told a template declares nothing looks
// for a template that describes itself, whereas a caller told the manifest is
// unreadable knows to reinstall it. Collapsing the two costs a developer that
// distinction at exactly the moment they need it. The same reasoning is why
// `version` is withheld rather than guessed (§1.5): a damaged manifest can
// declare neither.
//
// Enumerating rather than refusing is the deliberate choice: `list` reports the
// inventory, and failing the whole enumeration over one bad record would hide
// every other installed template from a caller that came to enumerate them.
function storedManifestFields(content: string): StoredManifestFieldsResult {
  const result = readManifestFromContent(content);
  if (!result.ok) return { ok: false, reason: 'manifest-unreadable' };
  return { ok: true, version: result.manifest.version, description: result.manifest.description };
}

// ---------------------------------------------------------------------------
// §1.5 Machine-Readable Catalog Envelope — the three-set `data` payload every
// `list --json` invocation reports, owned by this FEATURE as a cross-boundary
// contract (`cpt-frontx-adr-contract-schema-ownership`, ADR 0027) because the
// AI Tooling Framework's kit reads it without linking this CLI (DESIGN §3.4).
// ---------------------------------------------------------------------------

/** `data.defaults[]` — never carries `origin`: a default is identified by
 * name alone, and independence from the project state document is the whole
 * point of this set (see `buildDefaults` below). */
export interface DefaultTemplateEntry {
  name: string;
  version: string;
  description: string;
}

/** `data.registered[]` — one record per entry in the current project's own
 * `templates` map. */
export interface RegisteredTemplateEntry {
  name: string;
  origin: string;
  version: string;
  targets: string[];
  // Omitted, never a placeholder, when the registered origin can no longer be
  // read back (its local folder moved/vanished, or its remote content is no
  // longer in the local inventory) — the same "never guess" discipline
  // `ListEntry.description`'s own doc comment states, extended here because a
  // registered entry's origin can go stale independently of anything `list`
  // controls.
  description?: string;
  // The RECORDED declaration on the entry (`project-state/types.ts`'s
  // `TemplateEntry.excludedSubtrees`) — read straight off the project state
  // document, never re-resolved from a manifest, so a developer can see this
  // one component of what a `delete` would preserve without reading
  // `.frontx/project.json` by hand. NOT the complete answer: `delete`
  // resolves a name's declared exclusions as the UNION of this RECORDED
  // value and the template's CURRENT manifest declaration
  // (`cpt-frontx-algo-cli-scaffolding-delete-plan`'s own `inst-dp-union-
  // declared-exclusions`), so a manifest edited after registration can
  // still add ground this field alone does not name — `delete --dry-run`'s
  // own `toPreserve` (and its `exclusionsDrift`, when the two sources
  // disagree) is the authoritative report of what a deletion would actually
  // preserve, this field is only the recorded half of it. Omitted, never
  // `[]`, for a document written before this field existed.
  excludedSubtrees?: string[];
}

export interface ListCatalog {
  defaults: DefaultTemplateEntry[];
  registered: RegisteredTemplateEntry[];
  installed: ListEntry[];
}

/**
 * The local, filesystem-only seams `buildListCatalog` needs to read a
 * `path:` origin's manifest directly — the identical seams `register`/`apply`
 * already resolve a local origin through (`resolver/resolve.ts`), injected
 * here rather than re-derived so `list` and `register` can never disagree on
 * what a local origin resolves to. `fetchFn` is required only because
 * `ResolveDeps` always declares it; `list` never dispatches a remote fetch —
 * every resolution this module performs is `{kind: 'local', ...}`.
 */
export interface CatalogResolveDeps {
  fetchFn: FetchFn;
  canonicalizeFn: CanonicalizeTargetFn;
  existsFn: PathExistsFn;
  listFolderFilesFn: ListFolderFilesFn;
  readFileFn: ReadFolderFileFn;
  repoRoot: string;
}

async function resolveLocalManifest(
  origin: string,
  deps: CatalogResolveDeps,
): Promise<{ version: string; description: string } | undefined> {
  const resolved = await resolveToInventory(
    { kind: 'local', origin },
    {
      fetchFn: deps.fetchFn,
      local: {
        repoRoot: deps.repoRoot,
        canonicalizeFn: deps.canonicalizeFn,
        existsFn: deps.existsFn,
        listFolderFilesFn: deps.listFolderFilesFn,
        readFolderFileFn: deps.readFileFn,
      },
    },
  );
  if (!resolved.ok) return undefined;
  const manifest = readManifestFromContent(resolved.value.content);
  if (!manifest.ok) return undefined;
  return { version: manifest.manifest.version, description: manifest.manifest.description };
}

// `data.defaults` — the platform's default templates, sourced from the CLI's
// own built-in list (`OFFICIAL_DEFAULT_TEMPLATES`) and NEVER from the current
// project's `.frontx/project.json`: this loop never reads `templates`, so a
// project state document saying something different cannot change this set.
// A default whose local folder cannot currently be resolved (the known
// limitation `OFFICIAL_DEFAULT_TEMPLATES`'s own generator documents: a
// `path:` origin resolves only against the checkout that generated it) is
// left OUT of the set rather than reported with a guessed version/description
// — there is no per-entry slot in this set's shape to flag a resolution
// failure the way `installed`'s `manifestUnreadable` does.
async function buildDefaults(deps: CatalogResolveDeps): Promise<DefaultTemplateEntry[]> {
  const entries: DefaultTemplateEntry[] = [];
  for (const name of Object.keys(OFFICIAL_DEFAULT_TEMPLATES)) {
    const origin = officialDefaultOrigin(name);
    if (origin === undefined) continue; // unreachable: `name` was read from this same map
    const manifest = await resolveLocalManifest(origin, deps);
    if (manifest === undefined) continue;
    entries.push({ name, version: manifest.version, description: manifest.description });
  }
  return entries;
}

// A registered entry's description is read back from wherever its content
// actually lives, never re-fetched over the network — `list` enumerates local
// state only. A `path:` origin is resolved fresh (register never installs a
// local origin into the inventory, so there is nowhere else to read it from);
// a remote origin's content was already materialized into the local inventory
// at register/install time, so it is read back from there.
async function resolveRegisteredDescription(
  name: string,
  origin: string,
  inventory: TemplateInventory,
  deps: CatalogResolveDeps,
): Promise<string | undefined> {
  if (parseLocalOrigin(origin) !== undefined) {
    return (await resolveLocalManifest(origin, deps))?.description;
  }
  const installed = inventory.lookup(name);
  if (installed === undefined) return undefined;
  const manifest = readManifestFromContent(installed.content);
  return manifest.ok ? manifest.manifest.description : undefined;
}

// `data.registered` — one record per entry in the current project's own
// `templates` map (`inst-list-read`'s `target`).
async function buildRegistered(
  templates: Record<string, TemplateEntry>,
  inventory: TemplateInventory,
  deps: CatalogResolveDeps,
): Promise<RegisteredTemplateEntry[]> {
  const entries: RegisteredTemplateEntry[] = [];
  for (const [name, entry] of Object.entries(templates)) {
    const description = await resolveRegisteredDescription(name, entry.origin, inventory, deps);
    entries.push({
      name,
      origin: entry.origin,
      version: entry.version,
      targets: entry.targets,
      ...(description !== undefined ? { description } : {}),
      ...(entry.excludedSubtrees !== undefined ? { excludedSubtrees: entry.excludedSubtrees } : {}),
    });
  }
  return entries;
}

// `data.installed` — templates the local inventory tracks that are NOT
// (yet) registered to this project; a name already present in `registered`
// is excluded here rather than double-reported under two sets.
async function buildInstalled(inventory: TemplateInventory, registeredNames: ReadonlySet<string>): Promise<ListEntry[]> {
  const all = await listCommand(inventory);
  return all.filter((e) => !registeredNames.has(e.name));
}

/**
 * cpt-frontx-algo-template-resolution-resolve-to-inventory's own reads,
 * composed into the three-set catalog `inst-list-format-machine` (and the
 * human-readable `inst-list-format`) render from. `templates` is the current
 * project's `templates` map (`{}` when no project state document exists —
 * `readProjectState`'s own absence handling), never read by `buildDefaults`.
 */
export async function buildListCatalog(
  templates: Record<string, TemplateEntry>,
  inventory: TemplateInventory,
  deps: CatalogResolveDeps,
): Promise<ListCatalog> {
  const registered = await buildRegistered(templates, inventory, deps);
  const installed = await buildInstalled(inventory, new Set(Object.keys(templates)));
  const defaults = await buildDefaults(deps);
  return { defaults, registered, installed };
}

/** Wraps the catalog in the shared `{ok: true, data}` envelope every command's
 * `--json` mode emits (`cpt-frontx-adr-cli-machine-readable-output`). */
export function listCatalogEnvelope(catalog: ListCatalog): OkEnvelope<ListCatalog> {
  return ok(catalog);
}

// `inst-list-format` — the human-readable form: each set's entries as name
// and version, all three sets reported by name even when a set is empty, and
// the all-empty case collapsed to one message rather than three empty
// headings (`inst-list-empty-return`). `defaults` and `registered` always
// carry a version; `installed` can lack one for a `manifestUnreadable` entry
// (§1.5 governs only the machine-readable form, so this human-form spelling
// is not part of that contract), and such an entry is rendered with an
// explicit marker rather than fabricating a version or printing `@undefined`.
export function formatListHuman(catalog: ListCatalog): string {
  const { defaults, registered, installed } = catalog;
  if (defaults.length === 0 && registered.length === 0 && installed.length === 0) {
    return 'No templates installed.';
  }
  const versionedSection = (title: string, entries: Array<{ name: string; version: string }>): string => {
    const lines = entries.length > 0 ? entries.map((e) => `  ${e.name}@${e.version}`) : ['  (none)'];
    return [`${title}:`, ...lines].join('\n');
  };
  const installedLines =
    installed.length > 0
      ? installed.map((e) => (e.version !== undefined ? `  ${e.name}@${e.version}` : `  ${e.name} (manifest unreadable)`))
      : ['  (none)'];
  return [
    versionedSection('Defaults', defaults),
    versionedSection('Registered', registered),
    ['Installed:', ...installedLines].join('\n'),
  ].join('\n\n');
}
