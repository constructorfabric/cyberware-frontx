// @cpt-algo:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1
/**
 * Filesystem realization of the AI-extension discovery scan, reading the
 * on-disk bundle convention fixed by the template-ai-extensions FEATURE's
 * §1.5 AI-Extension Bundle Convention: a per-template id-scoped bundle root
 * `.frontx/ai/<template-identity>/`, its own anchor
 * `.frontx/ai/<template-identity>/extension.json` (bundle identity +
 * contract version + the `{id, category, path}` entry list), and the four
 * closed-set slot subdirs (`skills/`, `workflows/`, `guidelines/`,
 * `reference-artifacts/`) scoped to that bundle root. Any number of
 * co-applied templates' bundles co-locate under `.frontx/ai/` as disjoint
 * id-scoped subtrees, each discovered independently.
 *
 * Pure over an injected `BundleFsReader` (mirrors `ResourceBodyReader`'s DI
 * shape) so the algorithm is testable without touching real disk; production
 * usage supplies `createFsBundleReader()` from `fs-bundle-reader.ts`.
 */
import type { AiExtensionBundle, ExtensionCategory, StructuralError, TrustDenial } from './types.js';
import { checkIdentityTrust } from './trust.js';
import type { ProjectStateDocument } from '../project-state.js';

/** Injectable filesystem access for the AI-extension bundle scan. */
export interface BundleFsReader {
  /** Reads a file's UTF-8 content; `undefined` if missing/unreadable. */
  readFile(path: string): string | undefined;
  /** Lists immediate child names of a directory; `undefined` if missing/not a directory. */
  listDir(path: string): string[] | undefined;
}

/** Maps each closed-set category to its on-disk slot subdirectory name. */
export const SLOT_DIR_NAMES: Record<ExtensionCategory, string> = {
  skills: 'skills',
  workflows: 'workflows',
  guidelines: 'guidelines',
  reference_artifacts: 'reference-artifacts',
};

const KNOWN_SLOT_DIRS = new Set(Object.values(SLOT_DIR_NAMES));

/** Discovery result for ONE id-scoped bundle root `.frontx/ai/<template-identity>/`. */
export interface DiscoveredBundle {
  /** The `<template-identity>` path segment this bundle root was discovered under. */
  identity: string;
  /** Conforming raw entries, ready to feed into `scanAndComposeExtensions`. */
  bundle: AiExtensionBundle;
  /** Structural errors found at the fs level, scoped to this bundle root. */
  structuralErrors: StructuralError[];
  /**
   * Present when this identity's bundle was excluded on trust grounds
   * (§1.1-1.2, §4 transition 1) — `bundle` and `structuralErrors` are both
   * empty in that case, because no slot of a denied bundle is ever read.
   */
  denial?: TrustDenial;
}

function joinPath(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join('/')
    .replace(/\/+/g, '/');
}

function isSlotCategory(value: unknown): value is ExtensionCategory {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SLOT_DIR_NAMES, value);
}

/**
 * Validates one declared entry's ON-DISK shape against its slot's required
 * layout. Distinct from `validateExtensionEntry` (field-shape only) — this
 * additionally confirms the entry's declared `path` resolves to real,
 * conforming content under the bundle root.
 */
function validateOnDiskShape(
  raw: unknown,
  bundleRoot: string,
  reader: BundleFsReader,
): { ok: true } | { ok: false; error: StructuralError } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { slot: 'unknown', entryId: 'unknown', message: 'declared AI-extension entry must be an object' } };
  }

  const e = raw as Record<string, unknown>;
  const id = typeof e.id === 'string' && e.id.trim() ? e.id : 'unknown';
  const category = e.category;
  const path = e.path;

  if (!isSlotCategory(category)) {
    return {
      ok: false,
      error: {
        slot: typeof category === 'string' ? category : 'unknown',
        entryId: id,
        message: `entry "${id}" declares category "${String(category)}" outside the closed set (${Object.keys(SLOT_DIR_NAMES).join(', ')})`,
      },
    };
  }

  if (typeof path !== 'string' || !path.trim()) {
    return { ok: false, error: { slot: category, entryId: id, message: `entry "${id}" is missing a required "path"` } };
  }

  if (category === 'skills') {
    const skillFile = joinPath(bundleRoot, path, 'SKILL.md');
    if (reader.readFile(skillFile) === undefined) {
      return { ok: false, error: { slot: category, entryId: id, message: `skill "${id}" is missing SKILL.md at "${skillFile}"` } };
    }
    return { ok: true };
  }

  const filePath = joinPath(bundleRoot, path);
  if (reader.readFile(filePath) === undefined) {
    return { ok: false, error: { slot: category, entryId: id, message: `${category} entry "${id}" content not found at "${filePath}"` } };
  }
  return { ok: true };
}

