// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1
//
// `createInvokeUpgradeCommand` spawns the built `frontx upgrade <templateName>
// <new-origin> --json[, --yes]` command surface (never importing
// `@gears-frontx/cli`), with the target project as the spawned process's
// working directory, gates the engine's apply step on the developer's review
// decision by RE-ISSUING the identical command with `--yes` rather than by
// writing to the process's stdin, and parses each invocation's single JSON
// envelope into the kit-local `UpgradeCommandJsonResult`.
//
// This test injects a fake spawned process (EventEmitter + PassThrough
// streams) that speaks the REAL `{ok:true, data}` / `{ok:false,
// error:{code, message, details}}` envelope — the retired `{changeSet}` /
// stdin-decision / `{ok, status}` handshake the previous version of this
// test spoke is gone; that fake is exactly what hid the original defect.
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInvokeUpgradeCommand, type SpawnFn } from '../invoke-upgrade-command.js';
import type { ChangeSet, ReviewDecision } from '../types.js';

/** Minimal fake `ChildProcessWithoutNullStreams` double. */
function makeFakeChild() {
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough & { writtenChunks: unknown[] };
  };
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  const stdin = new PassThrough() as PassThrough & { writtenChunks: unknown[] };
  stdin.writtenChunks = [];
  const originalWrite = stdin.write.bind(stdin);
  stdin.write = ((chunk: unknown, ...rest: unknown[]) => {
    stdin.writtenChunks.push(chunk);
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof stdin.write;
  emitter.stdin = stdin;
  return emitter;
}

/** Ends one fake invocation: writes a full stdout envelope, then closes. */
function respond(child: ReturnType<typeof makeFakeChild>, envelope: unknown, exitCode = 0): void {
  child.stdout.write(JSON.stringify(envelope));
  child.emit('close', exitCode);
}

const CONFIRMATION_PLAN = {
  name: 'my-template',
  from: { origin: 'git:example/tpl@1.0.0', version: '1.0.0' },
  to: { origin: 'git:example/tpl@2.0.0', version: '2.0.0' },
  targets: ['.'],
  operations: [
    { target: '.', path: 'src/App.tsx', op: 'REPLACE' },
    { target: '.', path: 'src/new-file.ts', op: 'ADD' },
    { target: '.', path: 'src/old-file.ts', op: 'REMOVE' },
    { target: '.', path: 'src/local.ts', op: 'KEEP_LOCAL' },
    { target: '.', path: 'src/same.ts', op: 'UNCHANGED' },
  ],
  skipped: [],
};

const CONFIRMATION_REQUIRED_ENVELOPE = {
  ok: false,
  error: {
    code: 'CONFIRMATION_REQUIRED',
    message: '"my-template"\'s upgrade requires confirmation.',
    details: { name: 'my-template', plan: CONFIRMATION_PLAN },
  },
};

const EXPECTED_CHANGE_SET: ChangeSet = {
  templateIdentity: 'my-template',
  baselineVersion: '1.0.0',
  targetVersion: '2.0.0',
  clean: [
    { kind: 'modify', path: 'src/App.tsx' },
    { kind: 'add', path: 'src/new-file.ts' },
    { kind: 'remove', path: 'src/old-file.ts' },
  ],
  conflicts: [],
};

describe('createInvokeUpgradeCommand (cpt-frontx-dod-ai-upgrade-orchestration-single-engine)', () => {
  it('spawns the built "frontx upgrade <templateName> <new-origin> --json" command surface, cwd set to the project root, no --yes on the first call', () => {
    const fakeChild = makeFakeChild();
    const spawnFn: SpawnFn = vi.fn(() => fakeChild as never);
    const invoke = createInvokeUpgradeCommand({ frontxBin: 'frontx', spawnFn });

    void invoke('/proj', 'my-template', '2.0.0', async () => 'approved');

    expect(spawnFn).toHaveBeenCalledWith('frontx', ['upgrade', 'my-template', '2.0.0', '--json'], { cwd: '/proj' });
  });

  describe('approved path (two calls)', () => {
    it('parses CONFIRMATION_REQUIRED into a ChangeSet, relays it to onChangeSet, and re-issues the identical command with --yes on approval', async () => {
      const firstChild = makeFakeChild();
      const secondChild = makeFakeChild();
      const spawnFn: SpawnFn = vi.fn().mockReturnValueOnce(firstChild as never).mockReturnValueOnce(secondChild as never);
      const invoke = createInvokeUpgradeCommand({ frontxBin: 'frontx', spawnFn });

      const onChangeSet = vi.fn(async (changeSet: ChangeSet): Promise<ReviewDecision> => {
        expect(changeSet).toEqual(EXPECTED_CHANGE_SET);
        return 'approved';
      });

      const resultPromise = invoke('/proj', 'my-template', '2.0.0', onChangeSet);

      respond(firstChild, CONFIRMATION_REQUIRED_ENVELOPE);
      await vi.waitFor(() => expect(onChangeSet).toHaveBeenCalledTimes(1));

      // The second invocation is the IDENTICAL command with --yes appended —
      // never a stdin write.
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2));
      expect(spawnFn).toHaveBeenNthCalledWith(1, 'frontx', ['upgrade', 'my-template', '2.0.0', '--json'], { cwd: '/proj' });
      expect(spawnFn).toHaveBeenNthCalledWith(2, 'frontx', ['upgrade', 'my-template', '2.0.0', '--json', '--yes'], { cwd: '/proj' });

      respond(secondChild, { ok: true, data: { outcome: 'success', plan: { ...CONFIRMATION_PLAN } } });

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, status: 'applied' });

      expect(firstChild.stdin.writtenChunks).toEqual([]);
      expect(secondChild.stdin.writtenChunks).toEqual([]);
    });

    it('surfaces a failure envelope from the second (--yes) call as apply-failed, with its own code and message', async () => {
      const firstChild = makeFakeChild();
      const secondChild = makeFakeChild();
      const spawnFn: SpawnFn = vi.fn().mockReturnValueOnce(firstChild as never).mockReturnValueOnce(secondChild as never);
      const invoke = createInvokeUpgradeCommand({ spawnFn });

      const resultPromise = invoke('/proj', 'my-template', '2.0.0', async () => 'approved');
      respond(firstChild, CONFIRMATION_REQUIRED_ENVELOPE);
      await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2));
      respond(secondChild, { ok: false, error: { code: 'TARGETS_EXIST', message: 'A target vanished mid-flight.' } });

      const result = await resultPromise;
      expect(result).toEqual({ ok: false, status: 'apply-failed', code: 'TARGETS_EXIST', message: 'A target vanished mid-flight.' });
    });
  });

  describe('declined path', () => {
    it('makes exactly one invocation, with no --yes anywhere, and never writes to stdin', async () => {
      const firstChild = makeFakeChild();
      const spawnFn: SpawnFn = vi.fn(() => firstChild as never);
      const invoke = createInvokeUpgradeCommand({ spawnFn });

      const onChangeSet = vi.fn(async (): Promise<ReviewDecision> => 'declined');
      const resultPromise = invoke('/proj', 'my-template', '2.0.0', onChangeSet);

      respond(firstChild, CONFIRMATION_REQUIRED_ENVELOPE);

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, status: 'declined' });

      expect(spawnFn).toHaveBeenCalledTimes(1);
      expect(spawnFn).toHaveBeenCalledWith('frontx', ['upgrade', 'my-template', '2.0.0', '--json'], { cwd: '/proj' });
      for (const call of vi.mocked(spawnFn).mock.calls) {
        expect(call[1]).not.toContain('--yes');
      }
      expect(firstChild.stdin.writtenChunks).toEqual([]);
    });
  });

  it('short-circuits cleanly on an ok:true first response (idempotent no-op) without calling onChangeSet or invoking a second time', async () => {
    const firstChild = makeFakeChild();
    const spawnFn: SpawnFn = vi.fn(() => firstChild as never);
    const invoke = createInvokeUpgradeCommand({ spawnFn });

    const onChangeSet = vi.fn(async (): Promise<ReviewDecision> => 'approved');
    const resultPromise = invoke('/proj', 'my-template', '2.0.0', onChangeSet);

    respond(firstChild, { ok: true, data: { outcome: 'noop', at: { origin: 'git:example/tpl@2.0.0', version: '2.0.0' } } });

    const result = await resultPromise;
    expect(result).toEqual({ ok: true, status: 'noop' });
    expect(onChangeSet).not.toHaveBeenCalled();
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('surfaces a non-CONFIRMATION_REQUIRED failure from the first call with its own code and message, never as unparseable', async () => {
    const firstChild = makeFakeChild();
    const invoke = createInvokeUpgradeCommand({ spawnFn: () => firstChild as never });

    const onChangeSet = vi.fn(async (): Promise<ReviewDecision> => 'approved');
    const resultPromise = invoke('/proj', 'my-template', '2.0.0', onChangeSet);

    respond(firstChild, { ok: false, error: { code: 'CONTENT_CONFLICT', message: 'A path was modified on both sides.' } });

    const result = await resultPromise;
    expect(result).toEqual({ ok: false, status: 'resolution-failed', code: 'CONTENT_CONFLICT', message: 'A path was modified on both sides.' });
    expect(onChangeSet).not.toHaveBeenCalled();
  });

  it('never writes to the child process stdin at any point in the approved flow', async () => {
    const firstChild = makeFakeChild();
    const secondChild = makeFakeChild();
    const spawnFn: SpawnFn = vi.fn().mockReturnValueOnce(firstChild as never).mockReturnValueOnce(secondChild as never);
    const invoke = createInvokeUpgradeCommand({ spawnFn });

    const resultPromise = invoke('/proj', 'my-template', '2.0.0', async () => 'approved');
    respond(firstChild, CONFIRMATION_REQUIRED_ENVELOPE);
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2));
    respond(secondChild, { ok: true, data: { outcome: 'success', plan: CONFIRMATION_PLAN } });
    await resultPromise;

    expect(firstChild.stdin.writtenChunks).toEqual([]);
    expect(secondChild.stdin.writtenChunks).toEqual([]);
  });

  it('fails explicitly (rejects) when the process exits without a parseable JSON envelope', async () => {
    const fakeChild = makeFakeChild();
    const invoke = createInvokeUpgradeCommand({ spawnFn: () => fakeChild as never });

    const resultPromise = invoke('/proj', 'my-template', '2.0.0', async () => 'approved');
    fakeChild.stderr.write('not json at all\n');
    fakeChild.emit('close', 2);

    await expect(resultPromise).rejects.toThrow(/did not emit a parseable JSON envelope/);
  });

  it('fails explicitly (rejects) when the process fails to spawn', async () => {
    const fakeChild = makeFakeChild();
    const invoke = createInvokeUpgradeCommand({ spawnFn: () => fakeChild as never });

    const resultPromise = invoke('/proj', 'my-template', '2.0.0', async () => 'approved');
    fakeChild.emit('error', new Error('ENOENT'));

    await expect(resultPromise).rejects.toThrow(/Failed to spawn/);
  });

  it('fails explicitly (rejects) when CONFIRMATION_REQUIRED details do not carry the expected {name, plan} shape', async () => {
    const fakeChild = makeFakeChild();
    const invoke = createInvokeUpgradeCommand({ spawnFn: () => fakeChild as never });

    const resultPromise = invoke('/proj', 'my-template', '2.0.0', async () => 'approved');
    respond(fakeChild, { ok: false, error: { code: 'CONFIRMATION_REQUIRED', message: 'needs confirmation', details: { surprise: true } } });

    await expect(resultPromise).rejects.toThrow(/did not carry the expected/);
  });

  it('never imports @gears-frontx/cli — command-surface-only coupling (no kit->cli package edge)', () => {
    // Enforced repo-wide by `src/__tests__/no-cli-package-edge.test.ts`;
    // documented here alongside the adapter's own behavioral coverage.
    expect(true).toBe(true);
  });
});

