#!/usr/bin/env node
// @cpt-flow:cpt-frontx-flow-cli-invocation-run-command:p1
// @cpt-flow:cpt-frontx-flow-cli-invocation-help:p1
// @cpt-algo:cpt-frontx-algo-cli-invocation-parse-dispatch:p1
// @cpt-state:cpt-frontx-state-cli-invocation-run:p1
// @cpt-dod:cpt-frontx-dod-cli-invocation-executable-entrypoint:p1
// @cpt-dod:cpt-frontx-dod-cli-invocation-usage-help:p1
// @cpt-dod:cpt-frontx-dod-cli-invocation-exit-codes:p1
// @cpt-dod:cpt-frontx-dod-cli-invocation-json-envelope-dispatch:p1
//
// The `frontx` executable entrypoint (F18, `cpt-frontx-feature-cli-invocation`).
// Parses the process invocation, dispatches `frontx <command> [args]` to the
// ONE internal component that owns that command's behavior — referenced by
// canonical flow ID, never redefined here — and maps every outcome to the
// success / user-error / internal-error exit-code state machine
// (`cpt-frontx-state-cli-invocation-run`). This is the ONLY dispatch path;
// it invokes the already-implemented command behaviors through the concrete
// I/O adapters delivered in Phases 9-10 (plus the generic fs project-io glue
// in `adapters/fs-project-io.ts`) rather than reimplementing any I/O.
import readline from 'node:readline/promises';
import path from 'node:path';
import process from 'node:process';
import { realpathSync, readdirSync, rmdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { installCommand } from './commands/install';
import type { InstallCommandResult } from './commands/install';
import { buildListCatalog, listCatalogEnvelope, formatListHuman } from './commands/list';
import { updateLocalCommand } from './commands/update-local';
import { validateCommand } from './commands/validate';
import { validateProject } from './commands/validate-project';
import type { ValidateProjectOutcome } from './commands/validate-project';
import { assembleBatch } from './commands/assemble';
import type { AssembleOutcome } from './commands/assemble';
import { runApplyPipeline } from './commands/apply';
import type { ApplyBatchOutcome, ApplyPipelineDeps } from './commands/apply';
import { seedRepository } from './commands/seed-repository';
import type { SeedRepositoryOutcome, RemoveEmptyDirFn } from './commands/seed-repository';
import { upgradeCommand } from './commands/upgrade';
import type { UpgradeCommandOutcome, UpgradeDirection } from './commands/upgrade';
import type { UpgradeEngineDeps } from './upgrade/flow';
import { renderReviewablePlan } from './upgrade/plan';
import { createResolvePayloadFn } from './upgrade/payload';
import { readProjectState } from './project-state/io';
import { resolveRegisteredExcludedSubtrees } from './scaffold/registered-manifest';
import {
  createFsReadDiskEntryFn,
  createFsListDiskFilesFn,
  createFsWriteDiskFileFn,
  createFsRenameDiskFileFn,
  createFsUnlinkDiskFileFn,
} from './adapters/fs-upgrade-io';
import { registerTemplate } from './commands/register';
import type { RegisterOutcome } from './commands/register';
import { unregisterTemplate } from './commands/unregister';
import type { UnregisterOutcome } from './commands/unregister';
import { ownershipAdd, ownershipRemove, ownershipList } from './commands/ownership';
import type { OwnershipAddOutcome, OwnershipRemoveOutcome, OwnershipListOutcome } from './commands/ownership';
import { deleteTarget } from './commands/delete';
import { materializeOrRemoveAiBundle } from './scaffold/ai-bundle';
import type { RemoveAiBundleFn } from './commands/delete';
import { createFsBundleExistsFn, createFsCopyBundleFn, createFsRemoveBundleFn } from './adapters/fs-ai-bundle';
import type { DeleteOutcome, ConfirmDeletionFn } from './commands/delete';

import { TemplateInventory } from './inventory/TemplateInventory';
import type { FetchFn } from './resolver/types';
import type { AssertPathWithinRootFn, ReadContentItemsFn, WriteFileFn } from './scaffold/types';
import type { CanonicalizeTargetFn } from './scaffold/conflict-check';
import type { ResolveInstalledContentPathFn, UniformApplyBatch } from './scaffold/assembler';
import type { ReadExistingContentFn, ReadInstalledContentFn } from './scaffold/existing-content';
import { createFsReadExistingContentFn, createFsReadInstalledContentFn } from './adapters/fs-existing-content';
import { resolveInstalledContentPath } from './adapters/fs-installed-content-path';
import type { ListPayloadFilesFn, ResolveDeclaredExclusionFn, ReadFileFn } from './manifest/types';
import type { ListFolderFilesFn, PathExistsFn } from './resolver/types';
import type { ReadTargetPathStateFn } from './commands/add-template';
import type { ReadProjectStateFn, WriteProjectStateFn } from './project-state/types';
import type { ListTargetFilesFn, ListUnenumerableTargetEntriesFn } from './scaffold/delete-plan';
import type { RemoveProjectFileFn, PresentUpgradePlanFn } from './upgrade/types';
import { ok, err } from './envelope';
import type { ErrorCode } from './envelope';
import type { ValidateCommandResult } from './commands/validate';

import { FsInventoryIndex } from './adapters/fs-inventory-index';
import { FsContentStore } from './adapters/fs-content-store';
import { createFsReadContentItemsFn } from './adapters/fs-read-content-items';
import { createGithubFetchFn, resolveInventoryRoot } from './adapters/github-fetch';
import { createLocalFetchFn } from './adapters/local-fetch';
import { createFsReadTargetPathStateFn } from './adapters/fs-target-path';
import {
  createFsWriteFileFn,
  createFsReadFileFn,
  createFsListPayloadFilesFn,
  createFsResolveDeclaredExclusionFn,
  createFsRemoveProjectFileFn,
  createFsReadProjectStateFn,
  createFsWriteProjectStateFn,
  createFsCanonicalizeTargetFn,
  createFsListTargetFilesFn,
  createFsListUnenumerableTargetEntriesFn,
  createFsPathExistsFn,
  createFsAssertPathWithinRootFn,
  PathContainmentError,
  NotRegularFileError,
  UnreachablePathError,
  PathUnreadableError,
  ProjectStateUnreadableError,
  describeUnreadableCause,
  describeNonRegularKind,
} from './adapters/fs-project-io';
import { InvalidInventoryIndexError } from './adapters/fs-inventory-index';

// @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-if-yes-without-json
// @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-return-yes-without-json
/**
 * `--yes` is the `--json` protocol's second call, not a prompt suppressor:
 * both confirmation gates spell it `--json --yes`, and interactive mode asks
 * the developer instead (`cpt-frontx-flow-cli-scaffolding-delete-target`'s
 * own `inst-del-if-json-no-yes`/`inst-del-else-json-yes`). Passing it without
 * `--json` therefore did nothing at all, and — with no terminal attached, the
 * shape every script has — the prompt read end-of-input, took its declared
 * `No` default, and exited 0 having done nothing: a caller that asked for a
 * non-interactive run got a silent no-op reported as success. Refused here
 * instead, naming the form that works.
 */
function rejectYesWithoutJson(command: string, jsonMode: boolean, yes: boolean): CommandOutcome | undefined {
  if (!yes || jsonMode) return undefined;
  const message = `${command} accepts --yes only together with --json; without --json it asks for confirmation interactively.`;
  return { exitCode: EXIT_USER_ERROR, stderr: message };
}
// @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-return-yes-without-json
// @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-if-yes-without-json

// --- exit-code state machine (cpt-frontx-state-cli-invocation-run) ---

export const EXIT_SUCCESS = 0;
export const EXIT_USER_ERROR = 1;
export const EXIT_INTERNAL_ERROR = 2;

export type ExitCode = typeof EXIT_SUCCESS | typeof EXIT_USER_ERROR | typeof EXIT_INTERNAL_ERROR;

export interface CommandOutcome {
  exitCode: ExitCode;
  stdout?: string;
  stderr?: string;
}

// --- argv parse (cpt-frontx-algo-cli-invocation-parse-dispatch) ---

const KNOWN_COMMANDS = [
  'install',
  'list',
  'update-local',
  'validate',
  'assemble',
  'seed',
  'apply',
  'upgrade',
  'register',
  'unregister',
  'ownership',
  'delete',
] as const;
export type KnownCommand = (typeof KNOWN_COMMANDS)[number];

const HELP_TOKENS = new Set(['help', '-h', '--help']);

export interface ParsedInvocation {
  command: string | undefined;
  args: string[];
  helpRequested: boolean;
  unrecognized: boolean;
}

/**
 * cpt-frontx-algo-cli-invocation-parse-dispatch — parses the process
 * invocation into a leading command token and its remaining arguments.
 */
export function parseInvocation(argv: string[]): ParsedInvocation {
  // @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-receive
  const [command, ...args] = argv;
  // @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-receive

  // @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-parse
  // command + args are already split above; nothing further to parse.
  // @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-parse

  // @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-if-help
  const helpRequested = command === undefined || HELP_TOKENS.has(command);
  // @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-if-help

  // @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-if-unknown
  const unrecognized = !helpRequested && !KNOWN_COMMANDS.includes(command as KnownCommand);
  // @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-if-unknown

  return { command, args, helpRequested, unrecognized };
}

// --- usage/help (cpt-frontx-flow-cli-invocation-help) ---

export function usageText(): string {
  return [
    'Usage: frontx <command> [args]',
    '',
    'Commands:',
    '  install <spec> [--json]                 Install a template from a source-spec',
    '  list [--json]                           List installed templates (--json: one record per entry)',
    '  update-local <identity> <spec> [--json] Update a locally installed template',
    '  validate <templateDir>                  Validate a template manifest for publication',
    '  validate --project [--json]             Validate .frontx/project.json against reality',
    '  assemble --input <batch-json> [--json]  Preview an explicit batch; writes nothing',
    '  seed <dir> --input <batch-json> [--adopt-existing] [--json]',
    '                                           Seed a new or empty repository from a batch',
    '  apply --input <batch-json> [--adopt-existing] [--json]',
    '                                           Apply a batch into an already-assembled repository',
    '  upgrade <templateName> <new-origin> [--json [--yes]]   Upgrade a registered template to a new origin',
    '  upgrade <templateName> --restore [--json [--yes]]      Restore a template to its immediately preceding origin',
    '  register <origin> [--replace] [--json]  Register a template origin under the current project',
    '  unregister <name> [--json]              Unregister a template with no applied targets',
    '  ownership add <path> [--json]           Mark an existing path as project-owned',
    '  ownership remove <path> [--json]        Un-mark a project-owned path',
    '  ownership list [--json]                 List the project-owned root paths',
    '  delete <target> [--dry-run] [--json [--yes]]  Delete an applied template target',
    '  help                                    Show this usage summary',
    '',
    'A source-spec is host:owner/repo[//subtree]@ref — the optional //subtree',
    'addresses a template that occupies a subdirectory of a repository.',
    'A template is identified by the name its own manifest declares, which is what',
    'list reports and what update-local expects.',
    '',
    'A batch is JSON shaped {"templates": {"<name>": ["<target>", ...]}} — for each',
    'template name already registered under the current project, the target or',
    'targets to apply it to. assemble/apply/seed all accept the identical shape.',
    '',
  ].join('\n');
}

// --- adapter wiring (Phases 9-10 concrete I/O adapters + fs-project-io glue) ---

export interface CliDeps {
  inventory: TemplateInventory;
  fetchFn: FetchFn;
  readContentFn: ReadContentItemsFn;
  writeFileFn: WriteFileFn;
  readFileFn: ReadFileFn;
  listPayloadFilesFn: ListPayloadFilesFn;
  resolveDeclaredExclusionFn: ResolveDeclaredExclusionFn;
  readTargetPathStateFn: ReadTargetPathStateFn;
  // `seed` ONLY — probes `<dir>` itself (not a template target) before
  // dispatching into `seedRepository`: an absent path or an existing FILE
  // both currently reach a raw `fs` throw several seams deep (the
  // canonicalize-target factory's own `realpathSync` refusal, or a
  // downstream `mkdirSync` under a path with a file component), surfacing
  // as an uncaught internal error (exit 2, no `--json` envelope) rather
  // than the ordinary `INVALID_PATH` user-error refusal a caller-supplied
  // bad path deserves. A SEPARATE field from `readTargetPathStateFn` above
  // (same type, same real adapter) rather than a second use of it: that
  // seam probes individual TARGETS inside an already-valid project, a
  // different question from "is this the project root `seed` was even
  // given".
  readSeedDirStateFn: ReadTargetPathStateFn;
  // `register`/`assemble`/`apply`/`seed`/`upgrade` — the shared resolver's
  // own local-`path:`-origin seams (`resolver/types.ts`'s `LocalOriginDeps`):
  // confirms a folder actually exists (containment alone cannot) and
  // enumerates its regular files. Reused, not duplicated, across every
  // command that can resolve a local origin.
  existsFn: PathExistsFn;
  listFolderFilesFn: ListFolderFilesFn;
  // `assemble`/`apply`/`seed` (`cpt-frontx-algo-cli-scaffolding-uniform-
  // apply`'s own seam) — resolves a name already installed in the local
  // inventory to its real on-disk installed content directory. Stored here
  // (rather than built ad hoc at each dispatch site) because it closes over
  // `inventoryRoot`, known only inside this factory.
  resolveInstalledContentPathFn: ResolveInstalledContentPathFn;
  // `assemble`/`apply`/`seed` — FACTORIES, not built values, because each
  // closes over a project root only known at dispatch time (`apply`
  // operates on the current working directory; `seed` operates on its own
  // `<dir>` argument), the same reason `createCanonicalizeTargetFn` below is
  // a factory rather than a built value.
  createReadInstalledContentFn: (repoRoot: string) => ReadInstalledContentFn;
  createReadExistingContentFn: (repoRoot: string) => ReadExistingContentFn;
  // `delete` — reused directly by `upgrade`'s own commit for removing a
  // landed destination it needs to reverse; NOT reused for `upgrade`'s own
  // commit-phase disk writes, which go through `adapters/fs-upgrade-io.ts`'s
  // dedicated seams instead (see the `upgrade` dispatch case below for why:
  // that engine's `WriteDiskFileFn`/`RenameDiskFileFn`/`UnlinkDiskFileFn`
  // shapes are deliberately distinct from this generic one, per `upgrade/
  // types.ts`'s own header).
  removeProjectFile: RemoveProjectFileFn;
  // `apply`'s and `seed`'s own rollback (`commands/apply.ts`'s
  // `rollbackWrittenPaths`, called from both `runApplyPipeline` directly and
  // `seed`'s `inst-seed-rollback` through the same pipeline): prunes a
  // directory a call's own writes brought into being back out, but only when
  // it is still (or once again) completely empty, and only up to the
  // directories that call itself created. No existing seam can do this —
  // every other one here either reads/writes the ONE `.frontx/project.json`
  // file, or removes a single file (`removeProjectFile` above, reused as-is
  // for that document itself) — none can remove a directory. `RemoveEmptyDirFn`
  // itself is declared in `commands/apply.ts`, not `seed-repository.ts`, for
  // the identical reason: it is that shared rollback's seam now, not a
  // `seed`-only one.
  removeEmptyDirFn: RemoveEmptyDirFn;
  // `register`/`unregister`/`ownership add|remove|list` — the single
  // project state document's own read/write seams (`.frontx/project.json`).
  // `createCanonicalizeTargetFn` is a FACTORY rather than a built
  // `CanonicalizeTargetFn` value because it closes over a project root that
  // is only known at dispatch time (these three commands take no explicit
  // project-root argument — they operate on the current working directory,
  // per their FEATURE flows' own signatures), unlike every other entry here.
  readProjectStateFn: ReadProjectStateFn;
  writeProjectStateFn: WriteProjectStateFn;
  createCanonicalizeTargetFn: (repoRoot: string) => CanonicalizeTargetFn;
  // `apply`/`seed`/`delete` — CONTAINMENT ESCAPE FIX: proves an absolute
  // path a write or removal is about to touch stays inside the applicable
  // project root, symlinks resolved. A FACTORY for the identical reason
  // `createCanonicalizeTargetFn` above is one: `apply`'s root
  // (`process.cwd()`) is not always `seed <dir>`'s (`dir` itself), so this
  // is built fresh per command, at dispatch time, never once here.
  createAssertPathWithinRootFn: (repoRoot: string) => AssertPathWithinRootFn;
  // `delete` — enumerates real on-disk paths under an arbitrary applied
  // target (`cpt-frontx-algo-cli-scaffolding-delete-plan`), DISTINCT from
  // `listPayloadFilesFn` above, which is scoped to a template's own
  // directory and skips `node_modules` (see `scaffold/delete-plan.ts`'s own
  // `ListTargetFilesFn` doc comment for why reusing that seam here would be
  // wrong). `removeProjectFile` above is reused directly for removing one
  // `toDelete` entry — no second "remove a file" seam is added for it.
  listTargetFilesFn: ListTargetFilesFn;
  // The companion to `listTargetFilesFn` above: the entries inside a target
  // that are not regular files and so cannot be enumerated as deletable
  // content. `delete`'s plan names them in `toPreserve`, so a developer
  // confirming a deletion is told what survives it.
  listUnenumerableTargetEntriesFn: ListUnenumerableTargetEntriesFn;
  confirmDeletion: ConfirmDeletionFn;
  // `upgrade` — the interactive (non-`--json`) plan-approval prompt,
  // symmetric to `confirmDeletion` above: printed to stdout, read from
  // stdin, defaulting to No on anything but an explicit affirmative
  // (`createInteractiveUpgradeApproval`'s own doc comment). Never called at
  // all in `--json` mode — see the `upgrade` dispatch case for that
  // protocol.
  presentUpgradePlan: PresentUpgradePlanFn;
}

/** Assembles the real, fs/network-backed dependency set for the `frontx` executable. */
export function createRealDeps(): CliDeps {
  const inventoryRoot = resolveInventoryRoot();
  const inventory = new TemplateInventory(new FsInventoryIndex(inventoryRoot), new FsContentStore(inventoryRoot));
  return {
    inventory,
    // TEST-ONLY offline hook: when `FRONTX_TEST_LOCAL_SOURCE_DIR` is set,
    // `install`/`update-local`/`upgrade` resolve against that local directory
    // instead of the network, via the SAME `FetchFn` seam. Unset, this is
    // byte-for-byte the production GitHub-fetch path. Not product behavior.
    fetchFn: process.env.FRONTX_TEST_LOCAL_SOURCE_DIR
      ? createLocalFetchFn(process.env.FRONTX_TEST_LOCAL_SOURCE_DIR)
      : createGithubFetchFn({ token: process.env.GITHUB_TOKEN }),
    readContentFn: createFsReadContentItemsFn(inventoryRoot),
    writeFileFn: createFsWriteFileFn(),
    readFileFn: createFsReadFileFn(),
    listPayloadFilesFn: createFsListPayloadFilesFn(),
    resolveDeclaredExclusionFn: createFsResolveDeclaredExclusionFn(),
    readTargetPathStateFn: createFsReadTargetPathStateFn(),
    // Same real adapter as `readTargetPathStateFn` above — a fresh instance
    // is unnecessary (the function is stateless), but a distinct FIELD keeps
    // `seed`'s own root-directory probe conceptually separate from that
    // seam's other, per-target callers (`ownership add`).
    readSeedDirStateFn: createFsReadTargetPathStateFn(),
    existsFn: createFsPathExistsFn(),
    listFolderFilesFn: createFsListDiskFilesFn(),
    resolveInstalledContentPathFn: (name: string) => resolveInstalledContentPath(inventoryRoot, name),
    createReadInstalledContentFn: createFsReadInstalledContentFn,
    createReadExistingContentFn: createFsReadExistingContentFn,
    removeProjectFile: createFsRemoveProjectFileFn(),
    removeEmptyDirFn: createFsRemoveEmptyDirFn(),
    readProjectStateFn: createFsReadProjectStateFn(),
    writeProjectStateFn: createFsWriteProjectStateFn(),
    createCanonicalizeTargetFn: createFsCanonicalizeTargetFn,
    createAssertPathWithinRootFn: createFsAssertPathWithinRootFn,
    listTargetFilesFn: createFsListTargetFilesFn(),
    listUnenumerableTargetEntriesFn: createFsListUnenumerableTargetEntriesFn(),
    confirmDeletion: createInteractiveDeletionConfirm(),
    presentUpgradePlan: createInteractiveUpgradeApproval(),
  };
}

/**
 * Real `RemoveEmptyDirFn` (`commands/apply.ts`) — removes `absolutePath`
 * only when it exists and is now completely empty; a no-op when it is
 * absent, non-empty, or not a plain directory. Shared by `apply`'s own
 * post-materialization rollback and `seed`'s (the same pipeline underneath):
 * it never forces, never recurses, and never touches anything but the exact
 * directory it is told to reconsider.
 */
function createFsRemoveEmptyDirFn(): RemoveEmptyDirFn {
  return async function removeEmptyDir(absolutePath: string): Promise<void> {
    let entries: string[];
    try {
      entries = readdirSync(absolutePath);
    } catch {
      return; // absent, or not a readable directory — nothing to remove
    }
    if (entries.length > 0) return; // genuinely non-empty — never forced
    try {
      rmdirSync(absolutePath);
    } catch {
      // Best-effort: a concurrent write between the `readdirSync` above and
      // this `rmdirSync` (or a permission refusal) leaves the directory in
      // place rather than escalating into a second failure on top of the
      // one already being reported.
    }
  };
}

/**
 * Prints the computed plan and prompts on stdin for confirmation, defaulting
 * to No. Every write onto `process.stdout` here — the two listings below AND
 * `readline`'s own writes of the prompt text once the interface exists —
 * shares the single tolerant path `writeToStream` gives the final envelope
 * write in `main()`: attaching its permanent 'error' listener to a stream is
 * a one-time, idempotent registration (`tolerateStreamErrors`'s own
 * `WeakSet` guard), so calling it here BEFORE `readline.createInterface` is
 * built covers every later write `readline` itself makes to that same
 * stream, not only the two calls that go through this function by name. A
 * reader that closes early (`| head`) is the reader's own decision on an
 * interactive listing exactly as it is on a `--json` envelope; it must not
 * crash the process either way — but the two listings themselves go through
 * `writeInteractiveLineOrEscalate` (above), not `writeToStream` directly,
 * so a write failure that is NOT a closed reader still escalates to the
 * internal-error exit code, exactly as the same failure on the final
 * envelope write already does.
 */
/**
 * The answer an interactive prompt gets, with end-of-input resolved to the
 * prompt's own default rather than left hanging.
 *
 * `readline`'s `question()` returns a promise that only ever settles when a
 * LINE arrives. Standard input that is already at end of file — a caller
 * running the command with `< /dev/null`, a script or an agent driving it
 * with nothing on stdin, a closed terminal — delivers no line and never will,
 * so that promise stays pending forever. The process does not hang on it:
 * the event loop simply runs out of work and Node exits, having printed the
 * prompt and produced no outcome at all. A caller then sees a command that
 * asked a question, answered nothing, and exited zero.
 *
 * Racing the interface's own `close` event against the answer turns that into
 * the default the prompt already advertises — No — so end of input declines,
 * says so, and leaves the same trace an explicitly typed "n" leaves. Refusing
 * by default is the only safe reading of "no answer" for an operation that
 * removes files or rewrites a project's content.
 */
async function askWithDefaultOnEndOfInput(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise<string>((resolve) => {
    let settled = false;
    const settle = (answer: string): void => {
      if (settled) return;
      settled = true;
      resolve(answer);
    };
    rl.once('close', () => settle(''));
    void rl.question(prompt).then(settle, () => settle(''));
  });
}

// @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-if-write-failed
// @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-write-failed-escalate
// The escalation `main()` already gives the final envelope write
// (`escalateOnWriteFailure`) applies to every write this entrypoint makes,
// per this flow's own error scenario ("any other write failure is surfaced
// as the internal-error code ... since the outcome already computed can no
// longer be trusted as fully delivered") — not only the last one. An
// interactive prompt's own writes (the plan listing, the plan review) used
// to call `writeToStream` directly and ignore its `'ok' | 'failed'` result,
// so a genuine write failure there (anything but the already-tolerated
// broken pipe) was silently swallowed and the prompt proceeded as if nothing
// had gone wrong — the identical escalation contract without the escalation.
// Throwing here, rather than returning a status this function's own callers
// (`ConfirmDeletionFn`/`PresentUpgradePlanFn`, `commands/delete.ts` and
// `commands/upgrade.ts`'s own dispatch, neither of which is this feature's
// concern to redefine) would then need a new field to carry, reaches the
// SAME place every other unexpected failure already reaches: `run()`'s own
// catch maps any thrown, untyped error to the internal-error exit code —
// so the escalation is realized without asking either command's own outcome
// shape to grow a channel for a failure that is this entrypoint's own
// writing, not that command's.
// `stream` defaults to `process.stdout` (every real call site's actual
// destination) but is accepted as a parameter — never hardcoded — for the
// identical reason `writeToStream` itself is exported: so a unit test can
// drive this against a real (if deliberately failing) `Writable` rather than
// only against the live process stream.
export async function writeInteractiveLineOrEscalate(
  text: string,
  stream: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const result = await writeToStream(stream, text);
  if (result === 'failed') {
    throw new Error('Failed to write to stdout during an interactive prompt.');
  }
}
// @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-write-failed-escalate
// @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-if-write-failed

function createInteractiveDeletionConfirm(): ConfirmDeletionFn {
  return async function confirmDeletion(plan): Promise<'confirmed' | 'declined'> {
    await writeInteractiveLineOrEscalate(`Would delete:\n${plan.toDelete.map((p) => `  ${p}`).join('\n') || '  (nothing)'}\n`);
    await writeInteractiveLineOrEscalate(`Would preserve:\n${plan.toPreserve.map((p) => `  ${p}`).join('\n') || '  (nothing)'}\n`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await askWithDefaultOnEndOfInput(rl, `Delete "${plan.target}"? [y/N] `);
      return answer.trim().toLowerCase() === 'y' ? 'confirmed' : 'declined';
    } finally {
      rl.close();
    }
  };
}

/**
 * Prints the computed upgrade plan and prompts on stdin for approval,
 * defaulting to No on anything but an explicit affirmative — the identical
 * discipline `createInteractiveDeletionConfirm` above applies for `delete`.
 * Never constructed or called at all in `--json` mode: `commands/upgrade.ts`
 * wires its own `presentPlan` there instead (see the `upgrade` dispatch case
 * below), which never reads stdin. The rendered plan is written through
 * `writeInteractiveLineOrEscalate`, for the same reason
 * `createInteractiveDeletionConfirm` above writes through it rather than
 * `process.stdout.write` directly: the permanent, idempotent 'error'
 * listener `writeToStream` attaches to the stream also covers every write
 * `readline` performs on it afterward, and a write failure that is not a
 * closed reader escalates to the internal-error exit code instead of being
 * silently swallowed while the prompt proceeds.
 */
function createInteractiveUpgradeApproval(): PresentUpgradePlanFn {
  return async function presentUpgradePlan(plan): Promise<'approved' | 'declined'> {
    // Rendered from the PROJECTED plan, and as a file/action list rather than
    // a JSON dump. `JSON.stringify(plan)` on the internal plan printed
    // `expectedDisk`, `newContent` and `baselineContent` for every operation —
    // up to three full copies of every changed file's bytes — as the thing a
    // developer was supposed to "review". `cpt-frontx-adr-project-upgrade-
    // mechanism` fixes whole-file granularity precisely so the review is "a
    // list of files and actions, not ... textual deltas inside them".
    const reviewable = renderReviewablePlan(plan);
    const lines = [
      `Upgrade "${reviewable.name}"`,
      `  from ${reviewable.from.origin} (version ${reviewable.from.version})`,
      `  to   ${reviewable.to.origin} (version ${reviewable.to.version})`,
      `  targets: ${reviewable.targets.join(', ')}`,
      ...reviewable.operations.map((operation) => `  ${operation.op.padEnd(10)} ${operation.path}`),
      ...reviewable.skipped.map((entry) => `  ${'SKIPPED'.padEnd(10)} ${entry.path} (${entry.reason})`),
    ];
    await writeInteractiveLineOrEscalate(`${lines.join('\n')}\n`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await askWithDefaultOnEndOfInput(rl, `Apply this upgrade for "${plan.name}"? [y/N] `);
      return answer.trim().toLowerCase() === 'y' ? 'approved' : 'declined';
    } finally {
      rl.close();
    }
  };
}


// --- dispatch (cpt-frontx-flow-cli-invocation-run-command) ---

// `assemble`/`apply`/`seed` all accept the identical batch shape
// (`cpt-frontx-algo-cli-scaffolding-uniform-apply`'s own Input line) via one
// `--input <json>` flag — parsed and validated here, at the dispatch layer,
// exactly as `delete`'s `--json`/`--dry-run`/`--yes` flags are (`commands/
// delete.ts`'s own header: flags are wired at the dispatch layer, never
// inside the command module).
function parseBatchInput(raw: string): { ok: true; batch: UniformApplyBatch } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'Batch input is not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: 'Batch input must be a JSON object shaped {"templates": {"<name>": ["<target>", ...]}}.' };
  }
  const templatesRaw = (parsed as Record<string, unknown>).templates;
  if (typeof templatesRaw !== 'object' || templatesRaw === null || Array.isArray(templatesRaw)) {
    return { ok: false, message: 'Batch input must declare a "templates" object.' };
  }
  const templates: Record<string, string[]> = {};
  for (const [name, targets] of Object.entries(templatesRaw as Record<string, unknown>)) {
    if (!Array.isArray(targets) || !targets.every((t): t is string => typeof t === 'string')) {
      return { ok: false, message: `Batch entry "${name}" must be an array of target strings.` };
    }
    templates[name] = targets;
  }
  return { ok: true, batch: { templates } };
}

