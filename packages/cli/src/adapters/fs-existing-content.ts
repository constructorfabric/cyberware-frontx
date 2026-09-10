// Real fs-backed seams for `../scaffold/existing-content.ts`
// (`cpt-frontx-algo-cli-scaffolding-existing-content`) — the two content
// readers that algorithm's pure logic depends on, matching every other
// adapter in this package's convention of one real adapter per injected
// seam type, kept in its own file since this concern (reading real file
// CONTENT, not just enumerating paths) is new: `adapters/fs-project-io.ts`'s
// `createFsListTargetFilesFn` and `adapters/fs-read-content-items.ts`'s
// `createFsReadContentItemsFn` each enumerate paths for a DIFFERENT
// existing purpose, neither returning the `{path, content}` pairs
// reconciliation needs to compare on-disk bytes against a template's
// payload.
//
// Deliberately simple, matching `adapters/fs-read-content-items.ts`'s own
// scope: a plain recursive `readdir`/`readFile` walk, no symlink-cycle
// handling (neither walk below ever descends INTO a symlinked directory, so
// there is no cycle to guard against). `readInstalledContent`'s
// installed-content-path enumeration mirrors that adapter's own walk exactly
// (a template's installed content is never a symlink farm) and, like it,
// still SKIPS a symlink dirent outright — that walk is unchanged by the fix
// below; `adapters/fs-project-io.ts`'s `createFsListPayloadFilesFn` is the
// sibling walker that resolves symlinks for a DIFFERENT algorithm (template
// content self-containment), and is not this one.
// `readExistingContent`'s target-directory walk intentionally applies NO
// skip list (no `node_modules` exclusion) for the identical reason
// `adapters/fs-project-io.ts`'s `createFsListTargetFilesFn` already gives for
// the delete-plan algorithm's own real-file enumeration: the six-term
// effective-ownership subtraction these seams feed
// (`scaffold/effective-ownership.ts`) names no such exclusion, and adding
// one here would silently add a seventh, undeclared term to that one
// shared formula.
//
// SYMLINK-INVISIBLE FIX: `readdirSync(..., { withFileTypes: true })` reports
// a symlink dirent as neither `isDirectory()` nor `isFile()`, so a symlink
// already standing at a TARGET path would otherwise be skipped by this walk
// exactly like the "fifo, socket, or device" entries it is written to
// ignore — leaving `readExistingContent` (this file's OTHER walk, feeding
// `reconcileExistingContent`'s "existing" side) blind to it: a declared
// payload path that a developer (or, one target over in the same batch, the
// pipeline itself) has already turned into a symlink aliasing a DIFFERENT
// on-disk file would look exactly like a brand-new path, and
// `commands/apply.ts` would materialize straight through it, following the
// link into the aliased file and overwriting content `--adopt-existing`
// promises to leave alone. `readExistingContent`'s walk below instead
// reports a symlink dirent as an OCCUPIED existing entry — never silently
// dropped — while still never descending into it (matching this walk's own
// "deliberately simple, no symlink-cycle handling" scope; the case this
// guards against is a symlinked FILE, not a symlinked directory).
// `readInstalledContent`'s walk keeps skipping a symlink outright: a
// TEMPLATE's own payload is a different data source entirely (never
// expected to contain one), and is not this fix's target.
import fs from 'node:fs';
import path from 'node:path';
import type { ContentItem } from '../scaffold/types';
import { SYMLINK_CONTENT_MARKER, DIRECTORY_CONTENT_MARKER, SPECIAL_CONTENT_MARKER } from '../scaffold/existing-content';
import type { ReadInstalledContentFn, ReadExistingContentFn } from '../scaffold/existing-content';
import { assertWithinRoot } from './fs-installed-content-path';
import { isInside } from './fs-project-io';

// Install-time output, never committed template content
// (`cpt-frontx-algo-template-manifest-validate-content-self-containment`'s own
// `inst-csc-enumerate-files`, which enumerates a payload "never descending into
// a `node_modules` directory").
const PAYLOAD_SKIP_DIR = 'node_modules';

