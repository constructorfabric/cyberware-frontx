// @cpt-flow:cpt-frontx-flow-template-resolution-install:p1
// @cpt-flow:cpt-frontx-flow-template-resolution-list:p1
// @cpt-flow:cpt-frontx-flow-template-resolution-update-local:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-install-by-spec:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-list-inventory:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-bounded-local-update:p1
import { pathsNest } from '../paths/relative-path';
import { formatTemplateAddress, parseSourceSpec } from '../spec-parser/parse';
import type { StructuredRef } from '../spec-parser/types';
import { resolveToInventory } from '../resolver/resolve';
import type { FetchFn } from '../resolver/types';
import { InventoryIndex } from './InventoryIndex';
import { InventoryStore } from './InventoryStore';
import { InventoryState } from './types';
import type { ContentStorePort, InventoryEntry, InventoryIndexPort, InventoryResult } from './types';

// The index/store are injected as ports (Dependency Inversion) rather than
// hardcoded to the in-memory classes — the injection site this FEATURE's
// fs adapters (packages/cli/src/adapters/fs-*.ts) plug into. Defaults
// preserve today's in-memory behavior unchanged; a real fs-backed root
// (e.g. `new TemplateInventory(new FsInventoryIndex(root), new FsContentStore(root))`)
// materializes the same flows to disk without touching this orchestration.
export class TemplateInventory {
  constructor(
    private readonly index: InventoryIndexPort = new InventoryIndex(),
    private readonly store: ContentStorePort = new InventoryStore(),
  ) {}

  // --- install ---

  async install(
    spec: string,
    fetchFn: FetchFn,
  ): Promise<InventoryResult<{ name: string; ref: string }>> {
    // @cpt-begin:cpt-frontx-flow-template-resolution-install:p1:inst-install-invoke
    // entry: install command invoked with spec
    // @cpt-end:cpt-frontx-flow-template-resolution-install:p1:inst-install-invoke

    // @cpt-begin:cpt-frontx-flow-template-resolution-install:p1:inst-install-parse
    const parseResult = parseSourceSpec(spec);
    // @cpt-end:cpt-frontx-flow-template-resolution-install:p1:inst-install-parse

    // @cpt-begin:cpt-frontx-flow-template-resolution-install:p1:inst-install-parse-check
    if (!parseResult.ok) {
      // @cpt-begin:cpt-frontx-flow-template-resolution-install:p1:inst-install-parse-reject
      // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-parse-fail-loop
      return { ok: false, error: { code: 'INVALID_INPUT', message: parseResult.error.message } };
      // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-parse-fail-loop
      // @cpt-end:cpt-frontx-flow-template-resolution-install:p1:inst-install-parse-reject
    }
    // @cpt-end:cpt-frontx-flow-template-resolution-install:p1:inst-install-parse-check

    // @cpt-begin:cpt-frontx-flow-template-resolution-install:p1:inst-install-resolve
    // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-resolved
    const resolveResult = await resolveToInventory({ kind: 'remote', ref: parseResult.value }, { fetchFn });
    // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-resolved
    // @cpt-end:cpt-frontx-flow-template-resolution-install:p1:inst-install-resolve

    // @cpt-begin:cpt-frontx-flow-template-resolution-install:p1:inst-install-fetch
    // @cpt-begin:cpt-frontx-flow-template-resolution-install:p1:inst-install-reach-check
    if (!resolveResult.ok) {
      // @cpt-begin:cpt-frontx-flow-template-resolution-install:p1:inst-install-reach-fail
      // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-fetch-fail-loop
      return { ok: false, error: { message: resolveResult.error.message, code: resolveResult.error.code } };
      // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-fetch-fail-loop
      // @cpt-end:cpt-frontx-flow-template-resolution-install:p1:inst-install-reach-fail
    }
    // @cpt-end:cpt-frontx-flow-template-resolution-install:p1:inst-install-reach-check
    // @cpt-end:cpt-frontx-flow-template-resolution-install:p1:inst-install-fetch

    const record = resolveResult.value;

    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-collision-check
    // Two templates declaring one identity must not be merged. `FsContentStore.write`
    // writes each file through without clearing the content path first, so the
    // second install would overwrite the matching paths and leave the rest of the
    // occupant's files in place, while the index entry is replaced wholesale —
    // one template listed, a mixture of two on disk, no signal to the developer.
    //
    // The comparison is on the template address rather than the whole source-spec:
    // two specs differing only in `@ref` name one template at two versions, and
    // refusing that would turn a version bump into a collision while leaving the
    // genuine clobber unguarded.
    const occupant = this.index.lookup(record.name);
    const sameTemplate = occupant !== undefined && addressesSameTemplate(occupant.source, parseResult.value);
    // An identity that nests with an installed one is refused even though the
    // two are different keys, because they are not different directories.
    const nesting = this.index
      .all()
      .find((entry) => entry.name !== record.name && pathsNest(entry.name, record.name));

    if (occupant !== undefined && !sameTemplate) {
      // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-collision-fail
      // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
      return {
        ok: false,
        error: {
          code: 'REGISTRATION_CONFLICT',
          message:
            `Template identity "${record.name}" is already installed from "${occupant.source}", ` +
            `so "${record.source}" was not installed. Run "frontx update-local ${record.name} ${record.source}" ` +
            'to point the installed entry at this source instead.',
        },
      };
      // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-reject-loop
      // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-collision-fail
    }

    if (nesting !== undefined) {
      // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-collision-fail
      return {
        ok: false,
        error: {
          code: 'REGISTRATION_CONFLICT',
          message:
            `Template identity "${record.name}" would be materialized inside the content path of the ` +
            `installed template "${nesting.name}", or the other way round, so "${record.source}" was not ` +
            'installed: a bounded update of either would clear the other from disk.',
        },
      };
      // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-collision-fail
    }
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-collision-check

    // @cpt-begin:cpt-frontx-flow-template-resolution-install:p1:inst-install-materialize
    // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-installed
    // Re-installing the same template — a newer ref at the same address — must
    // clear the content path first, or a file the new version dropped survives
    // on disk. Only a first install can write through.
    if (sameTemplate) {
      this.store.replace(record.name, record.content);
    } else {
      this.store.write(record.name, record.content);
    }
    const entry: InventoryEntry = {
      name: record.name,
      source: record.source,
      ref: record.ref,
      status: InventoryState.INSTALLED,
      content: record.content,
    };
    this.index.record(entry);
    // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-installed
    // @cpt-end:cpt-frontx-flow-template-resolution-install:p1:inst-install-materialize

    // @cpt-begin:cpt-frontx-flow-template-resolution-install:p1:inst-install-success
    return { ok: true, value: { name: record.name, ref: record.ref } };
    // @cpt-end:cpt-frontx-flow-template-resolution-install:p1:inst-install-success
  }