/**
 * Reads and parses the project's single state document,
 * `<contentRoot>/.frontx/project.json`, through the SAME injected
 * `BundleFsReader` the bundle scan itself uses — no new I/O dependency is
 * introduced for the trust gate. `null` for an absent, unparseable, or
 * structurally-invalid (missing/malformed `templates` map) document; per
 * §1.2, deny is the safe direction, so a `null` result denies every
 * discovered identity downstream rather than guessing at partial content.
 */
export function readProjectStateDocument(contentRoot: string, reader: BundleFsReader): ProjectStateDocument | null {
  const raw = reader.readFile(joinPath(contentRoot, '.frontx', 'project.json'));
  if (raw === undefined) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.templates !== 'object' || candidate.templates === null) return null;

  return candidate as unknown as ProjectStateDocument;
}

/**
 * Scans ONE id-scoped bundle root `.frontx/ai/<template-identity>/` for its
 * anchor `extension.json` and closed-set slot subdirs, per the FEATURE's
 * §1.5 on-disk convention, returning the conforming entries plus any
 * structural errors — scoped entirely to this bundle root so a malformed
 * bundle never affects a sibling bundle discovered under the same
 * `.frontx/ai/`.
 *
 * The identity's trust check (`checkIdentityTrust`, imported from `./trust.js` — the
 * SAME predicate `scanAndComposeExtensions` gates on) runs FIRST,
 * before the anchor is even read: a denied identity's bundle is excluded
 * from discovery wholesale, and no slot of it — not even `extension.json` —
 * is ever read (§1.1-1.2, §4 transition 1).
 */
function discoverSingleBundle(
  identity: string,
  bundleRoot: string,
  reader: BundleFsReader,
  projectState: ProjectStateDocument | null,
): DiscoveredBundle {
  const trust = checkIdentityTrust(identity, projectState);
  if (!trust.trusted) {
    return { identity, bundle: [], structuralErrors: [], denial: trust.denial };
  }

  const anchorPath = joinPath(bundleRoot, 'extension.json');

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-bundle
  const anchorRaw = reader.readFile(anchorPath);
  if (anchorRaw === undefined) {
    return {
      identity,
      bundle: [],
      structuralErrors: [{ slot: 'unknown', entryId: 'unknown', message: `missing AI-extension bundle anchor at "${anchorPath}"` }],
    };
  }

  let parsedAnchor: unknown;
  try {
    parsedAnchor = JSON.parse(anchorRaw);
  } catch {
    return {
      identity,
      bundle: [],
      structuralErrors: [{ slot: 'unknown', entryId: 'unknown', message: `AI-extension bundle anchor at "${anchorPath}" is not valid JSON` }],
    };
  }

  if (
    typeof parsedAnchor !== 'object' ||
    parsedAnchor === null ||
    typeof (parsedAnchor as Record<string, unknown>).id !== 'string' ||
    !(parsedAnchor as Record<string, unknown>).id
  ) {
    return {
      identity,
      bundle: [],
      structuralErrors: [
        { slot: 'unknown', entryId: 'unknown', message: `AI-extension bundle anchor at "${anchorPath}" is missing a bundle identity ("id")` },
      ],
    };
  }

  const declaredEntries = Array.isArray((parsedAnchor as Record<string, unknown>).entries)
    ? ((parsedAnchor as Record<string, unknown>).entries as unknown[])
    : [];
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-bundle

  const structuralErrors: StructuralError[] = [];

  const bundleRootDirs = reader.listDir(bundleRoot) ?? [];
  for (const name of bundleRootDirs) {
    if (!KNOWN_SLOT_DIRS.has(name)) {
      structuralErrors.push({
        slot: name,
        entryId: 'unknown',
        message: `"${name}" is a subdirectory of "${bundleRoot}" outside the closed-set AI-extension categories (${[...KNOWN_SLOT_DIRS].join(', ')})`,
      });
    }
  }

  const bundle: unknown[] = [];
  for (const raw of declaredEntries) {
    const shapeResult = validateOnDiskShape(raw, bundleRoot, reader);
    if (!shapeResult.ok) {
      structuralErrors.push(shapeResult.error);
      continue;
    }
    bundle.push(raw);
  }

  return { identity, bundle, structuralErrors };
}

