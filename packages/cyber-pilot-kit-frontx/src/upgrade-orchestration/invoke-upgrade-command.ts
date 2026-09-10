// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1
//
// Concrete `InvokeUpgradeCommandFn` — drives the SINGLE F14 change-set engine
// STRICTLY through the built `frontx upgrade` command/invocation surface
// (`frontx upgrade <templateName> <new-origin> --json[, --yes]`, run with the
// target project as its working directory), never by importing
// `@gears-frontx/cli` (DESIGN §3.4; cpt-frontx-dod-ai-upgrade-orchestration-single-engine).
// The coupling is process/command boundary only: this module contains no
// `import` from the CLI package anywhere.
//
// `templateName` travels as the command's required first positional
// argument (issue #508, FEATURE §1.1 `inst-invoke-engine`): the shipped
// command surface reads its own baseline from that same name, so this
// adapter and the engine can never disagree about which template is being
// upgraded.
//
// PROTOCOL (fixed 2026-09-03 — the retired stdin handshake this file used to
// describe does not exist on the real command surface; see
// `packages/cli/src/commands/upgrade.ts`'s own header and
// `cpt-frontx-adr-cli-machine-readable-output`). `frontx upgrade ... --json`
// is a TWO-CALL protocol identical in shape to `delete`'s own precedent:
//
//   1. A `--json` invocation WITHOUT `--yes` writes exactly ONE JSON
//      envelope to stdout and NEVER reads stdin. Two outcomes:
//        - `{ok:true, data:{outcome:'noop', at:{origin,version}}}` — the
//          project is already at the target version; there is nothing to
//          confirm and nothing was or will be written.
//        - `{ok:false, error:{code:'CONFIRMATION_REQUIRED', message,
//          details:{name, plan}}}` — `details.plan` is the engine's
//          reviewable plan (`packages/cli/src/upgrade/plan.ts`'s
//          `ReviewablePlan`). Nothing has been written yet.
//      Any OTHER `ok:false` code (e.g. `CONTENT_CONFLICT`, `TARGET_CONFLICT`,
//      `PROJECT_INVALID`, ...) is a real refusal unrelated to confirmation;
//      it is surfaced as-is, never treated as unparseable.
//   2. `details.plan` from step 1 is handed to the injected `onChangeSet`
//      review callback (cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced).
//      On `'declined'`, this adapter returns immediately WITHOUT invoking
//      the command again — the first call already guaranteed nothing was
//      written. On `'approved'`, the IDENTICAL command is re-issued with
//      `--yes` appended, and that second envelope is parsed as the outcome
//      (`{outcome:'success', plan}` or another `ok:false` failure).
//
// Stdin is never written to in either step — the real command surface never
// reads it in `--json` mode, in contrast to this file's retired description.
//
// SHAPE MISMATCH BETWEEN THE REAL `ReviewablePlan` AND THIS KIT'S LOCAL
// `ChangeSet` (`./types.ts`) — read before touching `mapPlanToChangeSet`
// below. The two do not structurally line up, and the gap is NOT
// papered over here:
//   - `ReviewablePlan.operations[]` never carries file content
//     (`op: 'ADD'|'REPLACE'|'REMOVE'|'KEEP_LOCAL'|'UNCHANGED'`, no
//     `content` field at all — `renderReviewablePlan`'s own header:
//     "Nothing else" beyond target/path/op) because
//     `cpt-frontx-adr-project-upgrade-mechanism` deliberately keeps a
//     developer-facing plan free of textual deltas. `ChangeSet`'s
//     `CleanEntry.content` is therefore ALWAYS `undefined` for data
//     produced by this adapter — a real, permanent capability gap versus
//     the retired protocol's fictional per-entry content, not a bug in
//     this mapping.
//   - `ChangeSet.conflicts` is ALWAYS `[]` here — not because conflicts
//     are ignored, but because a real doubly-changed path never reaches a
//     `CONFIRMATION_REQUIRED` plan at all: `classify.ts` collects such
//     paths into `conflictPaths`, and `flow.ts` (`if (outcome.code ===
//     'CONTENT_CONFLICT')`) refuses the WHOLE upgrade with a distinct
//     `CONTENT_CONFLICT` error BEFORE any plan is produced. That refusal
//     surfaces through the non-`CONFIRMATION_REQUIRED` branch below, never
//     through a populated `conflicts` array.
//   - `KEEP_LOCAL` and `UNCHANGED` operations write nothing to disk
//     (`classify.ts`'s own branches) and have no analogue in `ChangeSet`'s
//     three-way `ChangeKind` (`'add'|'modify'|'remove'`); they are
//     dropped from `clean` rather than invented as a fabricated kind.
//   - `ReviewablePlan.operations[]` is flattened across every target the
//     plan covers (`plan.targets`), but each entry's `path` is already the
//     full project-relative path (`classify.ts`'s `joinUnderTarget`), so
//     no distinguishing information is lost by `ChangeSet` having no
//     separate per-target grouping.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ChangeSet, CleanEntry, InvokeUpgradeCommandFn, ReviewDecision, UpgradeCommandJsonResult } from './types.js';