  // --- list ---

  async list(): Promise<InventoryEntry[]> {
    // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-invoke
    // entry: list command invoked
    // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-invoke

    // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-read
    const entries = this.index.all();
    // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-read

    // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-empty-check
    if (entries.length === 0) {
      // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-empty-return
      return [];
      // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-empty-return
    }
    // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-empty-check

    // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-format
    // entries already contain name and ref for formatting
    // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-format

    // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-return
    return entries;
    // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-return
  }

  // --- update-local ---

  async updateLocal(
    name: string,
    spec: string,
    fetchFn: FetchFn,
  ): Promise<InventoryResult<{ name: string; ref: string }>> {
    // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-invoke
    // entry: update-local command invoked
    // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-invoke

    // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-lookup
    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-lookup
    const existing = this.index.lookup(name);
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-lookup
    // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-lookup

    // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-notfound-check
    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-absent-check
    if (!existing) {
      // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-notfound
      // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-absent-fail
      return {
        ok: false,
        error: {
          code: 'TEMPLATE_NOT_REGISTERED',
          message: `Template not found in local inventory: "${name}". Install it first with the install command.`,
        },
      };
      // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-absent-fail
      // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-notfound
    }
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-absent-check
    // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-notfound-check

    // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-parse
    const parseResult = parseSourceSpec(spec);
    // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-parse

    // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-parse-check
    if (!parseResult.ok) {
      // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-parse-reject
      return { ok: false, error: { code: 'INVALID_INPUT', message: parseResult.error.message } };
      // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-parse-reject
    }
    // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-parse-check

    // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-fetch
    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-fetch
    const resolveResult = await resolveToInventory({ kind: 'remote', ref: parseResult.value }, { fetchFn });
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-fetch
    // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-fetch

    // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-reach-check
    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-fetch-fail-check
    if (!resolveResult.ok) {
      // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-reach-fail
      // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-fetch-fail
      return { ok: false, error: { message: resolveResult.error.message, code: resolveResult.error.code } };
      // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-fetch-fail
      // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-reach-fail
    }
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-fetch-fail-check
    // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-reach-check

    const record = resolveResult.value;

    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-identity-mismatch
    // A bounded update takes a new source-spec for an existing entry, and a
    // source-spec can now address a subtree, so a caller can point an entry at
    // a different template of the same repository. `FsContentStore.replace` clears
    // the content path before writing, so proceeding would substitute one template
    // for another under the entry's identity, with no acquisition-level failure to
    // notice. Here the declared identity settles whether the two are one template;
    // the install guard above settles the same question from the reference.
    if (record.name !== existing.name) {
      // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-identity-mismatch-fail
      return {
        ok: false,
        error: {
          code: 'REGISTRATION_CONFLICT',
          message:
            `Source-spec "${record.source}" resolves to the template "${record.name}", ` +
            `not to "${existing.name}", so the installed template was left unchanged. ` +
            'Install the other template instead of updating this entry.',
        },
      };
      // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-identity-mismatch-fail
    }
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-identity-mismatch

    // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-write
    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-replace
    this.store.replace(existing.name, record.content);
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-replace
    // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-write

    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-index-update
    // @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-updated
    this.index.update(existing.name, {
      ref: record.ref,
      source: record.source,
      content: record.content,
      status: InventoryState.UPDATED,
    });
    // @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-updated
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-index-update

    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-boundary-confirm
    // Boundary invariant: only paths within this.store and this.index were written.
    // No filesystem paths outside the in-memory inventory store are touched.
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-boundary-confirm

    // @cpt-begin:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-success
    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-return
    return { ok: true, value: { name: existing.name, ref: record.ref } };
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-return
    // @cpt-end:cpt-frontx-flow-template-resolution-update-local:p1:inst-update-success
  }

  // --- lookup (shared resolver access for scaffolding) ---

  lookup(name: string): InventoryEntry | undefined {
    return this.index.lookup(name);
  }

  // --- state machine query ---

  // @cpt-state:cpt-frontx-state-template-resolution-inventory-lifecycle:p1
  getState(name: string): InventoryState {
    return this.index.getState(name);
  }
}

// Whether an already-recorded source-spec names the same template as the
// reference now being installed, comparing addresses so that a version bump is
// not mistaken for a second template. A recorded spec that no longer parses
// belongs to an older grammar; it is treated as a different template so the
// install refuses loudly rather than writing over content whose origin cannot
// be established.
function addressesSameTemplate(recordedSpec: string, requested: StructuredRef): boolean {
  const recorded = parseSourceSpec(recordedSpec);
  if (!recorded.ok) return false;
  return formatTemplateAddress(recorded.value) === formatTemplateAddress(requested);
}
