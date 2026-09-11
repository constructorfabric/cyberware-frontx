// @cpt-algo:cpt-frontx-algo-upgrade-changeset-apply:p1
// @cpt-dod:cpt-frontx-dod-upgrade-changeset-apply:p1
import { provenancePath } from '../provenance/contract';
import { describeInvalidRecord, describeNonArrayPayload, isValidProvenanceRecord } from '../provenance/validate';
import { locateRegionSpan } from '../scaffold/compose-shared-files';
import type {
  ChangeSet,
  ProjectSnapshot,
  ProvenanceRecord,
  ReadProjectFileFn,
  WriteProjectFileFn,
  RemoveProjectFileFn,
  WriteProvenanceFn,
} from './types';

export type ApplyResult =
  | { ok: true; snapshot: ProjectSnapshot }
  | { ok: false; message: string };

// Parses and validates the provenance SET shape (ADR-0019: one record per
// applied template, never a single whole-repository record) against the raw
// string `deps.readProjectFile` returns, using the shape guards shared with
// `readProvenanceRecords` (adapters/provenance-io.ts) via `provenance/validate.ts`
// — this pure-logic upgrade engine takes its filesystem access only through
// injected deps (never through the adapters layer directly), but the guards
// themselves are pure functions over `unknown` with no filesystem access, so
// both callers import the same neutral module rather than one importing the
// other's file. Guards each ELEMENT of the array too (review #500 round 2,
// P2-1): `Array.isArray` alone let a malformed element (e.g. `[null]`, or an
// object missing `templateIdentity`) through uncast, and the very next line —
// `existingRecords.findIndex(record => record.templateIdentity === ...)` —
// either threw a raw TypeError that escaped `ApplyResult`'s
// `{ok:true}|{ok:false}` contract, or silently misdiagnosed the malformed
// element as "record not found". The message text assembled below (unlike
// the shape guards) is NOT shared with adapters/provenance-io.ts's own
// message — that caller's text additionally suggests restoring from version
// control, which does not apply to this in-memory apply path — so each
// caller keeps composing its own full message around the shared fragments.
function parseProvenanceRecordSet(raw: string | null, provPath: string): ProvenanceRecord[] {
  if (raw === null || raw.trim() === '') return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Provenance file at "${provPath}" must contain a JSON array of records (one per applied ` +
        `template), but found ${describeNonArrayPayload(parsed)}.`,
    );
  }
  const records: ProvenanceRecord[] = [];
  for (const [index, item] of parsed.entries()) {
    if (!isValidProvenanceRecord(item)) {
      throw new Error(
        `Provenance file at "${provPath}" contains an invalid record at index ${index}: ` +
          `${describeInvalidRecord(item)}.`,
      );
    }
    records.push(item);
  }
  return records;
}

// Rewrites ONLY the template's own marker-delimited region within a
// `region-union` shared file's current content, leaving every other byte —
// including every co-owning template's region — untouched. `newBlock`
// undefined removes the region entirely (region-scoped 'remove'); a region
// absent on disk (first-time 'add') is appended rather than dropped, since
// there is no existing span to splice into.
function replaceOwnedRegion(
  currentContent: string,
  templateIdentity: string,
  regionKey: string,
  newBlock: string | undefined,
): string {
  const span = locateRegionSpan(currentContent, templateIdentity, regionKey);
  if (!span) {
    if (newBlock === undefined) return currentContent;
    return currentContent.length > 0 ? `${currentContent}\n${newBlock}` : newBlock;
  }
  const lines = currentContent.split('\n');
  const before = lines.slice(0, span.beginIndex);
  const after = lines.slice(span.endIndex + 1);
  const replacement = newBlock !== undefined ? newBlock.split('\n') : [];
  return [...before, ...replacement, ...after].join('\n');
}

// @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-snapshot
export async function applyChangeSet(
  changeSet: ChangeSet,
  projectRoot: string,
  currentProvenance: ProvenanceRecord,
  deps: {
    readProjectFile: ReadProjectFileFn;
    writeProjectFile: WriteProjectFileFn;
    removeProjectFile: RemoveProjectFileFn;
    writeProvenance: WriteProvenanceFn;
  },
): Promise<ApplyResult> {
  // Capture pre-upgrade snapshot of all affected files so rollback can restore exact state
  const snapshot: ProjectSnapshot = { files: new Map() };
  const provPath = provenancePath(projectRoot);

  // Snapshot the provenance file
  const provContent = await deps.readProjectFile(provPath);
  snapshot.files.set(provPath, provContent);

  // Snapshot all files affected by clean entries (once per distinct path — a
  // region-scoped shared file may have several clean entries for the same path).
  const snapshottedPaths = new Set<string>();
  for (const entry of changeSet.clean) {
    const absolutePath = `${projectRoot}/${entry.path}`;
    if (snapshottedPaths.has(absolutePath)) continue;
    snapshottedPaths.add(absolutePath);
    const existingContent = await deps.readProjectFile(absolutePath);
    snapshot.files.set(absolutePath, existingContent);
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-snapshot

  // Validate the provenance SET, and locate the record this upgrade targets,
  // BEFORE any project file is touched — not after, inside the later
  // provenance-write step. A malformed provenance file or a missing target
  // record is a precondition failure, not an apply-time failure: caught here,
  // nothing has been written yet, so `{ok:false}` is returned directly, per
  // ApplyResult's contract, with the project untouched — never a thrown
  // error surfacing after entries have already been rewritten on disk with
  // no way back (`inst-app-restore-on-error`'s restore only covers the
  // `try` block below, not a failure ahead of it).
  let existingRecords: ProvenanceRecord[];
  try {
    existingRecords = parseProvenanceRecordSet(provContent, provPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Apply aborted before any file was written: ${message}` };
  }
  const targetIndex = existingRecords.findIndex(
    (record) => record.templateIdentity === currentProvenance.templateIdentity,
  );
  if (targetIndex === -1) {
    // The record this upgrade was computed against (moments earlier, in
    // `computeChangeSet`) is not in the set read back here — an inconsistent
    // precondition, not a recoverable-after-the-fact error. Abort now rather
    // than silently appending a possibly-duplicate record or dropping the
    // version bump once entries are already on disk.
    return {
      ok: false,
      message:
        `Apply aborted before any file was written: provenance record for ` +
        `"${currentProvenance.templateIdentity}" was not found in "${provPath}", though it was present ` +
        'when this upgrade was computed.',
    };
  }

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-try
  try {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-for-each-entry
    for (const entry of changeSet.clean) {
      const absolutePath = `${projectRoot}/${entry.path}`;
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-apply-entry
      if (entry.regionKey !== undefined) {
        // `region-union` shared file — rewrite ONLY this template's own
        // marker-delimited region in place; every co-owning template's
        // region in the same file is left byte-for-byte untouched.
        const currentContent = (await deps.readProjectFile(absolutePath)) ?? '';
        const newBlock = entry.kind === 'remove' ? undefined : entry.content;
        const updatedContent = replaceOwnedRegion(
          currentContent,
          changeSet.templateIdentity,
          entry.regionKey,
          newBlock,
        );
        await deps.writeProjectFile(absolutePath, updatedContent);
      } else if (entry.kind === 'remove') {
        // Exclusive subtree — write or remove the WHOLE file.
        await deps.removeProjectFile(absolutePath);
      } else {
        await deps.writeProjectFile(absolutePath, entry.content!);
      }
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-apply-entry
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-for-each-entry

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-update-prov
    // Provenance is a SET — one record per applied template (ADR-0019) — never
    // a single whole-repository record. `existingRecords`/`targetIndex` were
    // validated above, before any file was written (see the precondition
    // block for why validation stays outside this `try`). Only the record for
    // the template this upgrade targets changes; every other applied
    // template's record is re-serialized untouched (ADR-0021 Confirmation
    // (d): "the other applied template and its provenance record are
    // unaffected").
    //
    // Invariant: the `writeProvenance` FILESYSTEM WRITE is not pure — it can
    // fail exactly like any project-file write can (issue #506) — so it MUST
    // stay inside this `try`, on the same rollback boundary as
    // `inst-app-for-each-entry`. A failure here lands in the `catch` below,
    // which restores every snapshotted file — `provPath` included,
    // snapshotted at the top of this function — so the prior provenance
    // bytes come back exactly like any rolled-back project file.
    const updatedRecords = existingRecords.map((record, index) =>
      index === targetIndex ? { ...record, scaffoldedFromVersion: changeSet.targetVersion } : record,
    );
    await deps.writeProvenance(provPath, JSON.stringify(updatedRecords, null, 2));
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-update-prov
  } catch (err) {
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-try
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-catch
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-restore-on-error
    for (const [filePath, originalContent] of snapshot.files) {
      try {
        if (originalContent === null) {
          await deps.removeProjectFile(filePath);
        } else {
          await deps.writeProjectFile(filePath, originalContent);
        }
      } catch {
        // Best-effort restore — do not mask the original error
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-restore-on-error
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-return-failure
    return { ok: false, message: `Apply failed and was restored: ${message}` };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-return-failure
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-catch
  }

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-retain-snapshot
  // Snapshot is returned to the caller for rollback — retained until a new upgrade cycle
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-retain-snapshot

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-return-success
  return { ok: true, snapshot };
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-apply:p1:inst-app-return-success
}