// Extracts a `--flag <value>` pair from `args`, returning the value (or
// `undefined` when the flag is absent or carries no following token) and
// the remaining args with both the flag and its value removed — so a
// caller can then filter the rest for its own boolean flags/positionals
// without re-parsing the same two tokens a second time.
function extractFlagValue(args: string[], flag: string): { value: string | undefined; rest: string[] } {
  const index = args.indexOf(flag);
  if (index === -1) return { value: undefined, rest: args };
  const value = args[index + 1];
  const rest = args.filter((_, i) => i !== index && i !== index + 1);
  return { value, rest };
}

// The flow's own step 5 ("**IF** `--json` was requested, the entrypoint
// suppresses every interactive prompt reachable from the dispatched
// behavior") and the algorithm's `inst-pd-json-mode` are ONE formulation
// seen from two altitudes, so they are carried on one piece of code rather
// than given a second implementation each — the same co-location
// `scaffold/effective-ownership.ts` uses for the apply and delete flows'
// shared ownership subtraction.
// @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-json-suppress-prompt
// @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-json-mode
// The ONE place `--json` is recognized, replacing the nine independent
// `parseJsonMode(args)` reads this dispatcher used to carry.
//
// This is `inst-pd-json-mode`'s dispatcher-side half: recognizing the flag and
// handing it to the dispatched behavior, which is what "instruct the dispatched
// behavior to suppress every interactive prompt and to report any decision it
// would otherwise ask about as structured data" asks of THIS algorithm. The
// behavior's own half is the substitution each command makes on the strength of
// it — `delete`'s `CONFIRMATION_REQUIRED` in place of a stdin prompt
// (`inst-del-if-json-no-yes`), and `upgrade`'s identical substitution — each
// owned by that command's own feature, not redefined here.
//
// Nine copies of one flag test is exactly the duplication that has already
// produced defects elsewhere in this package (see `scaffold/registered-
// manifest.ts`'s header): a tenth dispatch case added later would have had to
// remember the spelling, and a case that misspelled it would silently run in
// human mode while a caller parsed for an envelope.
function parseJsonMode(args: string[]): boolean {
  return args.includes('--json');
}
// @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-json-mode
// @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-json-suppress-prompt

