// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
// @cpt-state:cpt-frontx-state-template-resolution-inventory-lifecycle:p1
import fs from 'node:fs';
import path from 'node:path';
import { InventoryState } from '../inventory/types';
import type { InventoryEntry, InventoryIndexPort } from '../inventory/types';
import { readFileIfRegular } from './fs-project-io';

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
  private readAll(): Record<string, InventoryEntry> {
    const raw = readFileIfRegular(this.indexPath);
    if (raw === null || raw.trim() === '') return {};
    return JSON.parse(raw) as Record<string, InventoryEntry>;
  }

  private writeAll(entries: Record<string, InventoryEntry>): void {
    fs.mkdirSync(this.root, { recursive: true });
    fs.writeFileSync(this.indexPath, JSON.stringify(entries, null, 2), 'utf-8');
  }
}
