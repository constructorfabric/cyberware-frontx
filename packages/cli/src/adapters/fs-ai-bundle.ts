// Real fs-backed seams for `../scaffold/ai-bundle.ts`
// (`cpt-frontx-algo-cli-scaffolding-ai-bundle`). Thin fs wrappers behind the
// `BundleExistsFn`/`CopyBundleFn`/`RemoveBundleFn` seams that module's pure
// logic depends on — matching `fs-project-io.ts`'s own convention of a real
// adapter per injected seam type, kept in its own file rather than added to
// that one since neither concern shares any code with the other.
//
// A directory copy/remove, unlike `fs-project-io.ts`'s project-state-store
// write, has no atomicity requirement to uphold: the bundle is a read-only
// convention folder the CLI copies verbatim or deletes outright, never a
// document a partial write could corrupt into an unparseable state. So
// `fs.cpSync`/`fs.rmSync` are used directly rather than through a
// temp-then-rename step.
import fs from 'node:fs';
import path from 'node:path';
import type { BundleExistsFn, CopyBundleFn, RemoveBundleFn } from '../scaffold/ai-bundle';
import {
  assertPathWithinProjectRoot,
  firstNonDirectoryComponentOf,
  isInside,
  resolveNearestExistingAncestor,
  resolveWriteParentDir,
} from './fs-project-io';
import { FRONTX_NAMESPACE_ROOT } from '../manifest/types';

// The one place `.frontx/ai/<manifestName>/` is spelled, from either a
// template's installed content path (source) or the project root (dest) —
// both sides use the identical convention, so this is the single function
// both real seams below resolve their working path through, rather than
// each re-deriving the same join independently. `path.join` (not a manual
// `/`-join) because `manifestName` legitimately carries its own `/`
// (a scoped identity of the `@scope/package` shape), which `path.join` folds
// into the same platform-native segments as `root` itself.
function bundlePath(root: string, manifestName: string): string {
  return path.join(root, FRONTX_NAMESPACE_ROOT, 'ai', manifestName);
}

// The root of the CLI-owned `.frontx/ai/` namespace itself — the boundary
// `reclaimNonDirectoryAiAncestor` below checks a blocking ancestor against
// before ever removing it, and the SAME `.frontx/ai/` join `bundlePath`
// above performs one level deeper (down to `<manifestName>`), never a second
// independently-spelled join.
function aiNamespaceRoot(root: string): string {
  return path.join(root, FRONTX_NAMESPACE_ROOT, 'ai');
}

/**
 * `dest` — the bundle's own destination, or a scope component leading to it
 * — resolves, once every symlink along it is followed, to somewhere OUTSIDE
 * the REAL `.frontx/ai/` directory. ADR 0031
 * (`architecture/ADR/0031-template-ownership-boundary-declaration.md`) makes
 * that whole namespace ground the CLI alone writes and removes; CLI-owned
 * ground is defined by RESOLVED LOCATION, not by spelling, so a symlink at a
 * scope component that ALIASES a developer's own directory elsewhere in the
 * project is not this namespace's ground merely because its lexical path
 * starts with `.frontx/ai/`. `resolvedPath` names where the alias actually
 * leads, so the refusal is actionable rather than only naming the spelling
 * the developer already knows.
 */
export class AiNamespaceAliasError extends Error {
  readonly destPath: string;
  readonly resolvedPath: string;

  constructor(destPath: string, resolvedPath: string) {
    super(
      `Refusing to write ".frontx/ai/": "${destPath}" resolves, through a symlink, to "${resolvedPath}" — outside ` +
        'the CLI-owned `.frontx/ai/` directory (ADR 0031) — rather than clearing or writing through a directory the ' +
        'CLI never created.',
    );
    this.name = 'AiNamespaceAliasError';
    this.destPath = destPath;
    this.resolvedPath = resolvedPath;
  }
}