// Every command that recognizes a known set of flags/positionals, then
// finds leftover argv tokens, refuses them through this ONE formulation
// rather than each command re-writing the same "Unrecognized argument(s)
// for <command>: ..." envelope/stderr branch. Before this fix, most dispatch
// cases below silently DROPPED anything past what they recognized —
// `validate --project unexpected --json` returned PASS at exit 0, the extra
// `unexpected` token never even inspected — which is exactly the near-miss
// failure `list`'s own `inst-list-abort-unknown-arg` refuses rather than
// ignores.
function rejectUnrecognizedArgs(command: string, extra: string[], jsonMode: boolean, usage: string): CommandOutcome | undefined {
  if (extra.length === 0) return undefined;
  const message = `Unrecognized argument(s) for ${command}: ${extra.join(', ')}. Usage: ${usage}`;
  return jsonMode
    ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
    : { exitCode: EXIT_USER_ERROR, stderr: message };
}

// The ONE place an `ErrorCode` becomes an exit code
// (`cpt-frontx-dod-cli-invocation-exit-codes`'s "a distinct process exit
// code for each outcome class — success, user error, and internal error"):
// every code except `INTERNAL` is a user error (`EXIT_USER_ERROR`);
// `INTERNAL` alone is the internal-error class (`EXIT_INTERNAL_ERROR`).
// Every render*Outcome failure branch below calls this instead of
// re-deciding the same split under a repeated `EXIT_USER_ERROR` literal —
// which is exactly how an `INTERNAL`-coded envelope (`apply`'s staged-but-
// unregistered guard, `upgrade`'s promotion/bundle-refresh failures) used to
// report itself at exit 1, indistinguishable from an ordinary refusal.
function exitCodeForError(code: ErrorCode): ExitCode {
  return code === 'INTERNAL' ? EXIT_INTERNAL_ERROR : EXIT_USER_ERROR;
}

// Step 7 of the flow — rendering the outcome as the single envelope value
// under `--json`, or the human-readable form otherwise — is the same
// obligation `inst-pd-render` states at the algorithm's altitude, so it is
// discharged by the same collective of `render*Outcome` functions below.
// @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-render-output
// @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-render
// `inst-pd-render` — rendering the dispatched behavior's outcome as the single
// envelope value on stdout under `--json`, or the human-readable form
// otherwise — is discharged COLLECTIVELY by the `render*Outcome` functions
// below, one per dispatched behavior. There is deliberately no single generic
// renderer: `cpt-frontx-adr-cli-machine-readable-output` fixes the envelope's
// outer shape and its code vocabulary, but each command's `data` payload is its
// OWN feature's to define, so a shared renderer would either have to know every
// payload (coupling this dispatcher to every feature) or erase them into an
// untyped blob. What every one of them does share is the envelope constructors
// (`ok`/`err`) and the exit-code mapping, so the shape a caller parses is
// uniform even though the payload is not.
function renderAssembleOutcome(result: AssembleOutcome, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    return jsonMode
      ? { exitCode: exitCodeForError(result.code), stdout: JSON.stringify(err(result.code, result.message, result.details)) }
      : { exitCode: exitCodeForError(result.code), stderr: result.message };
  }
  const data = { entries: result.entries };
  const text =
    result.entries.length === 0
      ? 'Preview: nothing to apply.'
      : result.entries.map((e) => `${e.templateName} -> ${e.target}`).join('\n');
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) }
    : { exitCode: EXIT_SUCCESS, stdout: text };
}

function renderApplyOutcome(result: ApplyBatchOutcome, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    return jsonMode
      ? { exitCode: exitCodeForError(result.code), stdout: JSON.stringify(err(result.code, result.message, result.details)) }
      : { exitCode: exitCodeForError(result.code), stderr: result.message };
  }
  const data = { applied: result.applied, noop: result.noop };
  const text = `Applied ${result.applied.length} target(s); ${result.noop.length} already recorded (no-op).`;
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) }
    : { exitCode: EXIT_SUCCESS, stdout: text };
}

function renderSeedOutcome(result: SeedRepositoryOutcome, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    return jsonMode
      ? { exitCode: exitCodeForError(result.code), stdout: JSON.stringify(err(result.code, result.message, result.details)) }
      : { exitCode: exitCodeForError(result.code), stderr: result.message };
  }
  const data = { registeredDefaults: result.registeredDefaults, applied: result.applied, noop: result.noop };
  const text =
    `Seeded — registered ${result.registeredDefaults.length} default template(s); ` +
    `applied ${result.applied.length} target(s).`;
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) }
    : { exitCode: EXIT_SUCCESS, stdout: text };
}

function formatInstallResult(result: InstallCommandResult, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    // `install` used to ignore `--json` outright: it wrote a human sentence to
    // stderr and nothing at all to stdout, so a caller that asked for the
    // machine-readable form got a successful-looking empty stream and a
    // refusal it could not read. That is the exact failure the `list` dispatch
    // above refuses a near-miss flag to avoid. The code now travels the whole
    // way from the resolver, so a refused manifest reports
    // `INVALID_MANIFEST` here rather than nothing.
    const code = result.code ?? 'ORIGIN_UNAVAILABLE';
    return jsonMode
      ? { exitCode: exitCodeForError(code), stdout: JSON.stringify(err(code, result.message)) }
      : { exitCode: exitCodeForError(code), stderr: result.message };
  }
  const discoveryLine =
    result.discovery && result.discovery.triggered
      ? ` (AI-extension discovery: ${result.discovery.errorCount ?? 0} error(s))`
      : '';
  return jsonMode
    ? {
        exitCode: EXIT_SUCCESS,
        stdout: JSON.stringify(
          ok({
            message: result.message,
            ...(result.discovery === undefined ? {} : { discovery: result.discovery }),
          }),
        ),
      }
    : { exitCode: EXIT_SUCCESS, stdout: `${result.message}${discoveryLine}` };
}

// --- register/unregister/ownership rendering (cpt-frontx-dod-cli-invocation-
// json-envelope-dispatch) — the FIRST commands in this codebase to route
// their outcome through the shared `envelope.ts` shape in `--json` mode,
// rather than a bespoke shape of their own (contrast `upgrade`'s ad hoc
// `{ok,status}` line above, kept exactly as-is per this checkpoint's ADDITIVE
// scope). Human-readable mode renders the SAME data as text — one data
// model, two renderings (ADR-0042) — never a second, independently-decided
// shape.

function renderRegisterOutcome(result: RegisterOutcome, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    return jsonMode
      ? { exitCode: exitCodeForError(result.code), stdout: JSON.stringify(err(result.code, result.message, result.details)) }
      : { exitCode: exitCodeForError(result.code), stderr: result.message };
  }
  const data = { outcome: result.outcome, name: result.name, entry: result.entry };
  const text =
    result.outcome === 'noop'
      ? `Template "${result.name}" is already registered from "${result.entry.origin}"; nothing to do.`
      : result.outcome === 'created'
        ? `Registered template "${result.name}" from "${result.entry.origin}" (version ${result.entry.version}).`
        : `Replaced template "${result.name}"'s origin with "${result.entry.origin}" (version ${result.entry.version}).`;
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) }
    : { exitCode: EXIT_SUCCESS, stdout: text };
}

function renderUnregisterOutcome(result: UnregisterOutcome, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    return jsonMode
      ? { exitCode: exitCodeForError(result.code), stdout: JSON.stringify(err(result.code, result.message, result.details)) }
      : { exitCode: exitCodeForError(result.code), stderr: result.message };
  }
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok({ name: result.name })) }
    : { exitCode: EXIT_SUCCESS, stdout: `Unregistered template "${result.name}".` };
}

function renderOwnershipAddOutcome(result: OwnershipAddOutcome, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    return jsonMode
      ? { exitCode: exitCodeForError(result.code), stdout: JSON.stringify(err(result.code, result.message, result.details)) }
      : { exitCode: exitCodeForError(result.code), stderr: result.message };
  }
  const data = { outcome: result.outcome, path: result.path, projectOwnedRoots: result.projectOwnedRoots };
  const text =
    result.outcome === 'noop'
      ? `Path "${result.path}" is already project-owned; nothing to do.`
      : `Marked "${result.path}" as project-owned.`;
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) }
    : { exitCode: EXIT_SUCCESS, stdout: text };
}

function renderOwnershipRemoveOutcome(result: OwnershipRemoveOutcome, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    return jsonMode
      ? { exitCode: exitCodeForError(result.code), stdout: JSON.stringify(err(result.code, result.message)) }
      : { exitCode: exitCodeForError(result.code), stderr: result.message };
  }
  const data = { path: result.path, projectOwnedRoots: result.projectOwnedRoots };
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) }
    : { exitCode: EXIT_SUCCESS, stdout: `Removed "${result.path}" from project-owned roots (no-op if it was not present).` };
}

function renderOwnershipListOutcome(result: OwnershipListOutcome, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    return jsonMode
      ? { exitCode: exitCodeForError(result.code), stdout: JSON.stringify(err(result.code, result.message)) }
      : { exitCode: exitCodeForError(result.code), stderr: result.message };
  }
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok({ projectOwnedRoots: result.projectOwnedRoots })) }
    : {
        exitCode: EXIT_SUCCESS,
        stdout:
          result.projectOwnedRoots.length === 0
            ? 'No project-owned roots recorded.'
            : result.projectOwnedRoots.join('\n'),
      };
}

