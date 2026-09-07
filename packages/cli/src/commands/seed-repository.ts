// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
// @cpt-flow:cpt-frontx-flow-cli-scaffolding-seed-repository:p1
//
// `seed` refuses a directory that already carries a `.frontx/project.json`
// (never an empty-target directory check — that concept is retired:
// existing on-disk content is judged generically, for every unrecorded
// target, by existing-content reconciliation, exactly as `apply` judges
// it), creates the initial empty project state document, auto-registers
// each batch entry naming one of the CLI's official default templates
// (`./official-defaults.ts` — see that file's own header for the scope
// decision behind that list), and then applies the batch through the
// IDENTICAL mechanism `apply` uses (`./apply.ts`'s `runApplyPipeline`) —
// never a second, independently duplicated materialize/reconcile/record
// sequence.
import path from 'node:path';
import { registerTemplate, probeRegistration } from './register';
import { officialDefaultOrigin } from './official-defaults';
import { runApplyPipeline, rollbackWrittenPaths, describeWrittenPaths, describeBundleRollback } from './apply';
import type { ApplyBatchOutcome, ApplyBatchTargetRef, ApplyPipelineDeps, RemoveEmptyDirFn } from './apply';
import type { UniformApplyBatch } from '../scaffold/assembler';
import { projectStatePath } from '../project-state/io';
import type { ProjectStateDocument } from '../project-state/types';
import type { ErrorCode } from '../envelope';

// `RemoveEmptyDirFn` is declared in `./apply.ts`, not here: `apply`'s own
// post-materialization rollback (`inst-add-rollback-writes`, `./apply.ts`)
// needs the identical capability `seed`'s own rollback needs, since its
// refusals roll back their writes too, so the type (and the shared removal
// helper built on it, `rollbackWrittenPaths`) lives there and this module
// imports both rather than keeping two independently-declared copies.
// Re-exported under this module's own name
// so `cli.ts`'s existing `import type { RemoveEmptyDirFn } from
// './commands/seed-repository'` keeps resolving without that file needing
// to change its own import path for a type move that is otherwise none of
// its dispatch logic's concern.
export type { RemoveEmptyDirFn };

// `removeProjectFileFn`/`removeEmptyDirFn` are `ApplyPipelineDeps`'s own
// fields, not additional fields layered on top here (see that interface's
// own doc comment in `./apply.ts` for why `apply` itself needs them too),
// so this type is a plain alias rather than an extension: every
// `SeedRepositoryDeps` value already IS a complete `ApplyPipelineDeps`
// value, with nothing seed-specific left to add.
export type SeedRepositoryDeps = ApplyPipelineDeps;

export type SeedRepositoryOutcome =
  | { ok: true; registeredDefaults: string[]; applied: ApplyBatchTargetRef[]; noop: ApplyBatchTargetRef[] }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

// The literal initial shape `project-state/io.ts`'s own (unexported)
// `initialProjectStateDocument` constructs — restated here rather than
// imported (that module owns the schema privately; no fresh dependency on
// its private helper is worth taking for a three-field literal this
// stable). `inst-seed-create-project-state` cites
// `cpt-frontx-algo-composed-provenance-project-state-io` by name for exactly
// this shape.
function initialProjectStateDocument(): ProjectStateDocument {
  return { formatVersion: 1, templates: {}, projectOwnedRoots: [] };
}

// @cpt-dod:cpt-frontx-dod-cli-scaffolding-uniform-apply:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-ai-bundle:p1
/**
 * cpt-frontx-flow-cli-scaffolding-seed-repository — seeds `dir` with a fresh
 * `.frontx/project.json`, auto-registers every official-default template
 * named in `batch`, then applies `batch` through the identical mechanism
 * `apply` uses.
 */