// @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-alias-guard
/**
 * Confirms `dest`'s PARENT chain resolves, every symlink followed, to
 * somewhere inside the REAL `.frontx/ai/` directory — not merely that its
 * LEXICAL spelling starts with `.frontx/ai/`, which
 * `reclaimNonDirectoryAiAncestor` and `clearBundleDestination`/`fs.rmSync`
 * below both trust implicitly otherwise. CLI-owned ground is decided by
 * resolved location, not by spelling (ADR 0031).
 *
 * The parent chain, and deliberately NOT `dest` itself. The two are
 * different facts with different answers:
 *
 *   - a symlink standing at `dest`'s OWN final component is ground this
 *     algorithm owns outright, and `clearBundleDestination` removes the LINK
 *     rather than following it, leaving whatever it aliased untouched — the
 *     behaviour every shape of that case is already pinned against;
 *   - a symlink standing at an ANCESTOR component (`@scope`) puts `dest`
 *     itself inside a directory the CLI never created, where the same
 *     recursive `fs.rmSync` clears a developer's own files. Confirmed by
 *     repro: a scope component aliasing `mystuff/` cost `mystuff/a/keep.txt`
 *     under `ok:true`.
 *
 * Uses the SAME `resolveNearestExistingAncestor`/`isInside` walk
 * `assertPathWithinProjectRoot` (`./fs-project-io.ts`) already applies to the
 * project root, narrowed here to the `.frontx/ai/` boundary that function
 * does not itself check.
 *
 * Tolerates a `.frontx/ai/` that does not exist yet (the ordinary case before
 * this name's very first bundle): nothing can alias ground never created.
 */