// A symlink's on-disk "content" cannot be meaningfully compared against a
// payload's declared text content — matching the sibling upgrade engine's
// own precedent for the identical class of ground
// (`architecture/ADR/0021-project-upgrade-mechanism.md`: "A payload path
// where the disk holds a directory or a symlink instead of a regular file
// cannot be compared at all and refuses the same way, fail-closed, with
// CONTENT_CONFLICT."). Rather than attempt to read through a link that might
// alias another location entirely, resolve outside the project, or not
// resolve at all, `readExistingContent`'s walk below reports a symlink
// dirent as an EXISTING entry (occupying its path, so reconciliation never
// treats it as if nothing were there) carrying this fixed marker as its
// `content` — a value no legitimate template payload could ever author, so
// the entry can never land in `identicalFiles` and always forces the honest
// partition: `contentConflicts` when the payload declares this exact path,
// `additionalPaths` when it does not, for `--adopt-existing` to decide. The
// value is a CONSTANT (not e.g. a per-call random one) so that reading the
// same on-disk symlink twice — exactly what `commands/apply.ts`'s own
// adopted-path snapshot-then-reread verification does — reports it
// identically both times when nothing about that symlink actually changed.
//
// DIRECTORY-SYMLINK FIX: the marker's DEFINITION lives in
// `../scaffold/existing-content.ts`, imported from there rather than
// restated here — a value both this adapter (the writer of it) and that
// algorithm (now also a reader of it) have to agree on has exactly one
// honest home. A symlinked DIRECTORY anywhere above a payload path defeats
// reconciliation entirely: this walk never descends into a symlinked
// directory, so it never even reports an entry for a path beneath one — a
// gap distinct from, and worse than, the symlinked-FILE case this marker
// covers. Closing it requires `reconcileExistingContent` itself to
// recognize "a symlink stands here" as a fact about the RAW read, before
// its own ownership filter narrows things down — see that module's own doc
// comment on the constant for the full reasoning.

// `skipInstallOutput` distinguishes the two callers below, and the distinction
// is load-bearing rather than cosmetic:
//
//   - Reading a TEMPLATE's payload (`createFsReadInstalledContentFn`) must skip
//     `node_modules`, because the payload definition itself excludes it. This
//     repository's own `template-shell` is 428 MB across 32,813 files of which
//     529 are payload; reading all of it made `apply` copy install output into
//     the target, and made the resolver's own local-origin read exceed V8's
//     maximum string length when it encoded the folder as one bundle envelope.
//   - Walking a project TARGET (`createFsReadExistingContentFn`) must NOT skip
//     it: the six-term effective-ownership subtraction
//     (`../scaffold/effective-ownership.ts`) names no `node_modules` exclusion
//     for ground a template owns, and adding one would silently introduce an
//     undeclared seventh term — the exact reason
//     `createFsListTargetFilesFn`'s own comment gives for ITS empty skip set.
//
// `reportSymlinksAsExisting` is the SYMLINK-INVISIBLE FIX's own per-caller
// switch (this file's header comment) — `false` for `readInstalledContent`
// (a template's payload keeps skipping a symlink outright, unchanged), `true`
// for `readExistingContent` (a target's on-disk symlink is now reported,
// never silently dropped).
//
// One walk, two parameters, so no rule can drift apart into a second copy.
function listFilesRecursive(
  root: string,
  skipInstallOutput: boolean,
  reportSymlinksAsExisting: boolean,
  relativeDir = '',
): ContentItem[] {
  const absoluteDir = path.join(root, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const items: ContentItem[] = [];
  for (const entry of entries) {
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (skipInstallOutput && entry.name === PAYLOAD_SKIP_DIR) continue;
      // Reported at its OWN path, alongside — never instead of — recursing
      // into it: a directory is otherwise invisible to reconciliation at its
      // own path (the walk only ever reports what it finds INSIDE a
      // directory, never the directory itself), so a payload path the
      // template declares as a file, where disk instead holds a directory,
      // would read as "nothing here yet" and reach `commands/apply.ts`'s
      // own `writeFileFn`, which fails with a raw `EISDIR`. Only for the
      // EXISTING-content walk (`reportSymlinksAsExisting`): a template's own
      // installed content (`readInstalledContent`) has no such hazard to
      // guard against — every directory there is the template's own
      // structure, never a project target's.
      if (reportSymlinksAsExisting) {
        items.push({ path: relativePath, content: DIRECTORY_CONTENT_MARKER });
      }
      items.push(...listFilesRecursive(root, skipInstallOutput, reportSymlinksAsExisting, relativePath));
    } else if (entry.isFile()) {
      items.push({ path: relativePath, content: fs.readFileSync(path.join(root, relativePath), 'utf-8') });
    } else if (reportSymlinksAsExisting && entry.isSymbolicLink()) {
      // Reported, never resolved and never descended into — see this
      // constant's own doc comment for why an uncomparable marker, rather
      // than the link's real target content, is the honest thing to report.
      items.push({ path: relativePath, content: SYMLINK_CONTENT_MARKER });
    } else if (reportSymlinksAsExisting) {
      // Any other special entry (fifo, socket, device): reported with an
      // uncomparable marker rather than skipped, and NEVER read — a FIFO in
      // particular blocks forever on an `open()` for either direction when
      // no counterpart end is attached, and this walk must never attempt
      // one. Only for the EXISTING-content walk; `readInstalledContent`
      // below keeps skipping it outright, unchanged, matching
      // `fs-read-content-items.ts`'s identical scope for the identical
      // reason (a template's installed content is not expected to contain
      // one).
      items.push({ path: relativePath, content: SPECIAL_CONTENT_MARKER });
    }
    // `readInstalledContent` (`reportSymlinksAsExisting` false): a symlink,
    // a directory's own entry, and any other special entry are all silently
    // skipped here, exactly as before this fix — a template's own installed
    // content is a different data source this fix does not target.
  }
  return items;
}