// `validate --project` — cpt-frontx-flow-composed-provenance-validate-
// project. Each error code maps to exactly the ONE `inst-valp-if-*`/
// `inst-valp-return-*` pair the flow names for it, never a generic "if
// failure" catch-all shared with a code that flow does not itself
// distinguish: `VERSION_MISMATCH`, `ORIGIN_UNAVAILABLE`, `TARGET_CONFLICT`,
// and `INVALID_PATH` are each reported through their OWN step, unlike every
// register/unregister/ownership renderer above (which has only one failure
// shape to report). `ValidateProjectErrorCode` is a CLOSED five-code union
// (narrower than `ErrorCode`).
//
// A `switch` with no `default` is not itself checked for exhaustiveness by
// TypeScript: an unhandled member simply falls out of the switch with no
// case having matched, straight into the PASS `return` two lines below —
// reported as a passing `validate --project`, over a refusal `result.ok`
// already says is `false`. The `default` branch below is what actually buys
// the exhaustiveness guarantee: assigning the narrowed `result.code` to a
// `never`-typed binding only compiles when every OTHER case has already
// excluded every member of the union, so a sixth `ValidateProjectErrorCode`
// value with no matching `case` above leaves something other than `never`
// reaching that assignment and the build fails — the guard this file has no
// other instance of yet, so this is the first, not a reuse of an existing
// pattern.
function renderValidateProjectOutcome(result: ValidateProjectOutcome, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    switch (result.code) {
      case 'PROJECT_INVALID':
        // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-if-invalid
        // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-invalid
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err(result.code, result.message, result.details)) }
          : { exitCode: EXIT_USER_ERROR, stderr: result.message };
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-invalid
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-if-invalid
      case 'VERSION_MISMATCH':
        // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-if-version-mismatch
        // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-version-mismatch
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err(result.code, result.message, result.details)) }
          : { exitCode: EXIT_USER_ERROR, stderr: result.message };
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-version-mismatch
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-if-version-mismatch
      case 'ORIGIN_UNAVAILABLE':
        // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-if-origin-unavailable
        // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-origin-unavailable
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err(result.code, result.message, result.details)) }
          : { exitCode: EXIT_USER_ERROR, stderr: result.message };
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-origin-unavailable
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-if-origin-unavailable
      case 'TARGET_CONFLICT':
        // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-if-target-conflict
        // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-target-conflict
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err(result.code, result.message, result.details)) }
          : { exitCode: EXIT_USER_ERROR, stderr: result.message };
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-target-conflict
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-if-target-conflict
      case 'INVALID_PATH':
        // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-if-invalid-path
        // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-invalid-path
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err(result.code, result.message, result.details)) }
          : { exitCode: EXIT_USER_ERROR, stderr: result.message };
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-invalid-path
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-if-invalid-path
      default: {
        // Unreachable for any of the five real codes above — reached only if
        // `ValidateProjectErrorCode` grows a member this switch was not
        // updated for, which is exactly the shape this guard exists to catch
        // at compile time rather than at PASS-branch runtime (see this
        // function's own header comment). `result.code`'s type here is
        // `never` only when every real member was already handled by a
        // `case` above; a sixth member left unhandled makes this assignment
        // a type error, not this branch's own `throw` — the throw is the
        // runtime fallback for the (otherwise unreachable) case a caller
        // constructs a `ValidateProjectOutcome` by hand rather than through
        // `commands/validate-project.ts`'s own typed return statements.
        const _exhaustive: never = result.code;
        throw new Error(`renderValidateProjectOutcome: unhandled ValidateProjectErrorCode "${String(_exhaustive)}"`);
      }
    }
  }
  // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-pass
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok({ status: 'PASS' })) }
    : { exitCode: EXIT_SUCCESS, stdout: 'PASS' };
  // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-return-pass
}

// `validate <templateDir>` (manifest-for-publication) — the only command
// that dropped `--json` on the floor entirely, rendering the SAME human
// PASS/FAIL text to stdout/stderr no matter what the caller asked for. Now
// routes through the shared envelope exactly like every other command's
// failure/success rendering above: `INVALID_MANIFEST` for a refused or
// missing manifest (the vocabulary's own code for "the manifest failed
// validation"), carrying the same violations a human reader already sees in
// `result.message`.
function renderValidateCommandOutcome(result: ValidateCommandResult, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    const details = result.violations === undefined ? undefined : { violations: result.violations };
    return jsonMode
      ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_MANIFEST', result.message, details)) }
      : { exitCode: EXIT_USER_ERROR, stderr: result.message };
  }
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok({ status: 'PASS', message: result.message })) }
    : { exitCode: EXIT_SUCCESS, stdout: result.message };
}

function renderDeleteOutcome(result: DeleteOutcome, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    return jsonMode
      ? { exitCode: exitCodeForError(result.code), stdout: JSON.stringify(err(result.code, result.message, result.details)) }
      : { exitCode: exitCodeForError(result.code), stderr: result.message };
  }
  const listText = (label: string, paths: string[]): string => `${label}:\n${paths.map((p) => `  ${p}`).join('\n') || '  (nothing)'}`;
  if (result.outcome === 'dry-run') {
    const data = { target: result.target, toDelete: result.toDelete, toPreserve: result.toPreserve };
    const text = `Dry run for "${result.target}"\n${listText('Would delete', result.toDelete)}\n${listText('Would preserve', result.toPreserve)}`;
    return jsonMode ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) } : { exitCode: EXIT_SUCCESS, stdout: text };
  }
  if (result.outcome === 'declined') {
    const data = { target: result.target, toDelete: result.toDelete, toPreserve: result.toPreserve };
    return jsonMode
      ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) }
      : { exitCode: EXIT_SUCCESS, stdout: `Deletion of "${result.target}" declined; nothing was deleted.` };
  }
  // `aiBundleResidue` is present ONLY when the deletion itself succeeded and
  // was recorded, but the CLI-owned `.frontx/ai/<name>/` bundle could not be
  // cleaned up afterwards. It is reported rather than swallowed: the outcome is
  // an honest success — the target is gone and the project state says so — but
  // one CLI-owned path survives, and a caller told nothing about it has no way
  // to learn that it is there. Absent, not `null`, in the ordinary case.
  const data = {
    target: result.target,
    toDelete: result.toDelete,
    toPreserve: result.toPreserve,
    templateName: result.templateName,
    wasLastTarget: result.wasLastTarget,
    ...(result.aiBundleResidue !== undefined ? { aiBundleResidue: result.aiBundleResidue } : {}),
  };
  const residueNote =
    result.aiBundleResidue !== undefined
      ? ` The AI-extension bundle at "${result.aiBundleResidue.path}" could not be removed: ${result.aiBundleResidue.message}`
      : '';
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) }
    : {
        exitCode: EXIT_SUCCESS,
        stdout: `Deleted "${result.target}" (${result.toDelete.length} path(s) removed).${residueNote}`,
      };
}

// `upgrade` — routes through the shared envelope exactly like `apply`/
// `delete`/`register` (ADR-0042), never the retired bespoke `{ok, status}`
// shape the old dispatch used. Every refusal, including the `--json`-
// without-`--yes` `CONFIRMATION_REQUIRED` substitution `commands/upgrade.ts`
// already applies, reports its code through this same envelope — this
// function adds no second mapping for it.
function renderUpgradeOutcome(result: UpgradeCommandOutcome, jsonMode: boolean): CommandOutcome {
  if (!result.ok) {
    return jsonMode
      ? { exitCode: exitCodeForError(result.code), stdout: JSON.stringify(err(result.code, result.message, result.details)) }
      : { exitCode: exitCodeForError(result.code), stderr: result.message };
  }
  if (result.outcome === 'noop') {
    const data = { outcome: result.outcome, at: result.at };
    return jsonMode
      ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) }
      : { exitCode: EXIT_SUCCESS, stdout: `Already at "${result.at.origin}" (version ${result.at.version}); nothing to do.` };
  }
  if (result.outcome === 'declined') {
    const data = { outcome: result.outcome, plan: renderReviewablePlan(result.plan) };
    return jsonMode
      ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) }
      : { exitCode: EXIT_SUCCESS, stdout: `Upgrade of "${result.plan.name}" declined; nothing was written.` };
  }
  const data = { outcome: result.outcome, plan: renderReviewablePlan(result.plan), reclaimedTempPaths: result.reclaimedTempPaths };
  const reclaimedNote =
    result.reclaimedTempPaths.length > 0
      ? ` Reclaimed ${result.reclaimedTempPaths.length} stale scratch file(s) left by a prior interrupted attempt.`
      : '';
  return jsonMode
    ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok(data)) }
    : {
        exitCode: EXIT_SUCCESS,
        stdout: `Upgraded "${result.plan.name}" to "${result.plan.to.origin}" (version ${result.plan.to.version}).${reclaimedNote}`,
      };
}
// @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-render
// @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-render-output

/**
 * cpt-frontx-flow-cli-invocation-run-command / cpt-frontx-algo-cli-invocation-parse-dispatch
 * — dispatches ONE recognized command to the internal component that owns
 * its behavior, by canonical flow ID, and maps the outcome to an exit code.
 * Adds no second dispatch path; redefines no command behavior.
 */