function assertDestinationInsideAiNamespace(destRoot: string, dest: string): void {
  const nsRoot = aiNamespaceRoot(destRoot);
  const resolvedNsRoot = resolveNearestExistingAncestor(path.resolve(nsRoot));
  const destParent = path.dirname(path.resolve(dest));
  const resolvedParent = resolveNearestExistingAncestor(destParent);
  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-alias-guard-fail
  // The namespace root is its own parent's boundary too: `dest` directly
  // under `.frontx/ai/` resolves its parent TO that root, which `isInside`
  // accepts as the root itself.
  if (resolvedNsRoot === null || resolvedParent === null || !isInside(resolvedNsRoot, resolvedParent)) {
    throw new AiNamespaceAliasError(dest, resolvedParent ?? '<unresolvable — a symlink cycle>');
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-alias-guard-fail
}
// @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-alias-guard

// @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-reclaim-ancestor-blocker
/**
 * A scoped manifest name (`@scope/pkg`) nests its bundle one path component
 * below `.frontx/ai/` — `.frontx/ai/@scope/pkg/` — so `dest`'s own parent
 * chain can itself run through an ancestor component (`@scope`) that does
 * not exist yet as a directory at all. `fs.mkdirSync(..., { recursive: true
 * })` on such a chain throws `EEXIST`/`ENOTDIR` the moment it reaches a
 * component that already exists as something else, uncaught by anything
 * `createFsCopyBundleFn` itself does, and reported to a caller as an
 * internal failure (exit 2) for what is really an ordinary, actionable
 * state of the tree.
 *
 * `.frontx/ai/` is ground this CLI owns outright — sole writer and sole
 * remover (`architecture/ADR/0031-template-ownership-boundary-declaration.md`).
 * A regular file, FIFO, socket, or device standing at a component STRICTLY
 * BETWEEN `.frontx/ai/` and `dest` — including a symlink resolving to any of
 * those, or a dangling one — therefore cannot be anything the CLI itself put
 * there (the CLI only ever creates directories and the bundle's own final
 * leaf there) and cannot be holding another template's bundle content (a
 * bundle's own content lives AT a scoped name's leaf, never on the path down
 * to one) — so it is RECLAIMED, the identical treatment `clearBundleDestination`
 * already gives `dest` itself, rather than refused. `firstNonDirectoryComponentOf`
 * (`./fs-project-io.ts`) never reports one of these shapes by the resolved
 * alias it points at — always by its own position in `.frontx/ai/` — which is
 * exactly the path this function needs to remove.
 *
 * A DIRECTORY found at that same component, OR A SYMLINK RESOLVING TO ONE, is
 * never touched: `mkdir -p` traverses either exactly the same way, and both
 * may legitimately hold other scoped names under the same `@scope` (e.g.
 * `.frontx/ai/@x/other/`) or alias a developer's own directory the bundle is
 * meant to land inside — removing either would take content down with it
 * that this reclaim has no business touching, exactly the STALE-MERGE class
 * `clearBundleDestination`'s own doc comment above already reasons about for
 * `dest`'s own ground, one level up the same tree. `firstNonDirectoryComponentOf`
 * itself is what decides this: it follows a symlink ancestor through to
 * what it actually resolves to, rather than judging the link's own `lstat`
 * kind (which is never `isDirectory()`), so a scope component symlinked to a
 * directory reaches neither this reclaim nor an outright refusal — the copy
 * below simply writes through it, same as it would through an ordinary
 * directory.
 *
 * `dest` itself is deliberately excluded from what this function reclaims —
 * a symlink or any other entry standing exactly AT `dest` is
 * `clearBundleDestination`'s own ground to clear, once `dest`'s parent chain
 * is confirmed buildable. And a blocker resolving OUTSIDE `.frontx/ai/`
 * entirely (an ancestor of `.frontx/ai/` itself, such as `.frontx` blocked
 * by a stray file) is left alone: that ground is not this namespace's own,
 * and `assertPathWithinProjectRoot` — already run by every caller before
 * this — is what continues to refuse an escaping symlink found anywhere
 * along the way, unchanged.
 */
function reclaimNonDirectoryAiAncestor(destRoot: string, dest: string): void {
  const blocker = firstNonDirectoryComponentOf(dest);
  if (blocker === null || blocker === dest) return; // no blocker, or the destination's own ground — `clearBundleDestination` reclaims that
  if (!isInside(aiNamespaceRoot(destRoot), blocker)) return; // outside `.frontx/ai/`: not this namespace's ground to reclaim
  fs.rmSync(blocker, { force: true }); // a regular file, FIFO, socket, device, or a symlink resolving to one of those (or dangling) — `firstNonDirectoryComponentOf` never returns a directory, nor a symlink resolving to one
}
// @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-reclaim-ancestor-blocker

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

// `lstat` fails `ENOTDIR`, not `ENOENT`, when a component ABOVE the bundle
// path — the scope component of a scoped manifest name, e.g. `@x` in
// `@x/a` — exists and is not a directory. Distinguished from `isEnoent`
// above so `createFsBundleExistsFn`'s own catch can name the reason it
// treats this the same way, below.
function isEnotdir(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOTDIR';
}

/** Real `BundleExistsFn` — true when something stands at the bundle path,
 * decided with `lstat` semantics rather than `existsSync`'s.
 *
 * `existsSync` FOLLOWS the final path component, so a dangling symlink left
 * at `<root>/.frontx/ai/<manifestName>/` — its own target already removed,
 * the link itself still present — would read as absent. That is exactly the
 * state `createFsCopyBundleFn`'s own handling below has to defend against on
 * the next `apply`, and the reason this function uses `lstat` instead:
 * `lstat` reports the entry AT that path without dereferencing it, so a
 * symlink is "there" whether or not what it points to is, matching how
 * `assertPathWithinProjectRoot`'s own dangling-symlink handling (`./
 * fs-project-io.ts`) already treats a dangling link as a real entry rather
 * than an ordinary not-yet-existing path. `ENOENT` — nothing at all standing
 * at the path — means absent, and so does `ENOTDIR` — a non-directory
 * ancestor blocking a scope component strictly above this bundle's own path
 * (`inst-aib-exists-blocked-ancestor`) makes the bundle itself unreachable,
 * which is the identical fact for THIS question: no valid bundle stands
 * beneath a non-directory, whatever the reason a scope component looks that
 * way today. Any other `lstat` failure (e.g. a permission error) still
 * propagates rather than silently reading as "no bundle here", the same
 * asymmetry `createFsUnlinkDiskFileFn` (`./fs-upgrade-io.ts`) draws between
 * "already gone" and every other failure. */
export function createFsBundleExistsFn(): BundleExistsFn {
  return async function bundleExists(root: string, manifestName: string): Promise<boolean> {
    try {
      fs.lstatSync(bundlePath(root, manifestName));
      return true;
    } catch (error) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-exists-blocked-ancestor
      if (isEnoent(error) || isEnotdir(error)) return false;
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1:inst-aib-exists-blocked-ancestor
      throw error;
    }
  };
}