/** Options this adapter passes to a spawned child process. */
export interface SpawnOptions {
  /** The command runs with this directory as its working directory — the
   * shipped `frontx upgrade` surface takes no `<projectRoot>` argument of
   * its own (it operates on its process's cwd), so this is how the target
   * project is selected. */
  cwd?: string;
}

/** Minimal shape this adapter needs from a spawned child process (DI seam for tests). */
export type SpawnFn = (command: string, args: string[], options?: SpawnOptions) => ChildProcessWithoutNullStreams;

export interface InvokeUpgradeCommandOptions {
  /**
   * Resolves the `frontx` executable to invoke; defaults to `'frontx'`,
   * resolved via the invoking process's `PATH` — never a hardcoded absolute
   * path, per the command-surface-only boundary.
   */
  frontxBin?: string;
  /** Injectable process spawn, defaulting to `node:child_process`'s `spawn`. */
  spawnFn?: SpawnFn;
}

// The shared `{ok:true, data}` / `{ok:false, error:{code, message,
// details}}` discriminated envelope every `--json` invocation emits
// (`cpt-frontx-adr-cli-machine-readable-output`), parsed locally rather than
// imported — this module names no CLI package type, exactly like every
// other shape in `./types.ts`.
interface CliEnvelopeError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
type CliEnvelope = { ok: true; data: unknown } | { ok: false; error: CliEnvelopeError };

function parseCliEnvelope(raw: string): CliEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.ok !== 'boolean') return undefined;
  if (parsed.ok) {
    return { ok: true, data: parsed.data };
  }
  const error = parsed.error;
  if (!isRecord(error) || typeof error.code !== 'string' || typeof error.message !== 'string') return undefined;
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      details: isRecord(error.details) ? error.details : undefined,
    },
  };
}

/**
 * Maps `CONFIRMATION_REQUIRED`'s `details.plan` (a `ReviewablePlan`,
 * structurally) onto this kit's local `ChangeSet` — see this file's header
 * for exactly which parts of that mapping are lossless and which are not.
 * Returns `undefined` when `details` does not carry the expected
 * `{name, plan:{name, from:{version}, to:{version}, operations[]}}` shape at
 * all, rather than guessing at a translation for data that was never there.
 */
function mapConfirmationDetailsToChangeSet(details: Record<string, unknown> | undefined): ChangeSet | undefined {
  if (!isRecord(details)) return undefined;
  const plan = details.plan;
  if (!isRecord(plan)) return undefined;

  const { name, from, to, operations } = plan;
  if (typeof name !== 'string' || !isRecord(from) || !isRecord(to)) return undefined;
  if (typeof from.version !== 'string' || typeof to.version !== 'string') return undefined;

  const clean: CleanEntry[] = [];
  if (Array.isArray(operations)) {
    for (const raw of operations) {
      if (!isRecord(raw) || typeof raw.path !== 'string' || typeof raw.op !== 'string') continue;
      // `KEEP_LOCAL` / `UNCHANGED` write nothing to disk — omitted rather
      // than invented as a fabricated `ChangeKind`; see this file's header.
      if (raw.op === 'ADD') clean.push({ kind: 'add', path: raw.path });
      else if (raw.op === 'REPLACE') clean.push({ kind: 'modify', path: raw.path });
      else if (raw.op === 'REMOVE') clean.push({ kind: 'remove', path: raw.path });
    }
  }

  return {
    templateIdentity: name,
    baselineVersion: from.version,
    targetVersion: to.version,
    clean,
    // Always empty — see this file's header on why a real conflict never
    // reaches a `CONFIRMATION_REQUIRED` plan at all.
    conflicts: [],
  };
}

/** Reads an `ok:true` envelope's `data.outcome` into this kit's local result status. */
function mapSuccessDataToResult(data: unknown): UpgradeCommandJsonResult {
  const outcome = isRecord(data) ? data.outcome : undefined;
  if (outcome === 'noop') return { ok: true, status: 'noop' };
  if (outcome === 'declined') return { ok: true, status: 'declined' };
  // 'success', or an unrecognized/absent outcome on an `ok:true` envelope —
  // the developer's intended end state was reached.
  return { ok: true, status: 'applied' };
}

