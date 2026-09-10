// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1
//
// Realizes resolution B1: a template's AI-extension bundle at
// `.frontx/ai/<manifest-name>/` is delivered by a CLI-owned step, never
// through the template's own ownership — `.frontx` stays unconditionally
// subtracted from every template's effective ownership
// (`cpt-frontx-adr-template-ownership-boundary-declaration`). This algorithm
// runs ONCE per name transition (the first target a name gains, or the last
// target a name loses), never per target — the caller decides which
// transition (if any) this call represents; this module never inspects a
// `targets[]` array itself.
//
// Pure logic behind injected seams — no direct filesystem access here,
// matching every other scaffold/manifest module's convention. The real
// fs-backed adapter is `../adapters/fs-ai-bundle.ts`, which joins whatever
// root it is given straight onto `.frontx/ai/<manifestName>/` with no repo
// root of its own to fall back to — so every `root`/`sourceRoot`/`destRoot`
// below is ALWAYS an absolute filesystem path, never one a caller expects
// this module or its adapter to resolve against something else.
export type BundleExistsFn = (root: string, manifestName: string) => Promise<boolean>;
export type CopyBundleFn = (sourceRoot: string, destRoot: string, manifestName: string) => Promise<void>;
export type RemoveBundleFn = (root: string, manifestName: string) => Promise<void>;

// The FEATURE's own input frames "first target gained" and "last target
// lost" as two independent booleans, but the two are mutually exclusive in
// practice — a name transition is always exactly ONE of "just gained its
// first target", "just lost its last target", or "neither" (this call did
// not change the name's target count at all, so it is a no-op regardless of
// bundle state). A discriminated union states that invariant in the type
// itself rather than leaving a caller free to construct the impossible
// "both happened" shape and this module free to decide — arbitrarily —
// which one wins; it also removes the need for a runtime "installedContentPath
// is required only when the first-target case holds" check, since the
// `FIRST_TARGET_GAINED` variant is the only one that carries the field at
// all.
export type AiBundleTransition =
  // `installedContentPath` is the SAME absolute path `ContributionEntry`
  // carries (`scaffold/types.ts`'s own doc comment) — `bundleExists`/
  // `copyBundle` above read it as a root to join `.frontx/ai/<manifestName>/`
  // onto directly, so a caller that passed anything else would have that
  // path resolved against whatever the process happens to be running from.
  | { kind: 'FIRST_TARGET_GAINED'; installedContentPath: string }
  | { kind: 'LAST_TARGET_LOST' }
  | { kind: 'NO_TRANSITION' };

export interface AiBundleInput {
  manifestName: string;
  transition: AiBundleTransition;
  projectRoot: string;
  bundleExists: BundleExistsFn;
  copyBundle: CopyBundleFn;
  removeBundle: RemoveBundleFn;
}

export type AiBundleOutcome = 'materialized' | 'removed' | 'no-op';

/**
 * Materializes or removes the CLI-owned `.frontx/ai/<manifestName>/` bundle
 * for exactly one name transition. A no-op is the correct outcome both when
 * the trigger condition does not hold and when it holds but there is
 * nothing to act on (no bundle in the payload to copy; nothing on disk to
 * remove) — the FEATURE's own three-way outcome union treats both shapes of
 * "nothing happened" as the same `'no-op'` rather than distinguishing why.
 */
export async function materializeOrRemoveAiBundle(input: AiBundleInput): Promise<AiBundleOutcome> {
  const { manifestName, transition, projectRoot, bundleExists, copyBundle, removeBundle } = input;

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-if-first-target
  if (transition.kind === 'FIRST_TARGET_GAINED') {
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-if-first-target

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-if-bundle-present
    const present = await bundleExists(transition.installedContentPath, manifestName);
    if (!present) {
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-if-bundle-present
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-else-no-bundle
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-noop-no-bundle
      return 'no-op';
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-noop-no-bundle
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-else-no-bundle
    }

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-copy
    await copyBundle(transition.installedContentPath, projectRoot, manifestName);
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-copy

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-return
    return 'materialized';
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-return
  }

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-if-last-target
  if (transition.kind === 'LAST_TARGET_LOST') {
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-if-last-target

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-if-bundle-exists
    const exists = await bundleExists(projectRoot, manifestName);
    if (!exists) {
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-if-bundle-exists
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-else-nothing-to-remove
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-noop-no-removal
      return 'no-op';
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-noop-no-removal
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-else-nothing-to-remove
    }

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-remove
    await removeBundle(projectRoot, manifestName);
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-remove

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-return
    return 'removed';
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-return
  }

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-return
  return 'no-op'; // NO_TRANSITION: neither trigger condition holds
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-return
}