// SYMLINK-ABORT: replacing `.frontx/ai/<manifestName>/` with a symlink to a
// path inside the project that does not exist, then applying again, would
// otherwise hand `fs.cpSync` a destination whose final component is a
// symlink. `cpSync` calls `fs.statSync(dest)` internally to decide whether
// it is copying onto a file or a directory; `statSync` DEREFERENCES a
// symlink, and dereferencing one whose target does not exist throws libuv's
// own `filesystem_error` — not a catchable `Error` a JS `try`/`catch` around
// this module's own `copyBundle` call can see, an uncaught C++ exception
// that aborts the whole process (`libc++abi: terminating due to uncaught
// exception`). No envelope would be emitted, and by the time it aborts, the
// payload for the NEW target may already be on disk while `project.json`
// still says `targets: []` — the crash would land after materialization,
// before the record write.
//
// Removing whatever stands at `dest` before ever calling `cpSync` is
// therefore not merely a crash-avoidance measure but the behaviour ADR 0031
// already assigns this path: "`.frontx` is excluded from every template's
// ownership... The CLI itself materializes that bundle as a CLI-owned
// step... No template ever claims this path through `excludedSubtrees` or
// any other ownership declaration; the CLI, not the template, is the sole
// writer and remover of `.frontx/ai/<manifest-name>/`" (`architecture/ADR/
// 0031-template-ownership-boundary-declaration.md`). Since nothing else is
// ever entitled to have placed content at this exact path, clearing
// whatever is found there — dangling symlink, live symlink, a real
// directory, or (the ordinary case) nothing at all — is the CLI reclaiming
// its own ground, not a destructive guess.
//
// STALE-MERGE: clearing ONLY a symlink and leaving a pre-existing real
// DIRECTORY standing is not safe on the reasoning that `cpSync`'s recursive
// merge "handles that case correctly" — a merge does not handle it
// correctly, it handles it SILENTLY. A file the previous bundle shipped and
// the new one dropped would survive the copy, because a recursive merge
// only ever adds and overwrites, never removes. The path where that
// actually happens is already known and already reported: `delete` can fail
// to remove a bundle and says so through its own `aiBundleResidue`, leaving
// a real directory of the OLD bundle's files at exactly this path for the
// next apply to merge into — the result would be a bundle that is neither
// the old one nor the new one, with nothing in any report saying so.
//
// So the whole entry is removed, whatever it is. `fs.rmSync` decides what to
// remove by `lstat`, so a symlink is unlinked as a directory ENTRY — never
// walked into, never deleting whatever it points at — and a LIVE symlink's
// real target, reachable from elsewhere in the project, is left untouched;
// only the stale reference at this one path is cleared. The containment
// guard in `createFsCopyBundleFn` has already refused a `dest` whose real
// (or dangling-lexical) target lands outside the project root before this
// ever runs, so the ground being cleared is always inside the project and
// always the CLI's own. `force: true` keeps "nothing there yet" — the
// ordinary first apply — a no-op rather than an ENOENT, matching
// `createFsRemoveBundleFn` below, which reclaims the identical ground the
// identical way.
function clearBundleDestination(dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true });
}