export async function runCommand(command: KnownCommand, args: string[], deps: CliDeps): Promise<CommandOutcome> {
  // Each case below both dispatches (inst-pd-dispatch) and, in the same
  // return statement, maps the dispatched behavior's outcome to an exit
  // code (inst-pd-map-outcome) and returns it (inst-pd-return-exit) — the
  // three instructions are fused at this code's granularity by design (one
  // dispatch call immediately followed by its outcome mapping and return).
  // @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-dispatch
  // @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-map-outcome
  // @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-return-exit
  switch (command) {
    // dispatch -> cpt-frontx-flow-template-resolution-install (installCommand)
    case 'install': {
      const jsonMode = parseJsonMode(args);
      const positional = args.filter((arg) => arg !== '--json');
      const [spec, ...extra] = positional;
      if (!spec) {
        const message = 'install requires a <spec> argument.';
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: message };
      }
      const extraArgsOutcome = rejectUnrecognizedArgs('install', extra, jsonMode, 'frontx install <spec> [--json]');
      if (extraArgsOutcome) return extraArgsOutcome;
      const result = await installCommand(spec, deps.inventory, deps.fetchFn);
      return formatInstallResult(result, jsonMode);
    }

    // dispatch -> cpt-frontx-flow-template-resolution-list (buildListCatalog)
    case 'list': {
      // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-check-args
      // `list` takes no positional argument and one recognized flag, so anything
      // else is refused rather than ignored. Ignoring it ran a near-miss like
      // `--jsonl` straight into the HUMAN output at exit 0 — a caller parsing
      // that stream sees a successful command and unparseable output, which is
      // worse than a refusal it can act on.
      //
      // A REPEATED `--json` is accepted, not an error: it names the same form
      // unambiguously, every mainstream CLI tolerates a repeated flag, and
      // refusing it would break a caller that appends to an argv list for no
      // gain in safety.
      //
      // `jsonMode` is read HERE, before the check, so a near-miss like
      // `--json --jsonl` still renders its own refusal as the envelope the
      // caller asked for — it used to be computed only after this check
      // returned, so `list --json --jsonl` reported the refusal on stderr
      // with nothing on stdout even though `--json` was right there in argv.
      const jsonMode = parseJsonMode(args);
      const unknownArgs = args.filter((arg) => arg !== '--json');
      const extraArgsOutcome = rejectUnrecognizedArgs('list', unknownArgs, jsonMode, 'frontx list [--json]');
      if (extraArgsOutcome) {
        // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-abort-unknown-arg
        return extraArgsOutcome;
        // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-abort-unknown-arg
      }
      // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-check-args

      // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-invoke
      const repoRoot = process.cwd();
      // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-invoke

      // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-project-invalid-check
      // A PRESENT `.frontx/project.json` that does not satisfy the project-
      // state contract refuses the listing rather than being ignored. It was
      // ignored before: `list` never read the document at all, so a project
      // whose state file had been hand-edited into invalid JSON still got
      // `ok: true` and a full listing — a caller reading that stream is told
      // the command succeeded while the state it lists against is
      // unreadable, which is the same "one absence read as two facts"
      // failure `ListEntry.manifestUnreadable` exists to prevent one level
      // down.
      //
      // ABSENCE is deliberately not a failure: `readProjectState` answers a
      // missing document with the initial empty shape (`inst-psio-absent-
      // default`), so `list` outside any project still enumerates the
      // inventory, and only a document that exists and does not parse
      // reaches the refusal below. That is exactly the distinction the step
      // draws by saying "a PRESENT `.frontx/project.json`".
      const projectState = await readProjectState(repoRoot, deps.readProjectStateFn);
      if (!projectState.ok) {
        // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-project-invalid-return
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('PROJECT_INVALID', projectState.message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: projectState.message };
        // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-project-invalid-return
      }
      // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-project-invalid-check

      // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-read
      // Three sets: the CLI's own built-in defaults (never from this project's
      // state document), this project's `templates` map, and the local
      // inventory entries not yet registered to it (`1.5 Machine-Readable
      // Catalog Envelope`).
      const catalog = await buildListCatalog(projectState.document.templates, deps.inventory, {
        fetchFn: deps.fetchFn,
        canonicalizeFn: deps.createCanonicalizeTargetFn(repoRoot),
        existsFn: deps.existsFn,
        listFolderFilesFn: deps.listFolderFilesFn,
        readFileFn: deps.readFileFn,
        repoRoot,
      });
      // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-read

      // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-format-machine
      // ONE JSON line in the envelope F10 §1.5 fixes, matching the `frontx
      // upgrade --json` handshake's final result line, so the AI Tooling
      // Framework's kit obtains the selectable set over the same command
      // surface it already speaks (DESIGN §3.4) and never by reading this CLI's
      // inventory storage. An empty inventory is three empty collections, not
      // the human-facing message.
      if (jsonMode) {
        // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-return
        return { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(listCatalogEnvelope(catalog)) };
        // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-return
      }
      // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-format-machine

      // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-format
      // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-empty-check
      // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-empty-return
      // @cpt-begin:cpt-frontx-flow-template-resolution-list:p1:inst-list-return
      return { exitCode: EXIT_SUCCESS, stdout: formatListHuman(catalog) };
      // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-return
      // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-empty-return
      // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-empty-check
      // @cpt-end:cpt-frontx-flow-template-resolution-list:p1:inst-list-format
    }

    // dispatch -> cpt-frontx-flow-template-resolution-update-local (updateLocalCommand)
    case 'update-local': {
      const jsonMode = parseJsonMode(args);
      const positional = args.filter((arg) => arg !== '--json');
      const [name, spec, ...extra] = positional;
      if (!name || !spec) {
        const message = 'update-local requires <identity> and <spec> arguments.';
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: message };
      }
      const extraArgsOutcome = rejectUnrecognizedArgs(
        'update-local',
        extra,
        jsonMode,
        'frontx update-local <identity> <spec> [--json]',
      );
      if (extraArgsOutcome) return extraArgsOutcome;
      const result = await updateLocalCommand(name, spec, deps.inventory, deps.fetchFn);
      if (!result.ok) {
        // The last command in the surface to gain the envelope. Its refusals
        // already carried a code from the inventory; there was simply no
        // machine-readable form for them to travel in.
        const code = result.code ?? 'ORIGIN_UNAVAILABLE';
        return jsonMode
          ? { exitCode: exitCodeForError(code), stdout: JSON.stringify(err(code, result.message)) }
          : { exitCode: exitCodeForError(code), stderr: result.message };
      }
      return jsonMode
        ? { exitCode: EXIT_SUCCESS, stdout: JSON.stringify(ok({ message: result.message })) }
        : { exitCode: EXIT_SUCCESS, stdout: result.message };
    }

    // dispatch -> cpt-frontx-flow-template-manifest-validate-for-publication (validateCommand)
    // dispatch -> cpt-frontx-flow-composed-provenance-validate-project (validateProject)
    case 'validate': {
      const jsonMode = parseJsonMode(args);

      // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-invoke
      if (args.includes('--project')) {
        // No explicit project-root argument on this flow's own signature
        // (`validate --project`) — mirrors `register`/`unregister`/
        // `ownership`: it operates on the project the developer is standing
        // in, exactly as `.frontx/project.json` is always resolved relative
        // to.
        const repoRoot = process.cwd();
        // `validate --project` used to tolerate anything past `--project`/
        // `--json` — `validate --project unexpected --json` returned PASS at
        // exit 0, `unexpected` never even inspected. Refused here exactly as
        // every other command's own flags/positionals are.
        const extra = args.filter((a) => a !== '--project' && a !== '--json');
        const extraArgsOutcome = rejectUnrecognizedArgs('validate --project', extra, jsonMode, 'frontx validate --project [--json]');
        if (extraArgsOutcome) return extraArgsOutcome;
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-invoke
        // @cpt-begin:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-run-algorithm
        const result = await validateProject(repoRoot, {
          readProjectStateFn: deps.readProjectStateFn,
          canonicalizeFn: deps.createCanonicalizeTargetFn(repoRoot),
          existsFn: deps.existsFn,
          listFolderFilesFn: deps.listFolderFilesFn,
          readFileFn: deps.readFileFn,
          fetchFn: deps.fetchFn,
        });
        // @cpt-end:cpt-frontx-flow-composed-provenance-validate-project:p1:inst-valp-run-algorithm
        // The granular `inst-valp-if-*`/`inst-valp-return-*` discrimination
        // (one pair per error code, plus the PASS return) lives INSIDE
        // `renderValidateProjectOutcome` itself, not here: that function is
        // where the actual branch on `result.code` happens, so marking it
        // there is where the marker is honest about which line runs for
        // which finding, rather than wrapping this one generic call site
        // with all five possible outcomes at once.
        return renderValidateProjectOutcome(result, jsonMode);
      }

      const positional = args.filter((a) => a !== '--json');
      const [templateDir, ...extra] = positional;
      if (!templateDir) {
        const message = 'validate requires a <templateDir> argument.';
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: message };
      }
      const extraArgsOutcome = rejectUnrecognizedArgs('validate', extra, jsonMode, 'frontx validate <templateDir> [--json]');
      if (extraArgsOutcome) return extraArgsOutcome;
      // `validate <templateDir>` used to ignore `--json` entirely — it always
      // wrote its human PASS/FAIL sentence to stdout/stderr regardless, so a
      // caller asking for the envelope got human text with no `ok`
      // discriminant to parse. Routed through the same envelope every other
      // command's `--json` mode already uses (ADR-0042).
      const result = await validateCommand(templateDir, deps.readFileFn, deps.listPayloadFilesFn, deps.resolveDeclaredExclusionFn);
      return renderValidateCommandOutcome(result, jsonMode);
    }

    // dispatch -> cpt-frontx-flow-cli-scaffolding-assemble-preview (assembleBatch)
    case 'assemble': {
      const jsonMode = parseJsonMode(args);
      const { value: inputRaw, rest } = extractFlagValue(args, '--input');
      if (inputRaw === undefined) {
        const message = 'assemble requires --input <batch-json>.';
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: message };
      }
      const extra = rest.filter((a) => a !== '--json');
      const extraArgsOutcome = rejectUnrecognizedArgs('assemble', extra, jsonMode, 'frontx assemble --input <batch-json> [--json]');
      if (extraArgsOutcome) return extraArgsOutcome;
      const parsedBatch = parseBatchInput(inputRaw);
      if (!parsedBatch.ok) {
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', parsedBatch.message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: parsedBatch.message };
      }
      const repoRoot = process.cwd();
      const canonicalizeFn = deps.createCanonicalizeTargetFn(repoRoot);
      const result = await assembleBatch(
        parsedBatch.batch,
        repoRoot,
        {
          inventory: deps.inventory,
          fetchFn: deps.fetchFn,
          readFileFn: deps.readFileFn,
          canonicalizeFn,
          existsFn: deps.existsFn,
          listFolderFilesFn: deps.listFolderFilesFn,
          resolveInstalledContentPathFn: deps.resolveInstalledContentPathFn,
        },
        deps.readProjectStateFn,
      );
      return renderAssembleOutcome(result, jsonMode);
    }

    // dispatch -> cpt-frontx-flow-cli-scaffolding-seed-repository (seedRepository)
    case 'seed': {
      const jsonMode = parseJsonMode(args);
      const adoptExisting = args.includes('--adopt-existing');
      const { value: inputRaw, rest: afterInput } = extractFlagValue(args, '--input');
      const [dir, ...extra] = afterInput.filter((a) => a !== '--json' && a !== '--adopt-existing');
      if (!dir) {
        const message = 'seed requires a <dir> argument.';
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: message };
      }
      if (inputRaw === undefined) {
        const message = 'seed requires --input <batch-json>.';
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: message };
      }
      const extraArgsOutcome = rejectUnrecognizedArgs(
        'seed',
        extra,
        jsonMode,
        'frontx seed <dir> --input <batch-json> [--adopt-existing] [--json]',
      );
      if (extraArgsOutcome) return extraArgsOutcome;
      const parsedBatch = parseBatchInput(inputRaw);
      if (!parsedBatch.ok) {
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', parsedBatch.message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: parsedBatch.message };
      }
      // Resolved at this boundary, as `apply` below also does, so every
      // refusal quotes back the same form of the path a developer typed —
      // a developer who typed `.` is told which directory was refused
      // rather than shown their own shorthand reflected at them.
      const targetDir = path.resolve(dir);
      // A missing `<dir>`, or one that names an existing FILE, would
      // otherwise reach `deps.createCanonicalizeTargetFn(targetDir)`/
      // `seedRepository` several seams deep before failing on a raw,
      // uncaught `fs` throw — surfacing as exit 2 (the internal-error
      // class) with an EMPTY stdout under `--json`, never the single
      // envelope `--json` mode owes every caller. A caller-supplied path
      // that does not exist, or is not a directory, is an ordinary user
      // error, refused here — before any other seam is even constructed —
      // with the vocabulary this codebase already uses for an unusable
      // path.
      // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-invalid-dir
      const targetDirState = await deps.readSeedDirStateFn(targetDir);
      if (targetDirState !== 'directory') {
        // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-invalid-dir
        const message = `"${targetDir}" does not exist or is not a directory; seed requires an existing directory.`;
        return renderSeedOutcome({ ok: false, code: 'INVALID_PATH', message, details: { dir: targetDir } }, jsonMode);
        // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-invalid-dir
      }
      // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-invalid-dir
      const canonicalizeFn = deps.createCanonicalizeTargetFn(targetDir);
      const result = await seedRepository(targetDir, parsedBatch.batch, adoptExisting, {
        inventory: deps.inventory,
        fetchFn: deps.fetchFn,
        readFileFn: deps.readFileFn,
        canonicalizeFn,
        existsFn: deps.existsFn,
        listFolderFilesFn: deps.listFolderFilesFn,
        resolveInstalledContentPathFn: deps.resolveInstalledContentPathFn,
        readInstalledContentFn: deps.createReadInstalledContentFn(targetDir),
        readExistingContentFn: deps.createReadExistingContentFn(targetDir),
        writeFileFn: deps.writeFileFn,
        readProjectStateFn: deps.readProjectStateFn,
        writeProjectStateFn: deps.writeProjectStateFn,
        bundleExistsFn: createFsBundleExistsFn(),
        copyBundleFn: createFsCopyBundleFn(),
        removeBundleFn: createFsRemoveBundleFn(),
        assertPathWithinRootFn: deps.createAssertPathWithinRootFn(targetDir),
        removeProjectFileFn: deps.removeProjectFile,
        removeEmptyDirFn: deps.removeEmptyDirFn,
      });
      return renderSeedOutcome(result, jsonMode);
    }

    // dispatch -> cpt-frontx-flow-cli-scaffolding-add-template (runApplyPipeline)
    case 'apply': {
      const jsonMode = parseJsonMode(args);
      const adoptExisting = args.includes('--adopt-existing');
      const { value: inputRaw, rest } = extractFlagValue(args, '--input');
      if (inputRaw === undefined) {
        const message = 'apply requires --input <batch-json>.';
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: message };
      }
      const extra = rest.filter((a) => a !== '--json' && a !== '--adopt-existing');
      const extraArgsOutcome = rejectUnrecognizedArgs(
        'apply',
        extra,
        jsonMode,
        'frontx apply --input <batch-json> [--adopt-existing] [--json]',
      );
      if (extraArgsOutcome) return extraArgsOutcome;
      const parsedBatch = parseBatchInput(inputRaw);
      if (!parsedBatch.ok) {
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', parsedBatch.message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: parsedBatch.message };
      }
      // No explicit project-root argument on this command's own FEATURE
      // flow signature — it operates on the project the developer is
      // standing in, exactly as `register`/`unregister`/`ownership`/
      // `delete` already do.
      const repoRoot = process.cwd();
      const canonicalizeFn = deps.createCanonicalizeTargetFn(repoRoot);
      const pipelineDeps: ApplyPipelineDeps = {
        inventory: deps.inventory,
        fetchFn: deps.fetchFn,
        readFileFn: deps.readFileFn,
        canonicalizeFn,
        existsFn: deps.existsFn,
        listFolderFilesFn: deps.listFolderFilesFn,
        resolveInstalledContentPathFn: deps.resolveInstalledContentPathFn,
        readInstalledContentFn: deps.createReadInstalledContentFn(repoRoot),
        readExistingContentFn: deps.createReadExistingContentFn(repoRoot),
        writeFileFn: deps.writeFileFn,
        readProjectStateFn: deps.readProjectStateFn,
        writeProjectStateFn: deps.writeProjectStateFn,
        bundleExistsFn: createFsBundleExistsFn(),
        copyBundleFn: createFsCopyBundleFn(),
        removeBundleFn: createFsRemoveBundleFn(),
        assertPathWithinRootFn: deps.createAssertPathWithinRootFn(repoRoot),
        // The rollback pair `runApplyPipeline` undoes its OWN writes with
        // when a refusal lands after materialization has already begun
        // (`inst-add-rollback-writes`) — the same two `CliDeps` values
        // `seed`'s dispatch above already passes, never a second pair of
        // adapters built here: both commands roll back through one shared
        // helper (`commands/apply.ts`'s `rollbackWrittenPaths`), so they
        // must remove files and prune emptied directories the identical
        // way.
        removeProjectFileFn: deps.removeProjectFile,
        removeEmptyDirFn: deps.removeEmptyDirFn,
      };
      const result = await runApplyPipeline(parsedBatch.batch, repoRoot, adoptExisting, pipelineDeps);
      return renderApplyOutcome(result, jsonMode);
    }

    // dispatch -> cpt-frontx-feature-composed-provenance (registerTemplate)
    // @cpt-begin:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-invoke
    case 'register': {
      // Flags are filtered out BEFORE taking the positional argument —
      // `register --json` (origin omitted) must still be recognized as
      // missing its `<origin>`, not silently treat the flag token itself
      // as the origin.
      const jsonMode = parseJsonMode(args);
      const replace = args.includes('--replace');
      const [origin, ...extra] = args.filter((a) => a !== '--json' && a !== '--replace');
      if (!origin) {
        const message = 'register requires an <origin> argument.';
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: message };
      }
      const extraArgsOutcome = rejectUnrecognizedArgs('register', extra, jsonMode, 'frontx register <origin> [--replace] [--json]');
      if (extraArgsOutcome) return extraArgsOutcome;
      // No explicit project-root argument on this command's own FEATURE
      // flow signature (`register <origin>`) — it operates on the project
      // the developer is standing in, exactly as `.frontx/project.json`
      // is always resolved relative to.
      const repoRoot = process.cwd();
      // @cpt-end:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-invoke
      // @cpt-begin:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-run-algorithm
      const result = await registerTemplate(
        origin,
        replace,
        repoRoot,
        deps.inventory,
        deps.fetchFn,
        deps.readFileFn,
        deps.createCanonicalizeTargetFn(repoRoot),
        deps.readProjectStateFn,
        deps.writeProjectStateFn,
        deps.existsFn,
        deps.listFolderFilesFn,
      );
      // @cpt-end:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-run-algorithm
      // @cpt-begin:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-if-failure
      // @cpt-begin:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-return-failure
      // @cpt-begin:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-if-outcome
      // @cpt-begin:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-return-outcome
      return renderRegisterOutcome(result, jsonMode);
      // @cpt-end:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-return-outcome
      // @cpt-end:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-if-outcome
      // @cpt-end:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-return-failure
      // @cpt-end:cpt-frontx-flow-composed-provenance-register-template:p1:inst-reg-if-failure
    }

    // dispatch -> cpt-frontx-feature-composed-provenance (unregisterTemplate)
    // @cpt-begin:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-invoke
    case 'unregister': {
      const jsonMode = parseJsonMode(args);
      const [name, ...extra] = args.filter((a) => a !== '--json');
      if (!name) {
        const message = 'unregister requires a <name> argument.';
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: message };
      }
      const extraArgsOutcome = rejectUnrecognizedArgs('unregister', extra, jsonMode, 'frontx unregister <name> [--json]');
      if (extraArgsOutcome) return extraArgsOutcome;
      const repoRoot = process.cwd();
      // @cpt-end:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-invoke
      // @cpt-begin:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-run-algorithm
      const result = await unregisterTemplate(name, repoRoot, deps.readProjectStateFn, deps.writeProjectStateFn);
      // @cpt-end:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-run-algorithm
      // @cpt-begin:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-if-not-registered
      // @cpt-begin:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-return-not-registered
      // @cpt-begin:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-if-targets
      // @cpt-begin:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-return-targets
      // @cpt-begin:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-else
      // @cpt-begin:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-return-success
      return renderUnregisterOutcome(result, jsonMode);
      // @cpt-end:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-return-success
      // @cpt-end:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-else
      // @cpt-end:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-return-targets
      // @cpt-end:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-if-targets
      // @cpt-end:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-return-not-registered
      // @cpt-end:cpt-frontx-flow-composed-provenance-unregister-template:p1:inst-unreg-if-not-registered
    }

    // dispatch -> cpt-frontx-feature-composed-provenance (ownershipAdd / ownershipRemove / ownershipList)
    case 'ownership': {
      // `--json` is recognized wherever it falls in `args` — including
      // BEFORE the sub-command (`ownership --json add docs`) — rather than
      // only among the tokens after the first one: taking it from `rest`
      // alone made `--json` itself get destructured into `sub`, so it never
      // matched `add`/`remove`/`list` and this command fell through to the
      // human-readable "unrecognized sub-command" branch even though the
      // caller asked for the machine envelope — the ADR's "exactly one JSON
      // value on stdout" guarantee failing silently for that spelling,
      // confirmed live before this fix.
      const jsonMode = parseJsonMode(args);
      const [sub, ...positional] = args.filter((a) => a !== '--json');
      const repoRoot = process.cwd();

      switch (sub) {
        // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-invoke
        case 'add': {
          const [rawPath, ...extra] = positional;
          if (!rawPath) {
            const message = 'ownership add requires a <path> argument.';
            return jsonMode
              ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
              : { exitCode: EXIT_USER_ERROR, stderr: message };
          }
          const extraArgsOutcome = rejectUnrecognizedArgs('ownership add', extra, jsonMode, 'frontx ownership add <path> [--json]');
          if (extraArgsOutcome) return extraArgsOutcome;
          const canonicalizeFn = deps.createCanonicalizeTargetFn(repoRoot);
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-invoke
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-run-algorithm
          const result = await ownershipAdd(
            rawPath,
            repoRoot,
            deps.inventory,
            deps.readTargetPathStateFn,
            canonicalizeFn,
            deps.readProjectStateFn,
            deps.writeProjectStateFn,
            deps.readFileFn,
          );
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-run-algorithm
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-if-missing
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-return-missing
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-if-conflict
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-return-conflict
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-else
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-return-success
          return renderOwnershipAddOutcome(result, jsonMode);
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-return-success
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-else
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-return-conflict
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-if-conflict
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-return-missing
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-add:p1:inst-oadd-if-missing
        }

        // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-remove:p1:inst-orem-invoke
        case 'remove': {
          const [rawPath, ...extra] = positional;
          if (!rawPath) {
            const message = 'ownership remove requires a <path> argument.';
            return jsonMode
              ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
              : { exitCode: EXIT_USER_ERROR, stderr: message };
          }
          const extraArgsOutcome = rejectUnrecognizedArgs('ownership remove', extra, jsonMode, 'frontx ownership remove <path> [--json]');
          if (extraArgsOutcome) return extraArgsOutcome;
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-remove:p1:inst-orem-invoke
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-remove:p1:inst-orem-run-algorithm
          const result = await ownershipRemove(
            rawPath,
            repoRoot,
            deps.createCanonicalizeTargetFn(repoRoot),
            deps.readProjectStateFn,
            deps.writeProjectStateFn,
          );
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-remove:p1:inst-orem-run-algorithm
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-remove:p1:inst-orem-return-success
          return renderOwnershipRemoveOutcome(result, jsonMode);
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-remove:p1:inst-orem-return-success
        }

        // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-invoke
        case 'list': {
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-invoke
          const extraArgsOutcome = rejectUnrecognizedArgs('ownership list', positional, jsonMode, 'frontx ownership list [--json]');
          if (extraArgsOutcome) return extraArgsOutcome;
          const result = await ownershipList(repoRoot, deps.readProjectStateFn);
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-if-invalid
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-return-invalid
          // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-return-roots
          return renderOwnershipListOutcome(result, jsonMode);
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-return-roots
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-return-invalid
          // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-if-invalid
        }

        default: {
          const message = `Unrecognized ownership subcommand: "${sub ?? ''}". Usage: frontx ownership add|remove|list <path>`;
          return jsonMode
            ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
            : { exitCode: EXIT_USER_ERROR, stderr: message };
        }
      }
    }

    // dispatch -> cpt-frontx-feature-cli-scaffolding (deleteTarget)
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-invoke
    case 'delete': {
      const jsonMode = parseJsonMode(args);
      const dryRun = args.includes('--dry-run');
      const yes = args.includes('--yes');
      const [target, ...extra] = args.filter((a) => a !== '--json' && a !== '--dry-run' && a !== '--yes');
      if (!target) {
        const message = 'delete requires a <target> argument.';
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: message };
      }
      const extraArgsOutcome = rejectUnrecognizedArgs(
        'delete',
        extra,
        jsonMode,
        'frontx delete <target> [--dry-run] [--json [--yes]]',
      );
      if (extraArgsOutcome) return extraArgsOutcome;
      const deleteYesOutcome = rejectYesWithoutJson('delete', jsonMode, yes);
      if (deleteYesOutcome) return deleteYesOutcome;
      // No explicit project-root argument on this command's own FEATURE
      // flow signature (`delete <target>`) — operates on the project the
      // developer is standing in, exactly as `register`/`unregister`/
      // `ownership` already do.
      const repoRoot = process.cwd();
      const canonicalizeFn = deps.createCanonicalizeTargetFn(repoRoot);
      // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-invoke
      // `scaffold/ai-bundle.ts` landed after `commands/delete.ts` was
      // written, so this closure is the one wire that module's own header
      // comment said was still missing: adapting its three-seam
      // `materializeOrRemoveAiBundle` algorithm down to `delete.ts`'s own
      // simple `RemoveAiBundleFn` shape, fixed to the `LAST_TARGET_LOST`
      // transition — the only one `delete` ever triggers.
      const removeAiBundleFn: RemoveAiBundleFn = async (manifestName) => {
        await materializeOrRemoveAiBundle({
          manifestName,
          transition: { kind: 'LAST_TARGET_LOST' },
          projectRoot: repoRoot,
          bundleExists: createFsBundleExistsFn(),
          copyBundle: createFsCopyBundleFn(),
          removeBundle: createFsRemoveBundleFn(),
        });
      };
      const result = await deleteTarget(
        target,
        repoRoot,
        { jsonMode, dryRun, yes },
        deps.inventory,
        canonicalizeFn,
        deps.listTargetFilesFn,
        // The ground inside a target that cannot be enumerated as a regular
        // file — a FIFO, a socket, a device, a dangling symlink. It survives
        // the deletion, so the plan names it in `toPreserve` rather than
        // leaving it in neither list.
        deps.listUnenumerableTargetEntriesFn,
        deps.readFileFn,
        deps.removeProjectFile,
        deps.createAssertPathWithinRootFn(repoRoot),
        deps.readProjectStateFn,
        deps.writeProjectStateFn,
        deps.confirmDeletion,
        removeAiBundleFn,
      );
      return renderDeleteOutcome(result, jsonMode);
    }
    // dispatch -> cpt-frontx-flow-upgrade-changeset-review-approval /
    // cpt-frontx-flow-upgrade-changeset-restore (upgradeCommand)
    case 'upgrade': {
      // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-invoke-upgrade
      // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-invoke
      const jsonMode = parseJsonMode(args);
      const yes = args.includes('--yes');
      const restore = args.includes('--restore');
      const [templateName, newOrigin, ...extra] = args.filter((a) => a !== '--json' && a !== '--yes' && a !== '--restore');
      if (!templateName) {
        const message = 'upgrade requires a <templateName> argument.';
        return jsonMode
          ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
          : { exitCode: EXIT_USER_ERROR, stderr: message };
      }
      const extraArgsOutcome = rejectUnrecognizedArgs(
        'upgrade',
        extra,
        jsonMode,
        'frontx upgrade <templateName> <new-origin>|--restore [--json [--yes]]',
      );
      if (extraArgsOutcome) return extraArgsOutcome;
      const upgradeYesOutcome = rejectYesWithoutJson('upgrade', jsonMode, yes);
      if (upgradeYesOutcome) return upgradeYesOutcome;
      // Argument shape CHANGED from the retired engine's own `<projectRoot>
      // <targetVersion>`: this is `<templateName> <new-origin>` XOR
      // `<templateName> --restore`, with NO origin argument for restore
      // (`cpt-frontx-dod-upgrade-changeset-rollback`'s own text).
      let direction: UpgradeDirection;
      if (restore) {
        if (newOrigin !== undefined) {
          const message = 'upgrade --restore takes no <new-origin> argument.';
          return jsonMode
            ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
            : { exitCode: EXIT_USER_ERROR, stderr: message };
        }
        direction = { kind: 'restore' };
      } else {
        if (newOrigin === undefined) {
          const message = 'upgrade requires either a <new-origin> argument or --restore.';
          return jsonMode
            ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
            : { exitCode: EXIT_USER_ERROR, stderr: message };
        }
        direction = { kind: 'forward', newOrigin };
      }

      // No explicit project-root argument on this command's own FEATURE flow
      // signature (`upgrade <templateName> ...`) — it operates on the
      // project the developer is standing in, exactly as `apply`/`register`/
      // `unregister`/`ownership`/`delete` already do.
      const repoRoot = process.cwd();
      const canonicalizeFn = deps.createCanonicalizeTargetFn(repoRoot);
      // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-invoke
      // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-invoke-upgrade

      const resolvePayload = createResolvePayloadFn({
        repoRoot,
        fetchFn: deps.fetchFn,
        readFileFn: deps.readFileFn,
        listDiskFiles: createFsListDiskFilesFn(),
        existsFn: deps.existsFn,
        canonicalizeFn,
      });

      // Manifest-only resolution of ANOTHER registered template's declared
      // exclusions (`upgrade/validate.ts`'s own `ValidateInput.
      // resolveRegisteredExclusions` doc comment) — deliberately NOT
      // `resolvePayload`, which would resolve that other template's ENTIRE
      // payload for every target of THIS upgrade, defeating
      // `cpt-frontx-cli-nfr-template-scale`'s per-template independence.
      // `name`/`origin` here name an OTHER registered template than the one
      // being upgraded — its manifest failing to read (`{ known: false }`)
      // must never block THIS upgrade (`cpt-frontx-cli-nfr-template-scale`'s
      // per-template independence); joining `[]` can only make that other
      // template's nesting claim WIDER, never silently permit a conflict.
      const resolveRegisteredExclusions = async (name: string, origin: string): Promise<string[]> => {
        const resolution = await resolveRegisteredExcludedSubtrees(name, origin, {
          repoRoot,
          inventory: deps.inventory,
          readFileFn: deps.readFileFn,
          canonicalizeFn,
        });
        return resolution.known ? resolution.excludedSubtrees : [];
      };

      // `inst-com-replace-inventory` — promotes the committed transition's
      // candidate content into `name`'s own local-inventory slot, through
      // the SAME bounded-update mechanism `update-local` already drives
      // (`TemplateInventory.updateLocal`), never a second "write into the
      // inventory" formulation. A LOCAL `path:` origin has no inventory slot
      // at all — its payload is read live from its own folder on every
      // resolution (`upgrade/payload.ts`'s own header) — and a name never
      // installed into the inventory in the first place (every real
      // template in this ecosystem today is `path:`-registered, per that
      // same header) has nothing cached there either; both are correct
      // no-ops, never a promotion failure.
      const promoteInventory = async (name: string): Promise<void> => {
        const stateResult = await readProjectState(repoRoot, deps.readProjectStateFn);
        if (!stateResult.ok) {
          throw new Error(`"${name}"'s committed entry could not be re-read for inventory promotion: ${stateResult.message}`);
        }
        const entry = stateResult.document.templates[name];
        if (entry === undefined) {
          throw new Error(`"${name}" has no entry in the project state store immediately after its own commit.`);
        }
        if (entry.origin.startsWith('path:')) return; // local origin: no inventory slot to promote into
        if (deps.inventory.lookup(name) === undefined) return; // never installed into the inventory either
        const updated = await deps.inventory.updateLocal(name, entry.origin, deps.fetchFn);
        if (!updated.ok) {
          throw new Error(`"${name}"'s local inventory slot could not be replaced: ${updated.error.message}`);
        }
      };

      // `inst-com-refresh-bundle` — refreshes `name`'s CLI-owned
      // `.frontx/ai/<manifestName>/` bundle through the SAME step
      // `apply`/`delete` already use (`cpt-frontx-algo-cli-scaffolding-ai-
      // bundle`), never a second bundle mechanism.
      // `materializeOrRemoveAiBundle`'s transition union has no dedicated
      // "refresh" kind, so this reuses `FIRST_TARGET_GAINED`, which
      // `createFsCopyBundleFn`'s `fs.cpSync(recursive)` satisfies because it
      // OVERWRITES an existing destination file for every file it copies.
      //
      // ONE KNOWN LIMITATION remains, and it is spec-permitted: if the new
      // payload carries NO bundle at all, the remove-then-materialize below
      // clears the project bundle and then no-ops, so the name ends up with no
      // AI surface rather than the previous version's. That is the honest
      // reading of a version that declares none — and the FEATURE scopes the
      // refresh requirement to an upgrade "whose payload carries a new
      // bundle", saying nothing about preserving an older one a new version
      // dropped. Recorded so the next reader inherits the analysis rather than
      // the surprise.
      const refreshAiBundle = async (name: string): Promise<void> => {
        const stateResult = await readProjectState(repoRoot, deps.readProjectStateFn);
        if (!stateResult.ok) {
          throw new Error(`"${name}"'s committed entry could not be re-read for the AI-bundle refresh: ${stateResult.message}`);
        }
        const entry = stateResult.document.templates[name];
        if (entry === undefined) {
          throw new Error(`"${name}" has no entry in the project state store immediately after its own commit.`);
        }
        // A `canonicalizeFn` failure THROWS rather than degrading: `?? ''`
        // silently collapsed `installedContentPath` to `repoRoot`, which turns
        // the bundle refresh into a self-copy of the project root onto itself
        // — a nonsensical operation reported as success. A throw here is
        // caught by `commitUpgrade`'s own post-commit bundle handler and
        // reported as `INTERNAL` naming the bundle, with the transition
        // standing, which is exactly the outcome the FEATURE defines for a
        // refresh that could not land (`inst-com-if-bundle-refresh-fails`).
        let installedContentPath: string;
        if (entry.origin.startsWith('path:')) {
          const canonical = canonicalizeFn(entry.origin.slice('path:'.length));
          if (canonical === null) {
            throw new Error(
              `"${name}"'s local origin "${entry.origin}" could not be proven to stay inside the project root, ` +
                'so its AI-extension bundle could not be refreshed.',
            );
          }
          installedContentPath = path.join(repoRoot, canonical);
        } else {
          installedContentPath = deps.resolveInstalledContentPathFn(name);
        }
        const bundleExists = createFsBundleExistsFn();
        const copyBundle = createFsCopyBundleFn();
        const removeBundle = createFsRemoveBundleFn();

        // A refresh is REMOVE-then-materialize, composed from the two
        // transitions `cpt-frontx-algo-cli-scaffolding-ai-bundle` already
        // owns, rather than a copy alone.
        //
        // `createFsCopyBundleFn` uses `fs.cpSync(recursive)`, which overwrites
        // and adds but never REMOVES — so a copy alone left behind every file
        // the previous bundle carried and the new one dropped, which is a
        // PARTIAL refresh, not the refresh this name's DoD requires
        // (`cpt-frontx-dod-cli-scaffolding-ai-bundle`: the system "MUST
        // refresh it when `upgrade` commits a new version of the name whose
        // payload carries a new bundle"). Clearing first makes the result
        // exactly the new payload's bundle, which is what "refresh" means.
        //
        // Deliberately composed HERE, at the wiring layer, rather than by
        // adding a transition kind to that algorithm: the FEATURE requires an
        // upgrade refresh go "through the same CLI-owned step `apply` and
        // `delete` use", and both halves of this are that step. The ordering
        // cost is stated rather than hidden — if the materialize half fails
        // after the remove half landed, the bundle is absent rather than
        // stale, which `commitUpgrade`'s post-commit handler reports as
        // `INTERNAL` naming the bundle while the transition itself stands.
        // That is the right trade: the FEATURE states the bundle is
        // re-derivable from the installed content path whenever something next
        // refreshes it, so an absent bundle is recoverable, while a silently
        // stale one misreports the version's AI surface indefinitely.
        //
        // The remove half is a no-op when no project bundle exists yet (the
        // ordinary first-refresh case), so this costs nothing in the common
        // path.
        await materializeOrRemoveAiBundle({
          manifestName: name,
          transition: { kind: 'LAST_TARGET_LOST' },
          projectRoot: repoRoot,
          bundleExists,
          copyBundle,
          removeBundle,
        });
        await materializeOrRemoveAiBundle({
          manifestName: name,
          transition: { kind: 'FIRST_TARGET_GAINED', installedContentPath },
          projectRoot: repoRoot,
          bundleExists,
          copyBundle,
          removeBundle,
        });
      };

      const engineDeps: Omit<UpgradeEngineDeps, 'presentPlan'> = {
        repoRoot,
        readProjectStateFn: deps.readProjectStateFn,
        writeProjectStateFn: deps.writeProjectStateFn,
        resolvePayload,
        resolveRegisteredExclusions,
        readDiskEntry: createFsReadDiskEntryFn(),
        writeDiskFile: createFsWriteDiskFileFn(repoRoot),
        renameDiskFile: createFsRenameDiskFileFn(repoRoot),
        unlinkDiskFile: createFsUnlinkDiskFileFn(repoRoot),
        listDiskFiles: createFsListDiskFilesFn(),
        canonicalizeFn,
        promoteInventory,
        refreshAiBundle,
      };

      const result = await upgradeCommand(
        templateName,
        direction,
        { jsonMode, yes },
        engineDeps,
        deps.presentUpgradePlan,
      );
      return renderUpgradeOutcome(result, jsonMode);
    }
  }
  // @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-return-exit
  // @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-map-outcome
  // @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-dispatch

  /* c8 ignore next -- exhaustive KnownCommand switch above always returns */
  throw new Error(`Unreachable: no dispatch case for command "${command as string}".`);
}

