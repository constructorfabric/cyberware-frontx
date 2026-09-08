// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLE_MARKER } from '../bundle/envelope';
import { MANIFEST_FILENAME } from '../manifest/types';
import type { ContentStorePort } from '../inventory/types';
import { assertWithinRoot, resolveInstalledContentPath } from './fs-installed-content-path';
import { firstNonDirectoryComponentOf, UnreachablePathError } from './fs-project-io';

// Real filesystem CONTENT store — satisfies the `ContentStorePort` seam the
// in-memory `InventoryStore` also satisfies (packages/cli/src/inventory/InventoryStore.ts),
// so `TemplateInventory`'s flow orchestration is unchanged when this adapter
// is injected in its place. Materializes the fetched template content as the
// template's ACTUAL on-disk files under the installed content path — never
// as a single opaque manifest blob held only in memory.
//
// Content shape: the resolver seam (`FetchFn`) returns one opaque string per
// the FEATURE's current resolver contract (network fetch is Phase 10's
// concern, out of scope here). Two shapes are supported so this adapter is
// forward-compatible with a real multi-file fetch without any further change
// to its write contract:
//   - a JSON object mapping relative file path -> file text ("bundle" shape)
//     is materialized as that many real files under the installed content
//     path (the template's actual files together with its manifest);
//   - any other string is materialized as the template's manifest file
//     (`MANIFEST_FILENAME`) at the installed content path root — the one
//     real on-disk file the CLI can derive from today's resolver output.
export class FsContentStore implements ContentStorePort {
  constructor(private readonly root: string) {}

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-write
  write(name: string, content: string): void {
    const installedPath = resolveInstalledContentPath(this.root, name);
    assertWithinRoot(this.root, installedPath);
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-write-guard
    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-write-guard-fail
    assertPathReachableAsDirectory(installedPath);
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-write-guard-fail
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-write-guard
    fs.mkdirSync(installedPath, { recursive: true });
    writeBundle(this.root, installedPath, content);
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-write

  // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-replace
  replace(name: string, content: string): void {
    const installedPath = resolveInstalledContentPath(this.root, name);
    assertWithinRoot(this.root, installedPath);
    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-replace-guard
    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-replace-guard-fail
    assertPathReachableAsDirectory(installedPath);
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-replace-guard-fail
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-replace-guard
    // Replace is a full materialization: remove any previously materialized
    // files for this template before writing the newly fetched content, so
    // a file dropped from the new content does not linger on disk.
    //
    // `installedPath` has already been proven, by `assertWithinRoot` above,
    // to resolve inside `this.root` even when it is itself a symlink — so
    // when it IS a symlink, `fs.rmSync` here removes only that symlink's own
    // directory entry (`rm -rf` semantics: a symlink is never dereferenced
    // for removal, only `unlink`ed), never the directory it points at. The
    // outside-the-root case that would matter is exactly what `assertWithinRoot`
    // already refused above, before this line is ever reached.
    if (fs.existsSync(installedPath)) {
      fs.rmSync(installedPath, { recursive: true, force: true });
    }
    fs.mkdirSync(installedPath, { recursive: true });
    writeBundle(this.root, installedPath, content);
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-replace

  read(name: string): string | undefined {
    const installedPath = resolveInstalledContentPath(this.root, name);
    if (!fs.existsSync(installedPath)) return undefined;
    return readBundle(installedPath);
  }

  has(name: string): boolean {
    const installedPath = resolveInstalledContentPath(this.root, name);
    return fs.existsSync(installedPath) && fs.readdirSync(installedPath).length > 0;
  }
}

// A regular file (or any other non-directory entry) standing where an
// installed content path's own ancestor directory belongs — e.g. a scoped
// name `@x/inv` whose `@x` segment is a plain file rather than a directory —
// used to reach `fs.mkdirSync(installedPath, { recursive: true })` unguarded,
// which fails with a bare `ENOTDIR` no caller here catches: the CLI's
// top-level catch has nothing typed to match, so it falls through to a raw
// internal-error exit with no `--json` envelope at all. `firstNonDirectoryComponentOf`
// (`./fs-project-io.ts`) is the SAME primitive `createFsListTargetFilesFn`
// already uses to name this exact shape for an applied project target,
// reused here rather than a second, independently written ancestor walk.
// `UnreachablePathError` is likewise reused — it is already mapped to
// `CONTENT_CONFLICT` at the CLI's top-level catch — rather than inventing a
// bespoke type for a fact that is, from a caller's vantage, identical: a
// path could not be reached because something other than a directory blocks
// the way.
function assertPathReachableAsDirectory(installedPath: string): void {
  const blocking = firstNonDirectoryComponentOf(installedPath);
  if (blocking !== null) {
    throw new UnreachablePathError(installedPath, blocking);
  }
}

// A "bundle" is an explicit envelope — `{ [BUNDLE_MARKER]: { <relative
// path>: <file text>, ... } }` — distinguishing a multi-file bundle from an
// ordinary manifest JSON string (which may itself be a JSON object with
// string-valued fields and would otherwise be indistinguishable from a
// one-entry file map by shape alone). Anything else (a plain manifest
// string, unparseable input, JSON without the marker) is not a bundle.
function parseBundle(content: string): Record<string, string> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const filesValue = (parsed as Record<string, unknown>)[BUNDLE_MARKER];
  if (typeof filesValue !== 'object' || filesValue === null || Array.isArray(filesValue)) return undefined;
  const obj = filesValue as Record<string, unknown>;
  const entries = Object.entries(obj);
  if (entries.length === 0) return undefined;
  if (!entries.every(([, value]) => typeof value === 'string')) return undefined;
  return obj as Record<string, string>;
}

function writeBundle(root: string, installedPath: string, content: string): void {
  const bundle = parseBundle(content);
  if (!bundle) {
    // Fallback: the only known real file is the manifest itself.
    const manifestPath = path.join(installedPath, MANIFEST_FILENAME);
    assertWithinRoot(root, manifestPath);
    fs.writeFileSync(manifestPath, content, 'utf-8');
    return;
  }
  for (const [relativePath, fileContent] of Object.entries(bundle)) {
    const filePath = path.join(installedPath, relativePath);
    assertWithinRoot(root, filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fileContent, 'utf-8');
  }
}

// Reconstructs the canonical content string for a materialized template:
// a single-file manifest-only install round-trips to that file's raw text
// (matching the pre-fs in-memory contract exactly); multiple files round-trip
// to the sorted-key bundle JSON that produced them.
function readBundle(installedPath: string): string {
  const files = listFilesRecursive(installedPath);
  if (files.length === 1 && files[0] === MANIFEST_FILENAME) {
    return fs.readFileSync(path.join(installedPath, files[0]), 'utf-8');
  }
  const bundle: Record<string, string> = {};
  for (const relativePath of files.sort()) {
    bundle[relativePath] = fs.readFileSync(path.join(installedPath, relativePath), 'utf-8');
  }
  return JSON.stringify({ [BUNDLE_MARKER]: bundle });
}

function listFilesRecursive(root: string, relativeDir = ''): string[] {
  const absoluteDir = path.join(root, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    // POSIX separator, per the envelope's key contract (bundle/envelope.ts):
    // `path.join` would make the round trip promised above lossy on Windows,
    // handing back `src\index.ts` for a key written as `src/index.ts`.
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}
