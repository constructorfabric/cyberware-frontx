// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
import path from 'node:path';

import { resolveNearestExistingAncestor, isInside, PathContainmentError } from './fs-project-io';

// Names the root in `PathContainmentError`'s message. The typed refusal
// itself is shared with every project-side write; only the noun differs.
export const INVENTORY_STORE_ROOT_LABEL = 'the local inventory store root';

// Computes the addressable path at which a named template's ACTUAL on-disk
// files live in the local inventory store — the "installed content path"
// the FEATURE specifies (`cpt-frontx-algo-template-resolution-resolve-to-inventory`
// inst-resolve-write, inst-resolve-return). Downstream apply/assembly
// (`cpt-frontx-algo-cli-scaffolding-uniform-apply` inst-ua-read-content) reads
// a template's content items directly from this path, never from the
// manifest. Pure path arithmetic — no filesystem access here.
export function resolveInstalledContentPath(root: string, name: string): string {
  return path.join(root, name);
}

// @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-boundary-confirm
// Confirms that a candidate path resolves to somewhere WITHIN the inventory
// store root — the boundary invariant a bounded local update must uphold
// against a real filesystem path (never outside the local inventory store).
// Throws explicitly rather than silently truncating/ignoring an escape.
//
// Resolves both `root` and `candidatePath` through the SAME symlink-following
// walk `assertPathWithinProjectRoot` (`./fs-project-io.ts`) uses for a
// project write, rather than a second, independently formulated check — this
// is pure `path.relative` string arithmetic no longer: a symlink standing
// AT `candidatePath` (or at any component leading to it) that resolves
// outside `root` used to pass this check, because the OLD comparison never
// touched the filesystem at all and so could not see where the link
// actually led. `resolveNearestExistingAncestor` is used directly here
// instead of `assertPathWithinProjectRoot` itself because that assertion
// requires `root` to already exist (`fs.realpathSync`), which the inventory
// store root is not guaranteed to on a template's very first install —
// `resolveNearestExistingAncestor` tolerates a not-yet-existing root and
// candidate identically, falling back to their literal (unresolved) form
// exactly as it always has for ordinary "about to create this" paths.
//
// Throws `PathContainmentError` (`./fs-project-io.ts`) — the SAME typed
// refusal `apply`/`seed`/`delete` already throw for an escaping project
// write — rather than a bare `Error`: a bare `Error` reaches the CLI's
// top-level catch with nothing typed to match, falling through to an
// internal-error exit with no `--json` envelope at all, exactly the false
// "the disk holds something this operation cannot work with" internal
// failure this package's other containment refusals are already spared.
// `PathContainmentError` is already mapped to `INVALID_PATH` there.
export function assertWithinRoot(root: string, candidatePath: string): void {
  const resolvedRoot = resolveNearestExistingAncestor(path.resolve(root));
  const resolvedCandidate = resolveNearestExistingAncestor(path.resolve(candidatePath));
  const escapesRoot = resolvedRoot === null || resolvedCandidate === null || !isInside(resolvedRoot, resolvedCandidate);
  if (escapesRoot) {
    throw new PathContainmentError(candidatePath, root, INVENTORY_STORE_ROOT_LABEL);
  }
}
// @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-boundary-confirm
