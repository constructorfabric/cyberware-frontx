// @cpt-flow:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1
// @cpt-algo:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1
/**
 * The trust gate predicate (§1.1-1.2): an identity is trusted exactly when
 * the project's single state document holds a `templates[identity]` entry
 * carrying a non-empty `origin` — the fact that a legitimate
 * `register`/`apply` operation produced that pinning, which post-hoc
 * content placed under `.frontx/ai/` outside the CLI cannot fabricate. A
 * local `path:` origin is trusted exactly like a remote one: the
 * discriminator is PROVENANCE (the entry exists, pinned by the CLI), never
 * the `@sha`/`@ref` shape of the origin string itself.
 *
 * PURE — a function of `(identity, ProjectStateDocument | null)` only, with
 * no filesystem access of its own. It lives in its own neutral module,
 * separate from `fs-discovery.ts` (which reads `.frontx/project.json` off
 * disk and passes the parsed result in) and from `scan.ts` (the algorithm
 * that must actually gate on it), because BOTH of those are legitimate call
 * sites for the SAME check and neither should own it:
 *
 * - `scan.ts`'s `scanAndComposeExtensions` calls it at its own head, before
 *   any entry is scanned — this is the REAL enforcement point for the
 *   algorithm (§3 step 3), reachable through every public entry point,
 *   including the non-fs `discoverAndActivateForInstalledTemplate`. A
 *   caller cannot reach composition without going through this gate.
 * - `fs-discovery.ts`'s `discoverSingleBundle` calls it BEFORE reading a
 *   bundle's `extension.json` anchor at all — an enforcement the algorithm
 *   itself cannot provide, since by the time a bundle's entries reach the
 *   algorithm they have already been read off disk. This second call site
 *   is what keeps a denied identity's files from ever being touched.
 *
 * The flow's step 7 (`inst-check-bundle-trust` / `inst-if-untrusted-identity`
 * / `inst-deny-untrusted-bundle`) and the algorithm's step 3
 * (`inst-check-identity-trust` / `inst-if-identity-untrusted` /
 * `inst-return-denied-bundle`) state this SAME check at two altitudes —
 * implemented ONCE here, carrying both marker sets, the idiom this repo
 * already uses for one shared check cited by two callers
 * (`packages/cli/src/scaffold/effective-ownership.ts`'s six-term
 * subtraction).
 */
import type { TrustDenial } from './types.js';
import { transitionBundledToDenied } from './lifecycle.js';
import { selectTemplateEntry, type ProjectStateDocument } from '../project-state.js';

// @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-bundle-trust
// @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-check-identity-trust
export function checkIdentityTrust(
  identity: string,
  projectState: ProjectStateDocument | null,
): { trusted: true } | { trusted: false; denial: TrustDenial } {
  const entry = projectState ? selectTemplateEntry(projectState, identity) : undefined;
  const isTrusted = !!entry && typeof entry.origin === 'string' && entry.origin.trim().length > 0;

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-if-untrusted-identity
  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-if-identity-untrusted
  if (!isTrusted) {
    // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-deny-untrusted-bundle
    // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-return-denied-bundle
    return { trusted: false, denial: transitionBundledToDenied(identity).denial };
    // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-return-denied-bundle
    // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-deny-untrusted-bundle
  }
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-if-identity-untrusted
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-if-untrusted-identity

  return { trusted: true };
}
// @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-check-identity-trust
// @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-bundle-trust
