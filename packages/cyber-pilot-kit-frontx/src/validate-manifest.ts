// @cpt-algo:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1
// @cpt-dod:cpt-frontx-dod-ai-kit-packaging-declared-resource-surface:p1
import type { KitDefinition, KitManifest, KitResourceEntry, ResourceBodyReader, ValidationResult, ValidationViolation } from './types.js';

// Two rule sets live in this file. FrontX-owned rules — the `frontx_` id prefix
// (KIT-1), the KIT-4 public skill|rule restriction with applicability metadata,
// and the solution-content scans (cpt-frontx-adr-solution-ai-content-placement)
// — are specified by this repository, and this file is their authoritative
// implementation. Everything else (required fields, id pattern, type enum, path
// containment, the base public/kind contract) is a SNAPSHOT of rules owned by
// the Constructor Studio kit specification
// (`.cf-studio/.core/architecture/specs/kit/kit.md`, engine v1.6.2); their
// authoritative gate is `cfs kit validate` in CI. The mirror exists so
// `loadKitSession` refuses at session start what the CLI refuses at install.
// When the Studio spec moves, update the snapshot from the spec — never treat
// this copy as the definition of Studio behavior.

// Concrete UI-framework names. Split out of SOLUTION_TERMS below because they
// behave differently from the generic concept words they used to sit among: a
// framework name is never legitimate in base-kit content, in a manifest field
// or in a resource body, whereas "template" and "solution" are abstract
// vocabulary the base uses constantly. Both scans in this file therefore
// include this list; only the id/description scan adds the generic words.
//
// LIVE CONSTRAINT ON KIT PROSE: the match is case-insensitive and word-boundary
// only, so it catches the ordinary English verb as readily as the framework —
// "the agent must react to the refusal" fails the body scan, and so does "a
// vue of the inventory" or any sentence reaching for those words. Any resource
// body added to this kit has to route around them (use "respond to", "view").
// That is deliberate: a scan loose enough to tell the framework from the verb
// would have to parse English, and the cost of the false positive is one
// reworded sentence caught loudly in CI, where the cost of a false negative is
// a framework name shipped in the solution-agnostic base.
const FRAMEWORK_NAMES = ['react', 'vue', 'angular', 'svelte'];

// Generic solution/template concept words that must not appear in a base-kit
// resource `id` or `description` (cpt-frontx-adr-solution-ai-content-placement),
// composed with the framework names above.
//
// Deliberately EXCLUDES "studio": the kit's own vendor substrate is named
// Constructor Studio (`cfs`, `.cf-studio-kit.toml`), so the bare word cannot
// distinguish a FrontX solution from the toolchain that installs the kit, and
// flagged every resource whose description merely named the CLI. No FrontX
// solution or template is called "studio" — the term appears nowhere in the
// PRD, DESIGN, or DECOMPOSITION. Re-add it only as a concrete, prefixed name
// (e.g. `frontx-studio`) in this list, never as a bare word.
const SOLUTION_TERMS = [...FRAMEWORK_NAMES, 'template', 'solution', 'screenset'];

// A concrete template package name that must never appear in shipped
// base-kit resource BODIES (cpt-frontx-adr-solution-ai-content-placement).
// This repository is deliberately unaware of what templates exist in the
// templates repository (cpt-frontx-adr-template-acquisition-and-location), so
// this cannot be a maintained list of known names — the check has to
// recognize the SHAPE of a template package identity instead. Every template
// package name follows the same shape: the word "template" hyphen-joined to
// a flavor word, optionally prefixed with "frontx-"; this pattern catches
// that shape structurally, including names never seen here.
//
// Deliberately narrower than the bare "template" word in SOLUTION_TERMS
// above: `template-<word>` requires the hyphenated compound, so legitimate
// abstract prose ("this is template territory") does not trip it, while an
// actual package identity always does.
//
// Two more carve-outs, each load-bearing against this base kit's OWN shipped
// prose:
// - A leading `<` excludes a PLACEHOLDER token like `.frontx/ai/<template-identity>/`:
//   angle brackets mark a variable standing in for a real identity, never a
//   literal one, so nothing here is a name to forbid.
// - The flavor word "specific" excludes the adjective compound
//   "template-specific" (as in "template-specific content"), the same
//   deliberate carve-out SOLUTION_TERMS above documents for "studio": a
//   generic English word the base uses constantly, not a product identity.
const TEMPLATE_PACKAGE_NAME_PATTERN = /(?<![a-z0-9-])(?<!<)(?:frontx-)?template-(?!specific\b)[a-z][a-z0-9-]*/i;