/** Real `CopyBundleFn` — copies the source's bundle folder into the
 * destination verbatim, creating every parent directory the destination
 * needs. `fs.cpSync`'s own `recursive: true` walks the whole convention
 * folder (extension.json, guidelines/, workflows/, skills/ — whatever a
 * template's real bundle carries), so no bespoke walker is needed here.
 *
 * CONTAINMENT ESCAPE FIX: `dest` is proven to stay inside `destRoot`
 * (the project root every real caller passes here), symlinks resolved,
 * before anything is created or copied — `assertPathWithinProjectRoot`
 * (`./fs-project-io.ts`) is the ONE shared check every adapter that writes
 * into a project uses. `destRoot` is an ordinary argument on this seam
 * already, unlike `WriteFileFn`/`RemoveProjectFileFn`, so no factory-level
 * threading is needed here.
 *
 * DANGLING-SYMLINK-INSIDE: this must not call the literal
 * `fs.mkdirSync(path.dirname(dest), ...)`. A dangling `.frontx/ai/
 * <manifestName>` symlink whose lexical target resolves INSIDE the project
 * root is deliberately ALLOWED by `assertPathWithinProjectRoot` above, but
 * `path.dirname` on a path through such a link names the directory
 * containing the LINK, not the directory its resolved target needs — which
 * the link's own parent already has. A literal `mkdirSync(path.
 * dirname(dest))` therefore creates nothing useful, and a dangling internal
 * `.frontx/ai` link throws an uncaught `ENOENT` on that literal parent,
 * which `apply.ts`'s own generic catch reports as `INVALID_PATH` only
 * because that catch fires on ANY thrown error here — not because
 * containment was the problem; the real cause (a missing directory one
 * level down, at the resolved target) never reaches the caller this way.
 * This instead uses the SAME `resolveWriteParentDir` walk
 * `createFsWriteFileFn` and `createFsWriteProjectStateFn` (`./fs-project-
 * io.ts`) already call, so parent-directory resolution for a path that may
 * pass through a dangling symlink has exactly one formulation across every
 * writer in this package, never a second independently-reasoned one. */
export function createFsCopyBundleFn(): CopyBundleFn {
  return async function copyBundle(sourceRoot: string, destRoot: string, manifestName: string): Promise<void> {
    const source = bundlePath(sourceRoot, manifestName);
    const dest = bundlePath(destRoot, manifestName);
    assertPathWithinProjectRoot(destRoot, dest);
    // A scope component (or `dest` itself) that resolves outside the REAL
    // `.frontx/ai/` directory — a developer's own alias, not this
    // namespace's own ground — is refused BEFORE any reclaim or clearing
    // below ever runs against it; see `assertDestinationInsideAiNamespace`'s
    // own doc comment.
    assertDestinationInsideAiNamespace(destRoot, dest);
    // A non-directory standing at a scope component strictly between
    // `.frontx/ai/` and `dest` (`@scope` for a `@scope/pkg` manifest name)
    // must be cleared BEFORE `resolveWriteParentDir`/`mkdirSync` below ever
    // run against it — see `reclaimNonDirectoryAiAncestor`'s own doc comment
    // for why this is a reclaim, not a refusal.
    reclaimNonDirectoryAiAncestor(destRoot, dest);
    fs.mkdirSync(resolveWriteParentDir(dest), { recursive: true });
    clearBundleDestination(dest);
    fs.cpSync(source, dest, { recursive: true });
  };
}

/** Real `RemoveBundleFn` — removes the bundle folder recursively; a no-op
 * (never a throw) when it is already absent, matching every other adapter
 * in this codebase that treats "already gone" as success rather than an
 * error the caller has to guard against separately.
 *
 * Proven to stay inside `root`, symlinks resolved, before the removal — see
 * `createFsCopyBundleFn` above for why this check exists. */
export function createFsRemoveBundleFn(): RemoveBundleFn {
  return async function removeBundle(root: string, manifestName: string): Promise<void> {
    const dest = bundlePath(root, manifestName);
    assertPathWithinProjectRoot(root, dest);
    // Same alias refusal `createFsCopyBundleFn` above applies before ITS OWN
    // clear — `removeBundle`'s `fs.rmSync` below is exactly the same
    // destructive step `clearBundleDestination` performs, over the SAME
    // ground, so it needs the identical guard.
    assertDestinationInsideAiNamespace(root, dest);
    fs.rmSync(dest, { recursive: true, force: true });
  };
}