/**
 * Real `ReadInstalledContentFn` — every real file reachable under a
 * template's installed content path, template-relative. The batch-staging
 * pipeline (`scaffold/assembler.ts`) always hands this an ABSOLUTE
 * `installedContentPath` (`scaffold/types.ts`'s `ContributionEntry` doc
 * comment states that as the one rule), so `repoRoot` here is not needed to
 * interpret it — this factory still accepts one, and still joins a relative
 * path against it with `path.join` leaving an already-absolute one untouched,
 * because `createFsReadInstalledContentFn` is also this package's public
 * export (`index.ts`) for callers outside the staged-assembly pipeline, who
 * are free to hand it a path relative to a repo root they supply themselves.
 *
 * `inventoryRoot`, when supplied, is the SAME local inventory store root
 * `FsContentStore`/`resolveInstalledContentPath` (`fs-content-store.ts`,
 * `fs-installed-content-path.ts`) already address — `cli.ts` passes it,
 * closed over from its own `inventoryRoot` (`createRealDeps`'s doc comment on
 * `resolveInstalledContentPathFn`), for every real caller. This is what lets
 * this function, unlike `fs-content-store.ts`'s own `read`/`has`, tell apart
 * the TWO shapes `installedContentPath` can be: a remote-origin template's
 * inventory-store address (`resolveInstalledContentPathFn` in `cli.ts`
 * computes it as exactly `path.join(inventoryRoot, name)`), or a local
 * `path:` origin's already-canonicalized folder inside the PROJECT
 * (`inst-resolve-local-path-check`) — a different boundary this function has
 * no business re-checking. Only the FIRST shape is checked here, against
 * `inventoryRoot`, reusing the SAME `assertWithinRoot` the store's own write
 * side already proves (`fs-content-store.ts`) rather than a second,
 * independently formulated check — this is what closes the gap a symlink
 * planted at an installed content path, after this reader's own caller
 * (`apply`) already resolved it, otherwise leaves open: reading straight
 * through the link and reporting whatever it aliases as this template's own
 * content.
 */
export function createFsReadInstalledContentFn(repoRoot: string, inventoryRoot?: string): ReadInstalledContentFn {
  return async function readInstalledContent(installedContentPath: string): Promise<ContentItem[]> {
    const absolute = path.isAbsolute(installedContentPath) ? installedContentPath : path.join(repoRoot, installedContentPath);
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-read-guard
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-read-guard-check
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-read-guard-fail
    if (inventoryRoot !== undefined && isInside(inventoryRoot, absolute)) {
      assertWithinRoot(inventoryRoot, absolute, 'read');
    }
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-read-guard-fail
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-read-guard-check
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-read-guard
    if (!fs.existsSync(absolute)) return [];
    // A TEMPLATE's payload: install output is not content. `false` here
    // keeps a symlink dirent skipped outright, unchanged by the
    // SYMLINK-INVISIBLE FIX above (this file's header comment) — a
    // template's own payload is not this fix's target.
    return listFilesRecursive(absolute, true, false);
  };
}