/**
 * Resolves every per-template id-scoped bundle root directly under
 * `aiRoot`. A `<template-identity>` is the template's manifest identity
 * (`cpt-frontx-feature-template-manifest`), which for a scoped npm-style
 * name is always two path segments (`@scope/name`) and for a bare name is
 * exactly one. A first segment starting with `@` is therefore an npm scope,
 * not a complete identity on its own: its immediate children are the actual
 * bundle roots (`@scope/name`). When a `@scope` directory has no children,
 * it is treated as the bundle root itself so a missing/malformed bundle
 * still surfaces its structural error rather than being silently dropped.
 */
function resolveBundleRoots(aiRoot: string, reader: BundleFsReader): { identity: string; root: string }[] {
  const topNames = (reader.listDir(aiRoot) ?? []).slice().sort();
  const roots: { identity: string; root: string }[] = [];
  for (const name of topNames) {
    if (name.startsWith('@')) {
      const scopeDir = joinPath(aiRoot, name);
      const childNames = (reader.listDir(scopeDir) ?? []).slice().sort();
      if (childNames.length === 0) {
        roots.push({ identity: name, root: scopeDir });
      } else {
        for (const childName of childNames) {
          roots.push({ identity: `${name}/${childName}`, root: joinPath(scopeDir, childName) });
        }
      }
    } else {
      roots.push({ identity: name, root: joinPath(aiRoot, name) });
    }
  }
  return roots;
}

/**
 * Scans the scaffolded project's `.frontx/ai/` for EACH per-template
 * id-scoped bundle root `.frontx/ai/<template-identity>/`, discovering every
 * co-located bundle independently, and returns the conforming entries plus
 * structural errors for each — ready to be fed into the EXISTING
 * `scanAndComposeExtensions` algorithm
 * (`cpt-frontx-algo-template-ai-extensions-contract-scan-activate`). Absent
 * `.frontx/ai/` (no templates applied yet) yields no discovered bundles,
 * which is not itself a structural error.
 */
export function discoverExtensionBundlesFromFs(contentRoot: string, reader: BundleFsReader): DiscoveredBundle[] {
  const aiRoot = joinPath(contentRoot, '.frontx', 'ai');

  // Read ONCE per scan, not once per identity — every discovered identity's
  // trust check (`checkIdentityTrust`) is decided against this same parsed
  // document.
  const projectState = readProjectStateDocument(contentRoot, reader);

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery
  // Enumerate each per-template id-scoped bundle root under the scaffolded
  // project's `.frontx/ai/`, resolving scoped npm-style identities
  // (`@scope/name`) to their two-segment bundle root as well as bare
  // one-segment identities; a bundle-root name that is not a real directory
  // simply is not returned by `listDir` and contributes nothing.
  const bundleRoots = resolveBundleRoots(aiRoot, reader).sort((a, b) => a.identity.localeCompare(b.identity));
  return bundleRoots.map(({ identity, root }) => discoverSingleBundle(identity, root, reader, projectState));
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery
}
