// @cpt-algo:cpt-frontx-algo-template-manifest-refuse-legacy:p2
// @cpt-dod:cpt-frontx-dod-template-manifest-legacy-refused-outright:p2
//
// Closes the read-side counterpart to pre-publish validation: a manifest
// declaring any category the four-field contract does not define is never
// read as, or translated into, the four-field shape
// (cpt-frontx-adr-template-manifest-contract). This is the one check every
// manifest-reading command (install, register, apply, assembly) is meant
// to run before reading a manifest as the primary type; its output is
// either the manifest unchanged (already current) or an outright refusal —
// never a translated shape, and never a partial one. This checkpoint
// implements the function itself only — wiring it into a command surface
// or into `readManifestFromContent` is a later checkpoint's scope; the
// `'INVALID_MANIFEST'` code below is typed as a bare string literal for
// now and will adopt the shared multi-code union once that arrives.

// The input/unchanged-output shape: a parsed manifest JSON structure. Kept
// as a bare `Record<string, unknown>` rather than `TemplateManifest`
// itself — this function runs BEFORE a manifest is known to conform to the
// current four-field shape at all, so typing its output as that shape
// would claim a guarantee this function does not establish.
export type ParsedManifestJson = Record<string, unknown>;

export interface ManifestRefusal {
  code: 'INVALID_MANIFEST';
  undeclaredFields: string[];
  message: string;
}

export type RefuseLegacyResult =
  | { ok: true; manifest: ParsedManifestJson }
  | { ok: false; refusal: ManifestRefusal };

// The `ownershipBoundaries` children that themselves name a retired
// category, reported alongside their parent — not instead of it — so a
// refusal naming `ownershipBoundaries` also shows which of its own retired
// children the manifest actually used.
const OWNERSHIP_BOUNDARY_CHILDREN = ['exclusiveSubtrees', 'sharedFiles'] as const;

function collectUndeclaredFields(manifest: ParsedManifestJson): string[] {
  const undeclared: string[] = [];

  if ('schemaVersion' in manifest) undeclared.push('schemaVersion');

  if ('ownershipBoundaries' in manifest) {
    undeclared.push('ownershipBoundaries');
    const boundaries = manifest['ownershipBoundaries'];
    if (typeof boundaries === 'object' && boundaries !== null && !Array.isArray(boundaries)) {
      const boundariesObj = boundaries as Record<string, unknown>;
      for (const child of OWNERSHIP_BOUNDARY_CHILDREN) {
        if (child in boundariesObj) undeclared.push(`ownershipBoundaries.${child}`);
      }
    }
  }

  if ('referencedTemplates' in manifest) undeclared.push('referencedTemplates');

  return undeclared;
}

// @cpt-begin:cpt-frontx-algo-template-manifest-refuse-legacy:p2:inst-mrl-discriminate
export function refuseLegacyManifest(parsed: unknown): RefuseLegacyResult {
  // The discriminator cpt-frontx-adr-template-manifest-contract fixes for
  // "legacy" versus "current": at least one undeclared field present.
  const manifest: ParsedManifestJson =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as ParsedManifestJson)
      : {};
  const undeclaredFields = collectUndeclaredFields(manifest);
  // @cpt-end:cpt-frontx-algo-template-manifest-refuse-legacy:p2:inst-mrl-discriminate

  // @cpt-begin:cpt-frontx-algo-template-manifest-refuse-legacy:p2:inst-mrl-if-current
  if (undeclaredFields.length === 0) {
    // @cpt-begin:cpt-frontx-algo-template-manifest-refuse-legacy:p2:inst-mrl-return-current
    // A current-shape manifest is never subject to this refusal.
    return { ok: true, manifest };
    // @cpt-end:cpt-frontx-algo-template-manifest-refuse-legacy:p2:inst-mrl-return-current
  }
  // @cpt-end:cpt-frontx-algo-template-manifest-refuse-legacy:p2:inst-mrl-if-current

  // @cpt-begin:cpt-frontx-algo-template-manifest-refuse-legacy:p2:inst-mrl-else-legacy
  // @cpt-begin:cpt-frontx-algo-template-manifest-refuse-legacy:p2:inst-mrl-return-legacy-refused
  // No partial credit: every undeclared field present is named regardless
  // of whether `description` is usable or the declared
  // exclusiveSubtrees/sharedFiles were already effectively whole-target.
  // The refusal directs the template's author to convert the manifest by
  // hand, choosing a deliberate `excludedSubtrees` for the current shape —
  // the same conversion path cpt-frontx-feature-template-territory-
  // conversion already performs for this repository's own templates.
  return {
    ok: false,
    refusal: {
      code: 'INVALID_MANIFEST',
      undeclaredFields,
      message: `manifest declares field(s) not part of the four-field contract: ${undeclaredFields.join(', ')}`,
    },
  };
  // @cpt-end:cpt-frontx-algo-template-manifest-refuse-legacy:p2:inst-mrl-return-legacy-refused
  // @cpt-end:cpt-frontx-algo-template-manifest-refuse-legacy:p2:inst-mrl-else-legacy
}