/**
 * Factory returning a concrete `InvokeUpgradeCommandFn` bound to the built
 * `frontx upgrade` command surface. Exported from `src/index.ts`
 * (cpt-frontx-dod-ai-upgrade-orchestration-single-engine).
 */
export function createInvokeUpgradeCommand(options: InvokeUpgradeCommandOptions = {}): InvokeUpgradeCommandFn {
  const frontxBin = options.frontxBin ?? 'frontx';
  const spawnFn: SpawnFn = options.spawnFn ?? ((command, args, spawnOptions) => nodeSpawn(command, args, spawnOptions));

  // Runs ONE `frontx upgrade ... --json[, --yes]` invocation to completion
  // and parses its single stdout JSON envelope
  // (cpt-frontx-adr-cli-machine-readable-output: "exactly one JSON value on
  // stdout"). Never writes to `child.stdin` — the real command surface
  // never reads it in `--json` mode.
  function runUpgradeInvocation(projectRoot: string, args: string[]): Promise<CliEnvelope> {
    return new Promise<CliEnvelope>((resolve, reject) => {
      // @cpt-begin:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1:inst-spawn-command-surface
      // `upgrade <templateName> <new-origin> --json[, --yes]` — the selected
      // template's name and the target version's resolved origin, passed
      // directly (§1.1); `projectRoot` selects the target project through
      // the child process's working directory, since the command surface
      // itself takes no project-root argument.
      const child = spawnFn(frontxBin, args, { cwd: projectRoot });
      // @cpt-end:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1:inst-spawn-command-surface

      let stdout = '';
      let stderr = '';
      let settled = false;

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('error', (error: Error) => {
        if (settled) return;
        settled = true;
        reject(new Error(`Failed to spawn the "frontx upgrade" command surface (bin: "${frontxBin}"): ${error.message}`));
      });

      child.on('close', () => {
        if (settled) return;
        settled = true;

        // @cpt-begin:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1:inst-parse-json-result
        const trimmed = stdout.trim();
        const envelope = trimmed ? parseCliEnvelope(trimmed) : undefined;
        if (!envelope) {
          reject(
            new Error(
              `"${frontxBin} ${args.join(' ')}" did not emit a parseable JSON envelope on stdout. ` +
                `stdout: ${JSON.stringify(stdout)}; stderr: ${JSON.stringify(stderr)}`,
            ),
          );
          return;
        }
        resolve(envelope);
        // @cpt-end:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1:inst-parse-json-result
      });
    });
  }

  return async function invokeUpgradeCommand(
    projectRoot: string,
    templateName: string,
    targetOrigin: string,
    onChangeSet: (changeSet: ChangeSet) => Promise<ReviewDecision>,
  ): Promise<UpgradeCommandJsonResult> {
    const baseArgs = ['upgrade', templateName, targetOrigin, '--json'];

    const first = await runUpgradeInvocation(projectRoot, baseArgs);

    if (first.ok) {
      // Idempotent no-op (or, defensively, any other `ok:true` outcome the
      // first, unconfirmed call can report): nothing to confirm, nothing
      // was written — never treated as a protocol violation.
      return mapSuccessDataToResult(first.data);
    }

    if (first.error.code !== 'CONFIRMATION_REQUIRED') {
      // A real refusal unrelated to confirmation (e.g. `CONTENT_CONFLICT`,
      // `TARGET_CONFLICT`, `PROJECT_INVALID`) — surfaced with its own code
      // and message, never reported as unparseable.
      return { ok: false, status: 'resolution-failed', code: first.error.code, message: first.error.message };
    }

    // @cpt-begin:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1:inst-relay-changeset
    const changeSet = mapConfirmationDetailsToChangeSet(first.error.details);
    if (!changeSet) {
      throw new Error(
        `"CONFIRMATION_REQUIRED"'s details did not carry the expected {name, plan:{name, from, to, operations}} shape: ${JSON.stringify(first.error.details)}`,
      );
    }
    const decision = await onChangeSet(changeSet);
    // @cpt-end:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1:inst-relay-changeset

    // @cpt-begin:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1:inst-gate-decision
    if (decision === 'declined') {
      // Nothing is invoked again — the first call already guaranteed
      // nothing was written.
      return { ok: true, status: 'declined' };
    }

    // Approved: re-issue the IDENTICAL command with `--yes` appended, which
    // is what actually gates the engine's apply step on this decision.
    const second = await runUpgradeInvocation(projectRoot, [...baseArgs, '--yes']);
    // @cpt-end:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1:inst-gate-decision

    if (second.ok) return mapSuccessDataToResult(second.data);
    return { ok: false, status: 'apply-failed', code: second.error.code, message: second.error.message };
  };
}