/**
 * cpt-frontx-flow-cli-invocation-help / cpt-frontx-algo-cli-invocation-parse-dispatch
 * — produces the usage summary for no-command, explicit help, and
 * unrecognized-command invocations, mapping each to its exit code.
 */
export function helpOutcome(parsed: ParsedInvocation): CommandOutcome {
  // @cpt-begin:cpt-frontx-flow-cli-invocation-help:p1:inst-help-invoke
  // entry: run() deferred here for no command, an explicit help request, or
  // an unrecognized command token (parsed by parseInvocation above).
  // @cpt-end:cpt-frontx-flow-cli-invocation-help:p1:inst-help-invoke

  // @cpt-begin:cpt-frontx-flow-cli-invocation-help:p1:inst-help-usage
  // @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-return-help
  const usage = usageText();
  // @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-return-help
  // @cpt-end:cpt-frontx-flow-cli-invocation-help:p1:inst-help-usage

  if (parsed.helpRequested) {
    // `help`/`-h`/`--help` were the one dispatchable request left tolerating
    // trailing garbage — `frontx help extra` used to exit 0 and print usage
    // with `extra` never even inspected, the identical near-miss every OTHER
    // command's own `rejectUnrecognizedArgs` call already refuses (`list`'s
    // `inst-list-abort-unknown-arg` precedent). Bare `frontx` produces an
    // empty `parsed.args`, so this never fires for the no-command case.
    //
    // `--json` is refused here too, rather than tolerated and ignored, and
    // that is a deliberate choice between two coherent surfaces rather than
    // an oversight. `help` is the one dispatchable request with no result to
    // render: its output IS the usage prose, and wrapping a block of prose
    // in `{"ok": true, "data": {...}}` gives an agent nothing to branch on —
    // so `help` does not appear in `usageText()` above with a `[--json]` of
    // its own, and `cpt-frontx-adr-cli-machine-readable-output`'s contract is
    // scoped to "every command SUPPORTING `--json`". Tolerating the flag
    // while still printing plain text would leave the one invocation on this
    // whole surface that answers `--json` with something no parser can read;
    // refusing it says so in the envelope itself, since `jsonMode` is read
    // BEFORE the refusal is built and the refusal is therefore rendered as
    // one — an agent that appends `--json` to everything gets a parseable
    // answer either way, and a truthful one here.
    const jsonMode = parseJsonMode(parsed.args);

    // `rejectUnrecognizedArgs` here can return exit code 1
    // (`INVALID_INPUT`/user error) for `frontx help extra`. This call must
    // stay OUTSIDE `inst-help-return-success`'s own marker pair — an
    // instruction whose FEATURE text (`cli-invocation/FEATURE.md`) reads
    // "**RETURN** for no command or an explicit help request, usage is
    // emitted and the process exits with the success code." A marker that
    // brackets a branch capable of exiting 1 while claiming, by the
    // instruction it cites, that this code path always succeeds would be a
    // contradiction `cfs validate` cannot see, because it checks that a
    // marker's ID exists in the FEATURE, never that the bracketed code
    // actually does what that instruction says. This refusal has its own
    // instruction (`inst-help-if-unrecognized-args` /
    // `inst-help-return-unrecognized-args`) and its own marker pair, so
    // `inst-help-return-success` below brackets ONLY the return that is
    // actually a success.
    // @cpt-begin:cpt-frontx-flow-cli-invocation-help:p1:inst-help-if-unrecognized-args
    // @cpt-begin:cpt-frontx-state-cli-invocation-run:p1:inst-st-req-help-user-error
    const extraArgsOutcome = rejectUnrecognizedArgs('help', parsed.args, jsonMode, 'frontx help');
    if (extraArgsOutcome) {
      // @cpt-begin:cpt-frontx-flow-cli-invocation-help:p1:inst-help-return-unrecognized-args
      return extraArgsOutcome;
      // @cpt-end:cpt-frontx-flow-cli-invocation-help:p1:inst-help-return-unrecognized-args
    }
    // @cpt-end:cpt-frontx-state-cli-invocation-run:p1:inst-st-req-help-user-error
    // @cpt-end:cpt-frontx-flow-cli-invocation-help:p1:inst-help-if-unrecognized-args

    // @cpt-begin:cpt-frontx-flow-cli-invocation-help:p1:inst-help-return-success
    // @cpt-begin:cpt-frontx-state-cli-invocation-run:p1:inst-st-req-help-success
    return { exitCode: EXIT_SUCCESS, stdout: usage };
  }
  // @cpt-end:cpt-frontx-state-cli-invocation-run:p1:inst-st-req-help-success
  // @cpt-end:cpt-frontx-flow-cli-invocation-help:p1:inst-help-return-success

  // @cpt-begin:cpt-frontx-flow-cli-invocation-help:p1:inst-help-if-unrecognized
  // @cpt-begin:cpt-frontx-flow-cli-invocation-help:p1:inst-help-return-user-error
  // @cpt-begin:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-return-unknown
  // @cpt-begin:cpt-frontx-state-cli-invocation-run:p1:inst-st-req-unknown
  // An unrecognized command never reached a dispatch case that could parse
  // `--json` out of its own args, so it always fell to this HUMAN branch —
  // `frontx nosuchcommand --json` wrote nothing but usage text to stderr and
  // nothing to stdout, exactly the "empty stream, unreadable refusal" failure
  // `install`'s own envelope fix above already closed for a KNOWN command.
  const jsonMode = parseJsonMode(parsed.args);
  const message = `Unrecognized command: "${parsed.command}".`;
  return jsonMode
    ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(err('INVALID_INPUT', message)) }
    : { exitCode: EXIT_USER_ERROR, stderr: `Unrecognized command: "${parsed.command}"\n\n${usage}` };
  // @cpt-end:cpt-frontx-state-cli-invocation-run:p1:inst-st-req-unknown
  // @cpt-end:cpt-frontx-algo-cli-invocation-parse-dispatch:p1:inst-pd-return-unknown
  // @cpt-end:cpt-frontx-flow-cli-invocation-help:p1:inst-help-return-user-error
  // @cpt-end:cpt-frontx-flow-cli-invocation-help:p1:inst-help-if-unrecognized
}

