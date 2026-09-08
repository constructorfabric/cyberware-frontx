// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
// @cpt-state:cpt-frontx-state-template-resolution-inventory-lifecycle:p1
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { InventoryState } from '../inventory/types';
import type { InventoryEntry, InventoryIndexPort } from '../inventory/types';
import { INVENTORY_STORE_ROOT_LABEL } from './fs-installed-content-path';
import {
  readFileIfRegular,
  resolvePathKind,
  resolveNearestExistingAncestor,
  isInside,
  PathContainmentError,
  NotRegularFileError,
} from './fs-project-io';

const INDEX_FILENAME = 'index.json';

// Real filesystem-backed metadata INDEX — satisfies the `InventoryIndexPort`
// seam the in-memory `InventoryIndex` also satisfies
// (packages/cli/src/inventory/InventoryIndex.ts), preserving its method
// contract exactly so `TemplateInventory`'s flow orchestration is unchanged
// when this adapter is injected in its place. Persists the tracked local
// inventory's metadata (name, source, ref, status) to a single index file
// under the inventory store root — the state-machine transitions
// (UNRESOLVED -> RESOLVED -> INSTALLED -> UPDATED) this index records are now
// realized on a real path rather than only in an in-memory `Map`.
export class FsInventoryIndex implements InventoryIndexPort {
  constructor(private readonly root: string) {}

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-index
  // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-installed
  record(entry: InventoryEntry): void {
    const entries = this.readAll();
    entries[entry.name] = entry;
    this.writeAll(entries);
  }
  // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-installed
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-index

  // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-lookup
  lookup(name: string): InventoryEntry | undefined {
    return this.readAll()[name];
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-lookup

  // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-index-update
  // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-updated
  update(name: string, patch: Partial<InventoryEntry>): void {
    const entries = this.readAll();
    const existing = entries[name];
    if (existing) {
      entries[name] = { ...existing, ...patch };
      this.writeAll(entries);
    }
  }
  // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-updated
  // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-index-update

  all(): InventoryEntry[] {
    return Object.values(this.readAll());
  }

  getState(name: string): InventoryState {
    const entry = this.readAll()[name];
    return entry?.status ?? InventoryState.UNRESOLVED;
  }

  toJSON(): string {
    return JSON.stringify(this.readAll(), null, 2);
  }

  private get indexPath(): string {
    return path.join(this.root, INDEX_FILENAME);
  }

  // `readFileIfRegular` (`./fs-project-io.ts`) is the SAME guard every other
  // read seam in this package now goes through: a plain `existsSync` +
  // `readFileSync` pair here — `existsSync` follows a symlink to decide
  // "does something answer at this path", and answers `true` for a FIFO
  // exactly as readily as for a real index file — used to reach an
  // unconditional `readFileSync`, which blocks forever on a FIFO with no
  // writer attached and hangs `list` (and every other command that touches
  // the local inventory) with no stdout, no stderr, and no exit. Reusing the
  // shared primitive rather than restating this check a fourth time is the
  // whole point: it is the one place this exact class of bug has already
  // been fixed, and fixing it again here independently is how it drifts.
  //
  // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-lookup-guard
  // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-lookup-guard-fail
  // Content this store itself wrote could still be unusable in two further
  // ways `readFileIfRegular` cannot see, because both are about what the
  // bytes SAY rather than what kind of filesystem entry holds them: the file
  // is a regular file but its content is not valid JSON (hand-edited, or
  // truncated by an interrupted write before this module's own atomic
  // rename existed), or it parses but is not the `Record<string,
  // InventoryEntry>` shape every caller here assumes — a stray `{"precious":
  // "..."}` used to reach `install`'s own nesting check
  // (`pathsNest(entry.name, ...)` in `TemplateInventory.ts`) with
  // `entry.name` silently `undefined`, crashing with a raw `TypeError` at the
  // CLI's top-level catch: exit 2, no `--json` envelope. Both are now refused
  // here, once, for every caller (`record`, `lookup`, `update`, `all`,
  // `getState`, `toJSON`) rather than left for whichever caller's own
  // downstream logic happens to dereference the bad shape first.
  private readAll(): Record<string, InventoryEntry> {
    const raw = readFileIfRegular(this.indexPath);
    if (raw === null || raw.trim() === '') return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new InvalidInventoryIndexError(this.indexPath, 'its content is not valid JSON');
    }
    return validateInventoryIndexShape(parsed, this.indexPath);
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-lookup-guard-fail
  // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-lookup-guard

  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-index-guard
  // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-index-guard-fail
  // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-index-guard
  // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-index-guard-fail
  // Shared by `record` (install, `inst-resolve-index`) and `update`
  // (`update-local`, `inst-bupd-index-update`) — both write through this one
  // method, so the guard lives here once rather than twice.
  //
  // Two facts are confirmed before anything is written, neither of which the
  // old bare `fs.mkdirSync` + `fs.writeFileSync` pair below ever checked:
  //
  // 1. `indexPath`, symlinks resolved, still resolves inside `this.root`. A
  //    symlink AT `index.json` pointing OUTSIDE the store is not ground this
  //    CLI owns — reusing `resolveNearestExistingAncestor`/`isInside`
  //    (`./fs-project-io.ts`) rather than a lexical `path.relative` check is
  //    what catches this: the escape is only visible once the link is
  //    actually followed. `PathContainmentError` is the SAME typed refusal
  //    `apply`/`seed`/`delete` already throw for an escaping project write,
  //    reused here rather than a second containment error invented for the
  //    inventory store, and it is already mapped to `INVALID_PATH` at the
  //    CLI's top-level catch.
  // 2. Whatever currently stands at `indexPath` — once containment is
  //    settled — is either absent or an ordinary regular file. The inventory
  //    store root IS ground this CLI owns, so a directory, FIFO, socket, or
  //    device standing there is never silently reclaimed by deleting it: read
  //    seams in this package already refuse exactly this set of shapes
  //    (`readFileIfRegular` above) rather than treat them as "nothing here",
  //    and the write side refuses them for the identical reason — a shape a
  //    read would refuse to open is not a shape a write should destroy either.
  //    `NotRegularFileError` is reused rather than a bespoke write-side type,
  //    since it is already mapped to `CONTENT_CONFLICT`.
  private assertIndexPathIsSafeToWrite(): void {
    const resolvedRoot = resolveNearestExistingAncestor(path.resolve(this.root));
    const resolvedIndex = resolveNearestExistingAncestor(path.resolve(this.indexPath));
    if (resolvedRoot === null || resolvedIndex === null || !isInside(resolvedRoot, resolvedIndex)) {
      throw new PathContainmentError(this.indexPath, this.root, INVENTORY_STORE_ROOT_LABEL);
    }
    const kind = resolvePathKind(this.indexPath);
    if (kind !== 'absent' && kind !== 'file') {
      throw new NotRegularFileError(this.indexPath, kind);
    }
  }
  // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-index-guard-fail
  // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-index-guard
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-index-guard-fail
  // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-index-guard

  // Writes through a temp file beside `index.json`, then `fs.renameSync`s it
  // into place — the SAME write-through-temp-file-then-rename discipline
  // `createFsWriteProjectStateFn` (`./fs-project-io.ts`) already uses for its
  // own single-document store. `fs.rename` replaces whatever directory entry
  // currently names `indexPath` outright — a regular file, or (once
  // `assertIndexPathIsSafeToWrite` above has confirmed containment) a
  // symlink resolving harmlessly inside the store — without ever opening
  // that entry for writing, so a concurrent reader never observes a
  // partially-written index, and there is no window in which `index.json`
  // is truncated.
  private writeAll(entries: Record<string, InventoryEntry>): void {
    this.assertIndexPathIsSafeToWrite();
    fs.mkdirSync(this.root, { recursive: true });
    const tempPath = path.join(this.root, `.${INDEX_FILENAME}.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(entries, null, 2), 'utf-8');
    fs.renameSync(tempPath, this.indexPath);
  }
}

/**
 * `index.json` was read as a regular file, but its content is not usable as
 * the local inventory index: either it is not valid JSON at all, or it
 * parses to something other than a `Record<string, InventoryEntry>`. Typed,
 * rather than a raw `JSON.parse` `SyntaxError` or a downstream `TypeError`
 * from a caller dereferencing a missing field, so the CLI's top-level catch
 * can report this as the same structured `CONTENT_CONFLICT` refusal every
 * other "the disk holds something this operation cannot work with" fact in
 * this package already reports, rather than an internal-error exit with no
 * `--json` envelope at all.
 */
export class InvalidInventoryIndexError extends Error {
  readonly filePath: string;

  constructor(filePath: string, reason: string) {
    super(`Local inventory index at "${filePath}" is not valid: ${reason}.`);
    this.name = 'InvalidInventoryIndexError';
    this.filePath = filePath;
  }
}

// The one non-empty-string field every entry must carry to be minimally
// usable by the callers who read `all()`/`lookup()` directly (`install`'s own
// `pathsNest(entry.name, ...)` nesting check, in particular) — `status` is
// deliberately NOT checked against the `InventoryState` enum here: a future
// state this reader predates should not turn an otherwise-valid entry into a
// hard refusal, and no caller in this package dereferences `status` without
// first defaulting an unrecognized value the way `getState` already does for
// a genuinely absent entry.
const REQUIRED_STRING_FIELDS: ReadonlyArray<keyof InventoryEntry> = ['name', 'source', 'ref', 'content'];

function validateInventoryIndexShape(parsed: unknown, filePath: string): Record<string, InventoryEntry> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidInventoryIndexError(filePath, 'it must be a JSON object mapping template name to entry');
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new InvalidInventoryIndexError(filePath, `the entry for "${key}" is not an object`);
    }
    const entry = value as Record<string, unknown>;
    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field] === '') {
        throw new InvalidInventoryIndexError(filePath, `the entry for "${key}" is missing a valid "${field}" field`);
      }
    }
  }
  return parsed as Record<string, InventoryEntry>;
}
