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
import { SYMLINK_CONTENT_MARKER } from '../scaffold/existing-content';
import type { ReadInstalledContentFn, ReadExistingContentFn } from '../scaffold/existing-content';

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
      items.push(...listFilesRecursive(root, skipInstallOutput, reportSymlinksAsExisting, relativePath));
    } else if (entry.isFile()) {
      items.push({ path: relativePath, content: fs.readFileSync(path.join(root, relativePath), 'utf-8') });
    } else if (reportSymlinksAsExisting && entry.isSymbolicLink()) {
      // Reported, never resolved and never descended into — see this
      // constant's own doc comment for why an uncomparable marker, rather
      // than the link's real target content, is the honest thing to report.
      items.push({ path: relativePath, content: SYMLINK_CONTENT_MARKER });
    }
    // Any other special entry (fifo, socket, device), or — when
    // `reportSymlinksAsExisting` is false — a symlink, is neither a
    // directory nor a file by `withFileTypes`'s own report and is skipped,
    // matching `fs-read-content-items.ts`'s identical scope for the
    // identical reason (a template's installed content is not expected to
    // be a symlink farm).
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
 */
export function createFsReadInstalledContentFn(repoRoot: string): ReadInstalledContentFn {
  return async function readInstalledContent(installedContentPath: string): Promise<ContentItem[]> {
    const absolute = path.isAbsolute(installedContentPath) ? installedContentPath : path.join(repoRoot, installedContentPath);
    if (!fs.existsSync(absolute)) return [];
    // A TEMPLATE's payload: install output is not content. `false` here
    // keeps a symlink dirent skipped outright, unchanged by the
    // SYMLINK-INVISIBLE FIX above (this file's header comment) — a
    // template's own payload is not this fix's target.
    return listFilesRecursive(absolute, true, false);
  };
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