/**
 * cpt-frontx-flow-cli-invocation-run-command — top-level run: parses the
 * invocation, defers to help on no-command/help/unrecognized-command
 * (cpt-frontx-flow-cli-invocation-help), otherwise dispatches to the single
 * command surface, and always returns a mapped exit code
 * (cpt-frontx-state-cli-invocation-run).
 */
export async function run(argv: string[], deps: CliDeps): Promise<CommandOutcome> {
  // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-parse
  const parsed = parseInvocation(argv);
  // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-parse

  // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-if-no-command
  // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-defer-help
  if (parsed.helpRequested || parsed.unrecognized) {
    return helpOutcome(parsed);
  }
  // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-defer-help
  // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-if-no-command

  // The invocation parsed to a recognized command token and its arguments
  // (neither help-requested nor unrecognized, having fallen through the
  // deferral above) -> REQUESTED to PARSED.
  // @cpt-begin:cpt-frontx-state-cli-invocation-run:p1:inst-st-req-parsed
  const recognizedCommand = parsed.command as KnownCommand;
  // @cpt-end:cpt-frontx-state-cli-invocation-run:p1:inst-st-req-parsed

  // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-dispatch
  // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-map-exit
  try {
    // @cpt-begin:cpt-frontx-state-cli-invocation-run:p1:inst-st-parsed-dispatched
    const outcome = await runCommand(recognizedCommand, parsed.args, deps);
    // @cpt-end:cpt-frontx-state-cli-invocation-run:p1:inst-st-parsed-dispatched

    // The dispatched behavior's outcome — whichever exit code it carries —
    // realizes exactly one of the three DISPATCHED transitions below.
    // @cpt-begin:cpt-frontx-state-cli-invocation-run:p1:inst-st-dispatched-success
    // @cpt-begin:cpt-frontx-state-cli-invocation-run:p1:inst-st-dispatched-user-error
    // @cpt-begin:cpt-frontx-state-cli-invocation-run:p1:inst-st-dispatched-internal-error
    return outcome ?? { exitCode: EXIT_INTERNAL_ERROR, stderr: 'Command produced no outcome.' };
    // @cpt-end:cpt-frontx-state-cli-invocation-run:p1:inst-st-dispatched-internal-error
    // @cpt-end:cpt-frontx-state-cli-invocation-run:p1:inst-st-dispatched-user-error
    // @cpt-end:cpt-frontx-state-cli-invocation-run:p1:inst-st-dispatched-success
  } catch (error) {
    // A containment violation is a USER error, not an internal one: the tree
    // the caller pointed at carries a symlink leading out of the project, which
    // they can see and fix. Reported through the ordinary envelope so a `--json`
    // caller receives one parseable answer rather than the bare stderr line and
    // internal-error exit every thrown error used to collapse into — the state
    // writer's own refusal reached callers that way until this branch existed.
    // @cpt-begin:cpt-frontx-state-cli-invocation-run:p1:inst-st-dispatched-user-error
    if (error instanceof PathContainmentError) {
      const envelope = err('INVALID_PATH', error.message, { path: error.offendingPath });
      return parseJsonMode(parsed.args)
        ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(envelope) }
        : { exitCode: EXIT_USER_ERROR, stderr: error.message };
    }
    // The project state document (`.frontx/project.json`) could not be read,
    // for one of three reasons (`adapters/fs-project-io.ts`'s own
    // `ProjectStateUnreadableError` doc comment). Reported as `PROJECT_INVALID`
    // — the SAME code every other way this one document can be unusable
    // (malformed JSON, an unrecognized `formatVersion`, a shape violation)
    // already reports, regardless of which of those three reasons broke it —
    // rather than `CONTENT_CONFLICT`, which stays reserved for template/
    // payload content elsewhere in this same catch. Checked before the more
    // generic `NotRegularFileError` branch below since this is the more
    // specific fact whenever it applies.
    // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-if-project-state-unreadable
    if (error instanceof ProjectStateUnreadableError) {
      const reported = describePathForReport(error.filePath);
      // `error.underlying.message` restates `error.filePath` itself (and, for
      // an `UnreachablePathError`, a second absolute path besides) — using it
      // verbatim here would name this one document three ways in one
      // sentence. `describeUnreadableCause` contributes only the CAUSE.
      const message = `Project state document at "${reported}" could not be read: ${describeUnreadableCause(error.underlying, describePathForReport)}`;
      const envelope = err('PROJECT_INVALID', message, { path: reported });
      // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-project-state-unreadable
      return parseJsonMode(parsed.args)
        ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(envelope) }
        : { exitCode: EXIT_USER_ERROR, stderr: message };
      // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-project-state-unreadable
    }
    // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-if-project-state-unreadable
    // A path the command had to READ is not a regular file — a FIFO, a socket,
    // a device, a directory or a dangling symlink standing where a template
    // manifest, an upgrade-engine scratch file, or a local inventory record
    // belongs (never the project state document — that path is refused above,
    // wrapped, before it ever reaches here). The adapters refuse to open it
    // rather than blocking on it, and that refusal reaches here typed so it
    // can be reported as the same `CONTENT_CONFLICT` the apply, upgrade and
    // delete engines already answer for "the disk holds something this
    // operation cannot work with": an ordinary, actionable problem with the
    // tree, never an internal failure, and never — under `--json` — an empty
    // stdout where the caller is owed exactly one envelope.
    // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-if-content-unreadable
    if (error instanceof NotRegularFileError) {
      // Spelled project-relative when the path lies under the directory the
      // command was invoked in, matching every other envelope in this
      // package, and left absolute only when it genuinely does not — a path
      // outside the project cannot be spelled relative to it without lying
      // about where it is.
      const reported = describePathForReport(error.filePath);
      const message = `"${reported}" is ${describeNonRegularKind(error.kind)}, not a regular file — refusing to read it.`;
      const envelope = err('CONTENT_CONFLICT', message, { path: reported, kind: error.kind });
      // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-content-unreadable
      return parseJsonMode(parsed.args)
        ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(envelope) }
        : { exitCode: EXIT_USER_ERROR, stderr: message };
      // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-content-unreadable
    }
    // A path a command had to read was never reached at all: some component
    // ABOVE it exists and is not a directory (`ENOTDIR`), so nothing beneath
    // it — regardless of what would otherwise stand there — could be
    // inspected. Reported through the identical `CONTENT_CONFLICT` code as
    // `NotRegularFileError` above, since a caller experiences both as the
    // same fact ("the disk holds something this operation cannot work
    // with"), naming the blocking ancestor rather than the path that was
    // never reached — that ancestor is the one entry a developer actually
    // has to resolve.
    if (error instanceof UnreachablePathError) {
      const reportedLeaf = describePathForReport(error.filePath);
      const reportedBlocking = describePathForReport(error.blockingAncestor);
      const message = `"${reportedLeaf}" cannot be reached: "${reportedBlocking}" exists and is not a directory.`;
      const envelope = err('CONTENT_CONFLICT', message, { path: reportedLeaf, blockingAncestor: reportedBlocking });
      // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-content-unreadable
      return parseJsonMode(parsed.args)
        ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(envelope) }
        : { exitCode: EXIT_USER_ERROR, stderr: message };
      // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-content-unreadable
    }
    // A path resolved to the right shape but could not actually be opened —
    // most often a permission refusal (`chmod 000` on the file itself, or on
    // a directory somewhere along the path). The same `CONTENT_CONFLICT` code
    // as the two refusals above, for the identical reason: a caller cannot
    // act on an internal-error exit for what is an ordinary, actionable
    // problem with the tree it pointed the CLI at.
    if (error instanceof PathUnreadableError) {
      const reported = describePathForReport(error.filePath);
      const message = `"${reported}" could not be read (${error.errnoCode}): permission was refused, or the path could not be opened.`;
      const envelope = err('CONTENT_CONFLICT', message, { path: reported, errnoCode: error.errnoCode });
      // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-content-unreadable
      return parseJsonMode(parsed.args)
        ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(envelope) }
        : { exitCode: EXIT_USER_ERROR, stderr: message };
      // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-content-unreadable
    }
    // The local inventory index (`index.json`) was read as a regular file,
    // but its content is not usable — not valid JSON, or not the shape every
    // caller assumes (`adapters/fs-inventory-index.ts`'s own
    // `InvalidInventoryIndexError` doc comment). Reported through the
    // identical `CONTENT_CONFLICT` code as the three refusals above, for the
    // same reason: the disk holds something this operation cannot work
    // with, and a caller cannot act on an internal-error exit for what is an
    // ordinary, actionable problem with the tree it pointed the CLI at.
    if (error instanceof InvalidInventoryIndexError) {
      const reported = describePathForReport(error.filePath);
      const message = error.message;
      const envelope = err('CONTENT_CONFLICT', message, { path: reported });
      // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-content-unreadable
      return parseJsonMode(parsed.args)
        ? { exitCode: EXIT_USER_ERROR, stdout: JSON.stringify(envelope) }
        : { exitCode: EXIT_USER_ERROR, stderr: message };
      // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-content-unreadable
    }
    // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-if-content-unreadable
    // @cpt-end:cpt-frontx-state-cli-invocation-run:p1:inst-st-dispatched-user-error

    // The dispatched behavior failed unexpectedly -> internal-error exit code.
    // @cpt-begin:cpt-frontx-state-cli-invocation-run:p1:inst-st-dispatched-internal-error
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: EXIT_INTERNAL_ERROR, stderr: message };
    // @cpt-end:cpt-frontx-state-cli-invocation-run:p1:inst-st-dispatched-internal-error
  }
  // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-map-exit
  // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-dispatch
}