export async function seedRepository(
  dir: string,
  batch: UniformApplyBatch,
  adoptExisting: boolean,
  deps: SeedRepositoryDeps,
): Promise<SeedRepositoryOutcome> {
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-invoke
  // `dir`/`batch` are accepted as this function's own parameters, naming in
  // the batch the official default templates to apply.
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-invoke

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-already-seeded
  const existingRaw = await deps.readProjectStateFn(projectStatePath(dir));
  if (existingRaw !== null) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-already-seeded
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `"${dir}" already carries a project state document; a project once seeded is extended through ` +
        '"apply", never re-seeded.',
      details: { dir },
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-already-seeded
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-already-seeded

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-preflight-defaults
  // Resolve and validate every batch entry named against the CLI's official
  // defaults BEFORE the first write below (`inst-seed-create-project-state`),
  // so a batch naming a default that cannot actually be resolved is refused
  // with the directory left EXACTLY as it was found — never a
  // `.frontx/project.json` this same directory's next `seed` call would then
  // be permanently refused for (`inst-seed-if-already-seeded` above refuses
  // any directory that already carries one). Nothing here writes anything; a
  // failure here leaves no state to undo, which is why this runs first
  // rather than as a rollback after `inst-seed-create-project-state`/
  // `inst-seed-register-default` below have already run.
  for (const name of Object.keys(batch.templates)) {
    const origin = officialDefaultOrigin(name);
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-preflight-fail
    if (origin === undefined) {
      // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-preflight-fail
      return {
        ok: false,
        code: 'TEMPLATE_NOT_REGISTERED',
        message:
          `Seed aborted — "${name}" is not one of the CLI's official default templates. Register it yourself ` +
          '(this creates ".frontx/project.json" on its own first mutation if it does not exist yet, exactly as ' +
          'seed itself would have) and then "apply" it; nothing written.',
        details: { name },
      };
      // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-preflight-fail
    }
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-preflight-fail

    const probe = await probeRegistration(
      origin,
      dir,
      deps.inventory,
      deps.fetchFn,
      deps.readFileFn,
      deps.canonicalizeFn,
      deps.existsFn,
      deps.listFolderFilesFn,
    );
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-preflight-fail
    if (!probe.ok) {
      // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-preflight-fail
      return {
        ok: false,
        code: probe.code,
        message:
          `Seed aborted — official default "${name}" (origin "${origin}") could not be registered: ` +
          `${probe.message}; nothing written.`,
        details: { name, origin },
      };
      // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-preflight-fail
    }
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-preflight-fail
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-preflight-defaults

  // ROLLBACK GROUND: `.frontx` may not exist at all yet — captured BEFORE
  // the write immediately below is the only way to later tell "`seed` itself
  // created this directory" apart from "this directory was already here for
  // some other reason" (`inst-seed-rollback`'s own qualifier: remove it only
  // when `seed` created it AND it is now empty).
  const frontxDir = path.dirname(projectStatePath(dir));
  const frontxDirPreexisted = await deps.existsFn(frontxDir);

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-create-project-state
  await deps.writeProjectStateFn(projectStatePath(dir), JSON.stringify(initialProjectStateDocument(), null, 2));
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-create-project-state

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-rollback
  // Every refusal below this line must not leave `.frontx/project.json`
  // behind — otherwise the CLI reports failure, but the directory is left
  // permanently "already seeded" for every later `seed` attempt. Most of
  // the failures this rollback is reached from leave no payload FILE
  // behind either
  // (`CONTENT_CONFLICT`/`EXISTING_PATHS_REQUIRE_DECISION`/`TARGET_CONFLICT`/
  // the pre-materialize payload-escape `INVALID_PATH` check all refuse
  // BEFORE `apply.ts`'s own materialize step — see that file's own
  // instruction ordering) — but a refusal reached AFTER materialization
  // (the AI-bundle step, or the project-state record step, or an
  // unexpected thrown write failure) does leave real payload files on disk,
  // and `apply.ts` reports exactly which ones via `writtenPaths`
  // (`ApplyBatchOutcome`'s own `details.writtenPaths`). This rollback
  // removes those too — passed in by the caller below — in addition to its
  // own two writes: the project state document, and — only when `seed`
  // created it and it is now empty again — the `.frontx` directory that
  // document's write brought into being as a side effect.
  async function rollbackSeedWrites(writtenPaths: readonly string[] = [], bundledNames: readonly string[] = []): Promise<void> {
    // Reuses the SAME shared removal formulation `apply`'s own
    // post-materialization rollback uses (`rollbackWrittenPaths`,
    // `./apply.ts`) rather than a second, independently-duplicated removal
    // walk — removes every file in
    // `writtenPaths` over the same ground apply's OWN rollback covers
    // (`dir` IS the `repoRoot` `runApplyPipeline` above was called with).
    // Directory pruning is apply's, not this call's — see the fifth
    // argument below for why. Calling it
    // here even when apply's OWN rollback already removed everything (the
    // ordinary case — see `runApplyPipeline`'s own `recordedAnyThisCall`
    // doc comment) is harmless, never a double-removal that errors: both
    // `removeProjectFileFn` and `removeEmptyDirFn` are no-ops over ground
    // already gone. The one case this call is NOT redundant for is the
    // narrow one `recordedAnyThisCall` itself documents — a multi-name
    // batch where apply's OWN rollback deliberately left an earlier,
    // already-recorded name's files (and that name's bundle too) in place;
    // `seed`, unlike a standalone `apply`, is about to delete the WHOLE project state
    // document below regardless (a project either seeds completely or not at
    // all), so that earlier name's files AND its bundle are this rollback's
    // to remove too — the two rollbacks do not fight, they compose.
    // `bundledNames` is exactly `applyResult.details.bundledNames`
    // (`extractBundledNames` below) — the ONLY way this call learns which
    // names apply's own bundle step materialized a bundle for, since this
    // function has no other visibility into that step at all.
    //
    // The empty set is the fifth argument deliberately, not for want of a
    // better value: `rollbackWrittenPaths` prunes only directories the
    // CALLER can prove its own writes created, and that is answerable only
    // BEFORE materialization begins — a moment `seed` never has, since it
    // learns `writtenPaths` from an apply that has already run and returned.
    // `runApplyPipeline` DOES have that moment and takes it (its own
    // pre-write pass), so in the ordinary case the directories are already
    // pruned by the time this runs and there is nothing here to do. What is
    // left for this call is the narrow case `recordedAnyThisCall` documents
    // — an earlier, already-recorded name's files apply deliberately kept —
    // whose FILES are `seed`'s to remove (a project either seeds completely
    // or not at all) but whose directories `seed` cannot tell apart from
    // ones the developer put there. An empty directory left behind is a
    // residue; removing a developer's is damage, and this call declines to
    // guess between them.
    await rollbackWrittenPaths(
      dir,
      writtenPaths,
      deps.removeProjectFileFn,
      deps.removeEmptyDirFn,
      new Set(),
      deps.removeBundleFn,
      new Set(bundledNames),
    );
    await deps.removeProjectFileFn(projectStatePath(dir));
    if (!frontxDirPreexisted) {
      await deps.removeEmptyDirFn(frontxDir);
    }
  }

  // The `writtenPaths`/`bundledNames` an apply-phase failure's `details`
  // carries, narrowed from `unknown` — defensive against a caller-shaped
  // `details` that doesn't carry the field at all (every refusal BEFORE
  // materialization, or one that never reached the bundle step) or carries
  // something other than a string array (never true for `apply.ts`'s own
  // outcome shape, but this reads a structurally untyped `Record<string,
  // unknown>`, not a value this function controls).
  function extractWrittenPaths(details: Record<string, unknown> | undefined): string[] {
    const value = details?.writtenPaths;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  }

  function extractBundledNames(details: Record<string, unknown> | undefined): string[] {
    const value = details?.bundledNames;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  }

  // Recovers apply's underlying refusal REASON from `applyResult.message` by
  // removing the exact trailing clause(s) `describeWrittenPaths`/
  // `describeBundleRollback` (`./apply.ts`) composed onto it — those clauses
  // are the part of the message this rollback makes stale (they name
  // `writtenPaths`/`bundledNames` as either "remaining" or already "removed"
  // as of the MOMENT apply returned, never as of after THIS rollback also
  // ran). The bundle clause is stripped FIRST, since apply always appends it
  // AFTER the written-paths clause (`describeWrittenPaths(...) +
  // describeBundleRollback(...)` at every apply.ts call site) — stripping in
  // the reverse of append order is the only way each `endsWith` check ever
  // matches. Tries both possible spellings of EACH clause (`removed: true`
  // and `removed: false`) rather than assuming which one apply used, since
  // either is possible depending on whether apply's OWN rollback already ran
  // (`runApplyPipeline`'s own `recordedAnyThisCall` doc comment) — and falls
  // back to the message unchanged when neither matches, which is defensive
  // rather than load-bearing: every `ApplyBatchOutcome` failure that ever
  // carries a non-empty `details.writtenPaths`/`details.bundledNames`
  // composes its message through this exact function.
  function stripWrittenPathsClause(message: string, writtenPaths: readonly string[], bundledNames: readonly string[]): string {
    const bundledNamesSet = new Set(bundledNames);
    const removedBundleClause = describeBundleRollback(bundledNamesSet, true);
    const remainingBundleClause = describeBundleRollback(bundledNamesSet, false);
    let withoutBundleClause = message;
    if (removedBundleClause.length > 0 && message.endsWith(removedBundleClause)) {
      withoutBundleClause = message.slice(0, message.length - removedBundleClause.length).trimEnd();
    } else if (remainingBundleClause.length > 0 && message.endsWith(remainingBundleClause)) {
      withoutBundleClause = message.slice(0, message.length - remainingBundleClause.length).trimEnd();
    }
    const removedClause = describeWrittenPaths(writtenPaths, true);
    const remainingClause = describeWrittenPaths(writtenPaths, false);
    if (withoutBundleClause.endsWith(removedClause)) {
      return withoutBundleClause.slice(0, withoutBundleClause.length - removedClause.length).trimEnd();
    }
    if (withoutBundleClause.endsWith(remainingClause)) {
      return withoutBundleClause.slice(0, withoutBundleClause.length - remainingClause.length).trimEnd();
    }
    return withoutBundleClause;
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-rollback

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-foreach-default
  const registeredDefaults: string[] = [];
  for (const name of Object.keys(batch.templates)) {
    const origin = officialDefaultOrigin(name);
    if (origin === undefined) {
      // Unreachable in practice — the pre-flight loop above
      // (`inst-seed-preflight-defaults`) already refused any name that does
      // not resolve to an official default. Guarded rather than assumed
      // away, for the same reason `apply.ts`'s own defensive branches are:
      // a future caller reaching this point some other way must still be
      // rolled back honestly rather than leaving the state document this
      // call already wrote behind.
      await rollbackSeedWrites();
      return {
        ok: false,
        code: 'TEMPLATE_NOT_REGISTERED',
        message:
          `Seed aborted — "${name}" is not one of the CLI's official default templates. Register it yourself ` +
          '(this creates ".frontx/project.json" on its own first mutation if it does not exist yet, exactly as ' +
          'seed itself would have) and then "apply" it; whole batch aborted, nothing remains written.',
        details: { name },
      };
    }

    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-register-default
    const registerResult = await registerTemplate(
      origin,
      false,
      dir,
      deps.inventory,
      deps.fetchFn,
      deps.readFileFn,
      deps.canonicalizeFn,
      deps.readProjectStateFn,
      deps.writeProjectStateFn,
      deps.existsFn,
      deps.listFolderFilesFn,
    );
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-register-default

    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-register-fail
    if (!registerResult.ok) {
      // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-rollback
      await rollbackSeedWrites();
      // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-rollback
      // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-register-fail
      return {
        ok: false,
        code: 'ORIGIN_UNAVAILABLE',
        message:
          `Seed aborted — official default "${name}" (origin "${origin}") could not be registered: ` +
          `${registerResult.message}; nothing remains written.`,
        details: { name, origin },
      };
      // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-register-fail
    }
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-register-fail
    registeredDefaults.push(name);
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-foreach-default

  // `inst-seed-resolve` through `inst-seed-return-done` are realized by the
  // IDENTICAL apply mechanism `apply`'s own dispatch calls
  // (`./apply.ts`'s `runApplyPipeline`, which itself calls the shared
  // `resolveAndCheckBatch`) — not re-marked or reformulated a second time
  // here.
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-resolve
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-resolve-fail
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-resolve-fail
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-conflict-check
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-conflict
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-conflict
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-existing-content
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-existing-conflict
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-existing-conflict
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-materialize
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-materialize-bundle
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-record
  // This call must sit inside a `try`: a thrown failure (EACCES, ENOSPC, a
  // native abort) would otherwise bypass `inst-seed-rollback` entirely,
  // propagating past `seedRepository` and out through the CLI's own
  // top-level catch-all (`cli.ts`'s `run`) as exit 2 with empty `--json`
  // stdout, and leaving the directory locked out of every later `seed` call
  // by the very document this rollback exists to remove. `apply.ts` itself
  // converts every write-phase throw it knows about into a structured
  // refusal, but this catch is the backstop for anything that still
  // escapes — from apply's own resolve/conflict-check phase or elsewhere —
  // so rollback runs on every path out of this call, not only a returned
  // refusal.
  let applyResult: ApplyBatchOutcome;
  try {
    applyResult = await runApplyPipeline(batch, dir, adoptExisting, deps);
  } catch (error) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-rollback
    await rollbackSeedWrites();
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-rollback
    return {
      ok: false,
      code: 'INTERNAL',
      message:
        `Seed aborted — an unexpected error interrupted the apply phase: ` +
        `${error instanceof Error ? error.message : String(error)}; the project state document (and any ` +
        'directory it created) has been rolled back — nothing from this batch remains.',
    };
  }
  if (!applyResult.ok) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-rollback
    const writtenPaths = extractWrittenPaths(applyResult.details);
    const bundledNames = extractBundledNames(applyResult.details);
    await rollbackSeedWrites(writtenPaths, bundledNames);
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-rollback
    if (writtenPaths.length === 0 && bundledNames.length === 0) return applyResult;
    // `applyResult.message` narrates apply's own refusal AT THE MOMENT apply
    // returned it — for a refusal that names `writtenPaths`/`bundledNames`,
    // that always ends in EXACTLY the clause(s) `describeWrittenPaths`/
    // `describeBundleRollback` compose (`./apply.ts`), saying either that
    // those files/bundles "remain" or that apply's OWN rollback already
    // "removed" them (`runApplyPipeline`'s own `recordedAnyThisCall` doc
    // comment). Either way, that clause goes STALE the moment
    // `rollbackSeedWrites` just above runs: this rollback is the one that
    // gets the final, honest word on what is on disk, so quoting apply's
    // clause verbatim risks a self-contradiction ("...file(s) remain on
    // disk. ...nothing remains written." in one breath). Rather than
    // restate apply's message and hope the two
    // halves agree, `stripWrittenPathsClause` recovers apply's underlying
    // REASON by removing those exact clauses (reusing `describeWrittenPaths`/
    // `describeBundleRollback` themselves to find them, never a second,
    // independently-guessed pattern), and this composes its OWN,
    // current-tense description of what the rollback just above actually
    // did around that reason. `details.writtenPaths`/`details.bundledNames`
    // are dropped entirely for the identical reason: nothing they name is
    // still true.
    const { writtenPaths: _rolledBackFiles, bundledNames: _rolledBackBundles, ...remainingDetails } = applyResult.details ?? {};
    const reason = stripWrittenPathsClause(applyResult.message, writtenPaths, bundledNames);
    const removedParts = [
      writtenPaths.length > 0 ? `${writtenPaths.length} file(s)` : undefined,
      bundledNames.length > 0 ? `${bundledNames.length} AI-extension bundle(s)` : undefined,
    ].filter((part): part is string => part !== undefined);
    return {
      ok: false,
      code: applyResult.code,
      message:
        `Seed has rolled back everything this attempt wrote — including ${removedParts.join(' and ')} the apply ` +
        'phase had already written — so nothing from this batch remains on disk or in the project state store. ' +
        `The apply phase's own reason for refusing: ${reason}`,
      details: Object.keys(remainingDetails).length > 0 ? remainingDetails : undefined,
    };
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-record
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-materialize-bundle
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-materialize
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-existing-conflict
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-existing-conflict
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-existing-content
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-conflict
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-conflict
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-conflict-check
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-resolve-fail
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-resolve-fail
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-resolve

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-done
  return { ok: true, registeredDefaults, applied: applyResult.applied, noop: applyResult.noop };
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-done
}