// The shallowest component of `target`'s own path — the project root
// excluded, `target` itself included — that exists on disk as something other
// than a directory, reported as the `ContentItem` occupying it, or `null` when
// every component is either an ordinary directory or does not exist yet.
//
// A non-directory here blocks everything beneath it: no file can be created
// under a regular file, and a symlink standing on the way cannot be compared
// against declared content (`architecture/ADR/0021-project-upgrade-
// mechanism.md`). Reporting the SHALLOWEST such component rather than the
// deepest is what makes the refusal actionable — it names the one entry a
// developer has to resolve, and nothing below it can be inspected anyway.
//
// `lstat`, not `stat`: a symlink standing on the path is itself the blocking
// entry, and dereferencing it would report on whatever it aliases instead.
// Its content is the same uncomparable marker the walk below uses for a
// symlink it finds inside the target, so one rule covers both positions.
//
// A component that is neither a directory, a symlink, nor a REGULAR file
// (`stat.isFile()`) — a FIFO, socket, or device — must never be read: this
// function used to fall through to `readFileSync` for anything that was not
// a directory or a symlink, which blocks forever on a FIFO with no writer
// attached, hanging the whole process with no stdout, no stderr, and no
// exit. It is reported with the same uncomparable marker the walk below uses
// for a special entry it finds inside the target, so the two positions (the
// target's own component, and one found while walking beneath it) refuse
// identically.
function blockingComponentOf(repoRoot: string, target: string): ContentItem | null {
  if (target === '.') return null; // the project root itself is the walk's own ground
  const segments = target.split('/');
  for (let depth = 1; depth <= segments.length; depth++) {
    const relativePath = segments.slice(0, depth).join('/');
    const absolute = path.join(repoRoot, relativePath);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      return null; // nothing exists from here down: an ordinary not-yet-created target
    }
    if (stat.isDirectory()) continue;
    if (stat.isSymbolicLink()) return { path: relativePath, content: SYMLINK_CONTENT_MARKER };
    if (stat.isFile()) return { path: relativePath, content: fs.readFileSync(absolute, 'utf-8') };
    return { path: relativePath, content: SPECIAL_CONTENT_MARKER };
  }
  return null;
}

/**
 * Real `ReadExistingContentFn` — every real file already on disk under a
 * project-relative `target` (which may legitimately be `.`, the project
 * root), project-relative. Resolves to `[]`, never a throw, when nothing
 * exists at `target` yet — the ordinary case for a fresh target
 * materialization is about to create.
 */
export function createFsReadExistingContentFn(repoRoot: string): ReadExistingContentFn {
  return async function readExistingContent(target: string): Promise<ContentItem[]> {
    const absolute = path.join(repoRoot, target);
    // A component of `target`'s own path, at or above it, may be occupied by
    // something that is not a directory. Canonicalization
    // (`createFsCanonicalizeTargetFn`, `./fs-project-io.ts`) proves `target`
    // resolves inside the project root and resolves every symlink along the
    // way, but it never asserts that each component IS a directory, so a
    // regular file introduced since registration survives it untouched.
    // Nothing can be created beneath such a component, so reporting it here —
    // at its own project-relative path, as the entry that occupies it — is
    // what lets reconciliation refuse the payload paths beneath it by name
    // (`scaffold/existing-content.ts`'s `findBadAncestorComponent`) instead of
    // letting the write reach the filesystem and come back as a bare `ENOTDIR`
    // the pipeline can only report as an internal failure.
    const blocked = blockingComponentOf(repoRoot, target);
    if (blocked !== null) return [blocked];
    if (!fs.existsSync(absolute)) return [];
    // `target` itself is the walk's root, so items come back template-root-
    // relative already; re-root them under `target` here (never `.`, the
    // spelling `path.join('.', 'x')` avoids anyway) so a caller comparing
    // against a payload's own project-relative path set — which never
    // spells the "." prefix either (`joinUnderTarget`,
    // `../paths/relative-path.ts`) — compares like for like.
    // A project TARGET: no skip list, per the six-term subtraction. `true`
    // here is the SYMLINK-INVISIBLE FIX itself (this file's header comment)
    // — a symlink already on disk under this target is reported as an
    // existing entry rather than silently skipped.
    const items = listFilesRecursive(absolute, false, true);
    if (target === '.') return items;
    return items.map((item) => ({ ...item, path: `${target}/${item.path}` }));
  };
}