// What a shipped resource BODY is scanned against: the structural template
// package pattern above plus the framework names. The DoD this enforces
// excludes "any concrete template, solution, or framework" from base-kit
// content (cpt-frontx-dod-ai-project-scaffolding-declared-skill-surface), and
// the template pattern alone left the framework half unenforced over bodies.
//
// @internal - exported for this package's own self-validation suite, not part
// of the kit's published surface; `src/index.ts` does not re-export it.
export const FORBIDDEN_BODY_PATTERNS: readonly RegExp[] = [
  TEMPLATE_PACKAGE_NAME_PATTERN,
  ...FRAMEWORK_NAMES.map((name) => new RegExp(`(?<![a-z0-9])${name}(?![a-z0-9])`, 'i')),
];

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-required-fields
function checkRequiredFields(manifest: unknown, violations: ValidationViolation[]): manifest is KitManifest {
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('manifest_version' in manifest) ||
    typeof (manifest as KitManifest).manifest_version !== 'string'
  ) {
    violations.push({ field: 'manifest_version', code: 'MISSING_REQUIRED_FIELD', message: 'manifest_version is required' });
    return false;
  }
  if (!('kits' in manifest) || !Array.isArray((manifest as KitManifest).kits)) {
    violations.push({ field: 'kits', code: 'MISSING_REQUIRED_FIELD', message: 'kits array is required' });
    return false;
  }
  if ((manifest as KitManifest).kits.length === 0) {
    violations.push({ field: 'kits', code: 'EMPTY_KITS', message: 'kits must be a non-empty array' });
    return false;
  }
  return true;
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-required-fields

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-version
function checkVersion(kit: KitDefinition, kitIndex: number, violations: ValidationViolation[]): void {
  if (!kit.version || typeof kit.version !== 'string' || !kit.version.trim()) {
    violations.push({ field: `kits[${kitIndex}].version`, code: 'MISSING_VERSION', message: 'kit version is required and must be non-empty' });
  }
  if (!kit.slug || typeof kit.slug !== 'string' || !kit.slug.trim()) {
    violations.push({ field: `kits[${kitIndex}].slug`, code: 'MISSING_REQUIRED_FIELD', message: 'kit slug is required and must be non-empty' });
  }
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-version

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-resources-array
function checkResourcesArray(resources: unknown, kitIndex: number, violations: ValidationViolation[]): resources is unknown[] {
  if (!Array.isArray(resources)) {
    violations.push({ field: `kits[${kitIndex}].resources`, code: 'MISSING_REQUIRED_FIELD', message: 'resources array is required' });
    return false;
  }
  if (resources.length === 0) {
    violations.push({ field: `kits[${kitIndex}].resources`, code: 'EMPTY_RESOURCES', message: 'resources must be a non-empty array' });
  }
  return true;
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-resources-array

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-for-each-entry
function checkEntry(entry: unknown, prefix: string, violations: ValidationViolation[]): void {
  if (typeof entry !== 'object' || entry === null) {
    violations.push({ field: prefix, code: 'INVALID_ENTRY', message: 'resource entry must be an object' });
    return;
  }
  const e = entry as Record<string, unknown>;

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-entry-required
  for (const required of ['id', 'source', 'install_path', 'type']) {
    if (!e[required] || typeof e[required] !== 'string') {
      violations.push({ field: `${prefix}.${required}`, code: 'MISSING_REQUIRED_FIELD', message: `${required} is required` });
    }
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-entry-required

  const id = typeof e.id === 'string' ? e.id : '';

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-id-pattern
  if (id && !/^[a-z][a-z0-9_]*$/.test(id)) {
    violations.push({ field: `${prefix}.id`, code: 'INVALID_ID_PATTERN', message: `id "${id}" must match ^[a-z][a-z0-9_]*$` });
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-id-pattern

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-frontx-prefix
  if (id && /^[a-z][a-z0-9_]*$/.test(id) && !id.startsWith('frontx_')) {
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-prefix-fail
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-prefix-violation
    violations.push({ field: `${prefix}.id`, code: 'MISSING_FRONTX_PREFIX', message: `resource id "${id}" does not carry the required frontx_ prefix (KIT-1)` });
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-prefix-violation
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-prefix-fail
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-frontx-prefix

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-type-enum
  if (e.type && e.type !== 'file' && e.type !== 'directory') {
    violations.push({ field: `${prefix}.type`, code: 'INVALID_TYPE', message: `type must be "file" or "directory", got "${e.type}"` });
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-type-enum

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-contained-paths
  checkContainedPath(e, 'source', prefix, violations);
  checkContainedPath(e, 'install_path', prefix, violations);
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-contained-paths

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-public-kind
  checkPublicKindContract(e, prefix, violations);
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-public-kind

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-check-public-kind-restricted
  checkPublicKindRestricted(e, id, prefix, violations);
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-check-public-kind-restricted
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-for-each-entry

// Studio refuses a kit whose `source` or `install_path` leaves the kit root
// (`_validate_install_path` / source guard in the engine's kit model). Without
// the same check here, `validateKitManifest` would accept a manifest the CLI
// rejects, and `loadKitSession` would resolve `${registration.path}/${install_path}`
// to a location outside the kit directory.
function checkContainedPath(
  e: Record<string, unknown>,
  field: 'source' | 'install_path',
  prefix: string,
  violations: ValidationViolation[],
): void {
  const value = e[field];
  if (typeof value !== 'string' || !value) return;
  // Normalize Windows separators before splitting so `..\..` is caught too.
  const parts = value.replace(/\\/g, '/').split('/');
  const absolute = value.startsWith('/') || /^[a-zA-Z]:/.test(value);
  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-path-escapes
  if (absolute || parts.includes('..')) {
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-path-escape
    violations.push({
      field: `${prefix}.${field}`,
      code: 'PATH_ESCAPES_KIT_ROOT',
      message: `${field} "${value}" must be a relative path contained within the kit root (no leading "/" and no ".." segments)`,
    });
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-path-escape
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-path-escapes
}

// Studio admits `public = true` only for the `skill`, `agent`, and `rule` kinds
// and raises a hard error otherwise, so accepting it here would green-light a
// manifest the CLI refuses to load. See the sibling note in `.cf-studio-kit.toml`.
const PUBLIC_KINDS = ['skill', 'agent', 'rule'];

function checkPublicKindContract(
  e: Record<string, unknown>,
  prefix: string,
  violations: ValidationViolation[],
): void {
  if (!('public' in e) || e.public === undefined) return;
  if (typeof e.public !== 'boolean') {
    violations.push({
      field: `${prefix}.public`,
      code: 'INVALID_PUBLIC',
      message: `public must be a boolean, got "${String(e.public)}"`,
    });
    return;
  }
  const kind = typeof e.kind === 'string' ? e.kind : '';
  if (e.public && !PUBLIC_KINDS.includes(kind)) {
    violations.push({
      field: `${prefix}.public`,
      code: 'PUBLIC_KIND_NOT_ALLOWED',
      message: `public=true is only allowed for ${PUBLIC_KINDS.join(', ')} resources, got kind "${kind}"`,
    });
  }
}

// KIT-4 narrows public agent-facing entry points in cyber-pilot-kit-frontx to
// skill|rule: the base structural check above (checkPublicKindContract) still
// admits `agent` because that is what the Studio substrate itself allows, but
// this kit declares no agent-kind resource and must not ship one as public.
const PUBLIC_KINDS_RESTRICTED: readonly string[] = ['skill', 'rule'];

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-check-public-kind-restricted
function checkPublicKindRestricted(
  e: Record<string, unknown>,
  id: string,
  prefix: string,
  violations: ValidationViolation[],
): void {
  const kind = typeof e.kind === 'string' ? e.kind : '';
  if (e.public === true && !PUBLIC_KINDS_RESTRICTED.includes(kind)) {
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-if-public-kind-restricted-fail
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-record-public-kind-violation
    violations.push({
      field: `${prefix}.public`,
      code: 'PUBLIC_KIND_RESTRICTED',
      message: `resource "${id || prefix}" is declared public with kind "${kind}", which KIT-4 restricts to skill or rule`,
    });
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-record-public-kind-violation
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-if-public-kind-restricted-fail
  }
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-check-public-kind-restricted

// Frontmatter is the applicability-metadata channel KIT-4 mandates: an agent
// host reads a public resource's OWN document to learn when the capability
// applies, without needing to cross-reference the manifest. Only the
// `description` field is load-bearing here (see FEATURE DoD clause b); the
// resource may carry other frontmatter keys freely.
function extractFrontmatterDescription(body: string): string {
  const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return '';
  const descriptionLine = frontmatter[1].match(/^description:\s*(.*)$/m);
  if (!descriptionLine) return '';
  return descriptionLine[1].trim().replace(/^["']|["']$/g, '');
}

function checkApplicabilityMetadata(
  entry: unknown,
  prefix: string,
  bodyReader: ResourceBodyReader | undefined,
  violations: ValidationViolation[],
): void {
  if (typeof entry !== 'object' || entry === null) return;
  const e = entry as KitResourceEntry;
  // Reading the document requires filesystem access via bodyReader; when none
  // is supplied (pure manifest-shape validation), this check is skipped —
  // mirroring checkResourceBodyContent's own bodyReader guard below.
  if (e.public !== true || !bodyReader) return;

  let bodies: string[];
  try {
    bodies = bodyReader.read(e);
  } catch {
    // Unreadable bodies are already reported as RESOURCE_BODY_UNREADABLE by
    // checkResourceBodyContent; do not double-report here.
    return;
  }

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-check-applicability-metadata
  const description = extractFrontmatterDescription(bodies[0] ?? '');
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-check-applicability-metadata
  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-if-applicability-metadata-fail
  if (!description) {
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-record-applicability-violation
    violations.push({
      field: `${prefix}.source`,
      code: 'MISSING_APPLICABILITY_METADATA',
      message: `public resource "${e.id}" is missing non-empty applicability metadata (frontmatter description) in its document at "${e.source}"`,
    });
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-record-applicability-violation
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p2:inst-if-applicability-metadata-fail
}

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-scan-solution-content
function checkSolutionContent(entry: unknown, prefix: string, violations: ValidationViolation[]): void {
  if (typeof entry !== 'object' || entry === null) return;
  const e = entry as Record<string, unknown>;
  const id = typeof e.id === 'string' ? e.id : '';
  const description = typeof e.description === 'string' ? e.description : '';
  const combined = `${id} ${description}`.toLowerCase();
  const found = SOLUTION_TERMS.find((term) => {
    const re = new RegExp(`(?<![a-z])${term}(?![a-z])`, 'i');
    return re.test(combined);
  });
  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-solution-content
  if (found) {
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-solution-violation
    violations.push({
      field: `${prefix}.id`,
      code: 'SOLUTION_SPECIFIC_CONTENT',
      message: `resource id or description "${id}" appears to contain solution-specific content ("${found}"), which is prohibited by cpt-frontx-adr-solution-ai-content-placement`,
    });
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-solution-violation
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-solution-content
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-scan-solution-content

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-scan-solution-content
/**
 * The name a shipped resource body carries that base-kit content may not name,
 * or `undefined` when it carries none. The single authority for both the list
 * and the word-boundary rule that matches it.
 *
 * @internal - exported for this package's own self-validation suite, not part
 * of the kit's published surface; `src/index.ts` does not re-export it.
 * @param text - a shipped resource body, or any excerpt of one
 */
export function findForbiddenSolutionName(text: string): string | undefined {
  for (const pattern of FORBIDDEN_BODY_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return undefined;
}

function checkResourceBodyContent(
  entry: unknown,
  prefix: string,
  bodyReader: ResourceBodyReader | undefined,
  violations: ValidationViolation[],
): void {
  if (!bodyReader) return;
  if (typeof entry !== 'object' || entry === null) return;
  const e = entry as KitResourceEntry;

  let bodies: string[];
  try {
    bodies = bodyReader.read(e);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    violations.push({
      field: `${prefix}.source`,
      code: 'RESOURCE_BODY_UNREADABLE',
      message: `unable to read shipped resource body for "${e.id ?? e.source}": ${msg}`,
    });
    return;
  }

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-solution-content
  for (const body of bodies) {
    const found = findForbiddenSolutionName(body);
    if (found) {
      // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-solution-violation
      violations.push({
        field: `${prefix}.source`,
        code: 'SOLUTION_SPECIFIC_CONTENT',
        message: `shipped body of resource "${e.id}" names a specific template, solution, or framework ("${found}"), which is prohibited by cpt-frontx-adr-solution-ai-content-placement`,
      });
      // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-solution-violation
      break;
    }
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-solution-content
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-scan-solution-content

export function validateKitManifest(manifest: unknown, bodyReader?: ResourceBodyReader): ValidationResult {
  const violations: ValidationViolation[] = [];

  if (!checkRequiredFields(manifest, violations)) {
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-violations
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-fail
    return { status: 'FAIL', violations };
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-fail
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-violations
  }

  const m = manifest as KitManifest;

  for (let k = 0; k < m.kits.length; k++) {
    const kit = m.kits[k];
    if (typeof kit !== 'object' || kit === null) {
      violations.push({ field: `kits[${k}]`, code: 'INVALID_ENTRY', message: 'kit entry must be an object' });
      continue;
    }

    checkVersion(kit, k, violations);
    if (!checkResourcesArray(kit.resources, k, violations)) continue;

    for (let i = 0; i < kit.resources.length; i++) {
      const prefix = `kits[${k}].resources[${i}]`;
      checkEntry(kit.resources[i], prefix, violations);
      checkSolutionContent(kit.resources[i], prefix, violations);
      checkResourceBodyContent(kit.resources[i], prefix, bodyReader, violations);
      checkApplicabilityMetadata(kit.resources[i], prefix, bodyReader, violations);
    }
  }

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-violations
  if (violations.length > 0) {
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-fail
    return { status: 'FAIL', violations };
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-fail
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-violations

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-pass
  return { status: 'PASS', violations: [] };
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-pass
}