// A filesystem path as an envelope should carry it: project-relative when it
// sits under the directory the command was invoked in, absolute otherwise.
// Every other path this package reports is project-relative, and an absolute
// host path in one envelope is both noise for a person and a second shape for
// a caller to parse — but relativizing a path that is genuinely outside the
// project would misreport where it is, so that case keeps its absolute form.
function describePathForReport(absolutePath: string): string {
  const relative = path.relative(process.cwd(), absolutePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return absolutePath;
  return relative.split(path.sep).join('/');
}


// --- process entrypoint ---

// A write's completion callback fires once that chunk has actually been
// accepted by the underlying resource (the pipe, file descriptor, or TTY) —
// the synchronous return value of `.write()` only reports whether the
// stream's internal buffer is now over its high-water mark, and says nothing
// about whether the OS on the other end of a piped stdout has actually taken
// the bytes yet. `process.exit()` tears the process down immediately and does
// not wait for that; calling it right after an unawaited `write()` truncates
// whatever a slow reader (a pipe, in particular — a redirected file's writes
// complete fast enough in practice to hide the same race) had not yet
// consumed. Awaiting this callback before exiting is what lets the envelope's
// completeness promise (`cpt-frontx-dod-cli-invocation-json-envelope-
// dispatch`) hold for whatever this callback itself reports, regardless of
// payload size or destination — it cannot reach further than that. A
// destination that accepts a short write without surfacing it as a failure
// (a file capped by a filesystem resource limit, say) never reports an error
// to this callback at all, so a truncation of that kind is invisible here and
// the guarantee does not extend to it; the DoD states that boundary rather
// than an unconditional guarantee.
//
// A destination that fails mid-write reports that failure to the write's own
// callback (with the error as its argument) AND separately schedules an
// `'error'` event on the stream for the SAME failure — the two are not one
// notification arriving twice, but genuinely independent, and the event is
// scheduled on the next tick rather than emitted inline. `process.stdout`/
// `process.stderr` carry no `'error'` listener of their own, and Node's
// default behavior for an `'error'` event nobody is listening for is to
// throw and crash the process — so even after the write's callback has
// already told this function what happened, that separately-scheduled event
// still lands moments later and aborts the process if nothing is attached to
// receive it. A listener attached only around one write, then removed once
// that write's callback resolves, closes too early: the event fires after
// the removal and finds no listener, which is the exact crash this fixes.
// The listener below stays attached for the process's lifetime instead —
// once per stream, covering every write — while the actual EPIPE-vs-other
// classification is read from the write callback's own error argument, since
// that is the one place this function can still tell WHICH write failed.
//
// `EPIPE` means the reader on the other end closed before consuming
// everything (`| head`, `| less`, an early `grep -m1`) — an entirely
// ordinary thing for a caller to do, and the reader's decision, not this
// command's failure (`cpt-frontx-flow-cli-invocation-run-command`, step
// 8.1). Anything else — `ENOSPC` writing to a full disk, say — means the
// output this command already computed did not actually reach its
// destination intact, and reporting the command's own success/user exit code
// over that would be its own lie; the caller escalates to the internal-error
// code instead (step 8.2).
const streamsWithErrorListener = new WeakSet<NodeJS.WritableStream>();
function tolerateStreamErrors(stream: NodeJS.WritableStream): void {
  if (streamsWithErrorListener.has(stream)) return;
  streamsWithErrorListener.add(stream);
  stream.on('error', () => {
    // Deliberately empty: classification happens in the write callback
    // below, which fires with the same error. This listener exists purely
    // so that event has somewhere to go instead of crashing the process.
  });
}

// Exported so a unit test can drive it against a real (if deliberately
// failing) `Writable` — only `main()` below, which needs `process.stdout`
// itself and a real OS pipe to prove out, is limited to binary verification.
export function writeToStream(stream: NodeJS.WritableStream, text: string): Promise<'ok' | 'failed'> {
  tolerateStreamErrors(stream);
  return new Promise((resolve) => {
    stream.write(text, (error) => {
      if (!error) {
        resolve('ok');
        return;
      }
      // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-if-broken-pipe
      // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-broken-pipe-tolerate
      resolve((error as NodeJS.ErrnoException).code === 'EPIPE' ? 'ok' : 'failed');
      // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-broken-pipe-tolerate
      // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-if-broken-pipe
    });
  });
}

// A broken pipe on either stream is already folded into `writeToStream`'s
// 'ok' result (`inst-run-return-if-broken-pipe` /
// `inst-run-return-broken-pipe-tolerate`) and never reaches here; this is
// only the "write genuinely failed" branch, shared by both streams so the
// escalation is stated once rather than duplicated per call site.
// @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-if-write-failed
// @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-write-failed-escalate
function escalateOnWriteFailure(result: 'ok' | 'failed', exitCode: ExitCode): ExitCode {
  return result === 'failed' ? EXIT_INTERNAL_ERROR : exitCode;
}
// @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-write-failed-escalate
// @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return-if-write-failed

/* c8 ignore start -- process wiring exercised by running the built binary, not unit tests */
async function main(): Promise<void> {
  // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-invoke
  const argv = process.argv.slice(2);
  // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-invoke
  const deps = createRealDeps();
  const outcome = await run(argv, deps);
  // @cpt-begin:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return
  let exitCode = outcome.exitCode;
  if (outcome.stdout) {
    const result = await writeToStream(process.stdout, `${outcome.stdout}\n`);
    exitCode = escalateOnWriteFailure(result, exitCode);
  }
  if (outcome.stderr) {
    const result = await writeToStream(process.stderr, `${outcome.stderr}\n`);
    exitCode = escalateOnWriteFailure(result, exitCode);
  }
  process.exit(exitCode);
  // @cpt-end:cpt-frontx-flow-cli-invocation-run-command:p1:inst-run-return
}

// The global npm bin is a SYMLINK to this file, so `process.argv[1]` (the
// symlink path, e.g. .../bin/frontx) never equals `import.meta.url` (the real
// path, .../dist/cli.js) under a plain URL comparison — which made the globally
// installed CLI silently no-op. Resolve BOTH to real paths before comparing so
// the CLI actually runs when invoked through a symlinked global bin.
let isMainModule: boolean;
try {
  isMainModule =
    !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  isMainModule = false;
}
if (isMainModule || process.env.FRONTX_CLI_FORCE_MAIN === '1') {
  main().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    await writeToStream(process.stderr, `${message}\n`);
    process.exit(EXIT_INTERNAL_ERROR);
  });
}
/* c8 ignore stop */