// Pins this adapter's protocol assumptions against the REAL CLI contract,
// not against the fake above — a fake nobody checks against the real
// surface is exactly how the retired stdin-handshake defect this file
// replaces survived undetected. Reading the CLI's own source text (never
// importing `@gears-frontx/cli` — this package carries no dependency on it,
// per `guidelines/ecosystem-boundaries.md`) is the closest available check
// from inside this package's boundary: an `npm test` run breaks the moment
// the CLI's envelope shape, its `CONFIRMATION_REQUIRED` details shape, or
// its `--yes` semantics for `upgrade` drift from what this adapter assumes.
describe('pinned against the real CLI contract (packages/cli/src, read as text — never imported)', () => {
  const CLI_SRC = join(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/cli/src');
  const read = (relativePath: string): string => readFileSync(join(CLI_SRC, relativePath), 'utf-8');

  it('envelope.ts still defines the {ok:true,data} / {ok:false,error:{code,message,details}} shape this adapter parses', () => {
    const envelope = read('envelope.ts');
    expect(envelope).toMatch(/interface\s+OkEnvelope<T>\s*\{\s*ok:\s*true;\s*data:\s*T;/);
    expect(envelope).toMatch(/interface\s+ErrEnvelope\s*\{\s*ok:\s*false;\s*error:\s*EnvelopeError;/);
    expect(envelope).toMatch(/interface\s+EnvelopeError\s*\{\s*code:\s*ErrorCode;\s*message:\s*string;/);
    // `CONFIRMATION_REQUIRED` and the other codes this adapter branches on
    // (or passes through verbatim) still belong to the shared vocabulary.
    expect(envelope).toMatch(/'CONFIRMATION_REQUIRED'/);
    expect(envelope).toMatch(/'CONTENT_CONFLICT'/);
  });

  it('commands/upgrade.ts still reports CONFIRMATION_REQUIRED as {name, plan: renderReviewablePlan(...)} under details, gated on jsonMode && !yes', () => {
    const upgradeCommand = read('commands/upgrade.ts');
    expect(upgradeCommand).toMatch(/code:\s*'CONFIRMATION_REQUIRED'/);
    expect(upgradeCommand).toMatch(/details:\s*\{\s*name:\s*templateName,\s*plan:\s*renderReviewablePlan\(outcome\.plan\)\s*\}/);
    expect(upgradeCommand).toMatch(/flags\.jsonMode\s*&&\s*!flags\.yes/);
    // `--json` never blocks on a TTY: the substitution never reads stdin.
    expect(upgradeCommand).toMatch(/never reads stdin/);
  });

  it('upgrade/plan.ts still renders a reviewable plan with no content field on its operations', () => {
    const plan = read('upgrade/plan.ts');
    expect(plan).toMatch(/interface\s+ReviewableOperation\s*\{\s*target:\s*string;\s*path:\s*string;\s*op:\s*UpgradeOpKind;\s*\}/);
    expect(plan).not.toMatch(/interface\s+ReviewableOperation\s*\{[^}]*content/);
  });

  it('cli.ts still routes upgrade through the shared envelope, never the retired bespoke {ok,status} shape', () => {
    const cli = read('cli.ts');
    expect(cli).toMatch(/never the retired bespoke `\{ok, status\}`/);
  });
});
