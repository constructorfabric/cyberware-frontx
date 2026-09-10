// @cpt-state:cpt-frontx-state-template-resolution-inventory-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-install-by-spec:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-list-inventory:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-bounded-local-update:p1

import type { ErrorCode } from '../envelope';

// @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-resolved

export enum InventoryState {
  UNRESOLVED = 'UNRESOLVED',
  RESOLVED = 'RESOLVED',
  INSTALLED = 'INSTALLED',
  UPDATED = 'UPDATED',
}
// @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-resolved

export interface InventoryEntry {
  name: string;
  source: string;
  ref: string;
  status: InventoryState;
  content: string;
}

export interface InventoryError {
  message: string;
  /**
   * The dictionary code the underlying failure reported, when it reported one
   * (`cpt-frontx-adr-uniform-cli-json-envelope`'s vocabulary). Optional
   * because not every inventory failure originates from a coded one — a
   * source-spec that will not parse is refused here, not by a resolver.
   *
   * It exists because dropping it silently downgraded a refusal: the resolver
   * refuses a legacy manifest with `INVALID_MANIFEST`, this boundary
   * flattened the error to its message alone, and `register` — having never
   * received a code — fell back to `ORIGIN_UNAVAILABLE`, telling a caller the
   * origin was unreachable when in fact it was reached and its manifest
   * refused. The local `path:` branch propagated the code correctly the whole
   * time, so the two halves of one command disagreed about the same failure.
   */
  code?: ErrorCode;
}

export type InventoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: InventoryError };

// Port contracts the CONTENT store and metadata INDEX satisfy — the injection
// site `TemplateInventory` depends on these shapes, not on the concrete
// in-memory `InventoryStore`/`InventoryIndex` classes, so a real fs-backed
// adapter (packages/cli/src/adapters/fs-*.ts) can be substituted without any
// change to flow orchestration (Dependency Inversion; adapters implement the
// port, IO stays out of pure logic).
export interface ContentStorePort {
  write(name: string, content: string): void;
  replace(name: string, content: string): void;
  read(name: string): string | undefined;
  has(name: string): boolean;
}

export interface InventoryIndexPort {
  record(entry: InventoryEntry): void;
  lookup(name: string): InventoryEntry | undefined;
  update(name: string, patch: Partial<InventoryEntry>): void;
  all(): InventoryEntry[];
  getState(name: string): InventoryState;
  toJSON(): string;
}
