// @cpt-flow:cpt-frontx-flow-upgrade-changeset-review-approval:p1
// @cpt-flow:cpt-frontx-flow-upgrade-changeset-restore:p1
//
// In-memory-harness suite for `upgradeToOrigin`/`restorePreceding`
// (`../upgrade/flow.ts`), modeled on `entry-flows.test.ts`'s `makeHarness()`
// and `upgrade-commit.test.ts`'s disk/project-state fakes — no real
// filesystem or network access anywhere in this suite. `validateUpgrade` and
// `commitUpgrade` are exercised exhaustively by their own suites; these
// tests cover only what the flow layer adds: the registration/empty-target
// gates, presenting exactly the validated plan, decline writing nothing,
// mapping every commit outcome to its own return, and restore's
// preceding-pair bookkeeping (including the toggle-back property).
import { describe, expect, it, vi } from 'vitest';
import { restorePreceding, upgradeToOrigin } from '../upgrade/flow';
import type { UpgradeEngineDeps } from '../upgrade/flow';
import type { DiskEntry, PresentUpgradePlanFn, ResolvedPayload, ResolvePayloadResult, UpgradePlan } from '../upgrade/types';
import type { ProjectStateDocument, ReadProjectStateFn, WriteProjectStateFn } from '../project-state/types';

const REPO_ROOT = '/repo';

function payload(overrides: Partial<ResolvedPayload> = {}): ResolvedPayload {
  return {
    name: 'my-template',
    version: '1.0.0',
    origin: 'origin-a',
    files: new Map(),
    excludedSubtrees: [],
    ...overrides,
  };
}

/**
 * One isolated fake per test: an in-memory "disk" (`Map<string, string>`,
 * keyed by absolute path exactly as `commitUpgrade` constructs it), an
 * in-memory "project state store" (`projectStateContent`), a fixture-backed
 * `resolvePayload` keyed by origin with a call log (for the "resolves the
 * preceding origin exactly once" assertion), and a queued `presentPlan`
 * decision list. Mirrors `entry-flows.test.ts`'s/`upgrade-commit.test.ts`'s
 * own fakes rather than inventing a third style.
 */
function makeHarness() {
  const disk = new Map<string, string>();
  let projectStateContent: string | null = null;
  let projectStateWriteCount = 0;

  const readProjectStateFn: ReadProjectStateFn = async () => projectStateContent;
  const writeProjectStateFn: WriteProjectStateFn = async (_absolutePath, content) => {
    projectStateContent = content;
    projectStateWriteCount += 1;
  };

  const resolvePayloadFixtures = new Map<string, ResolvedPayload | { code: 'ORIGIN_UNAVAILABLE'; message: string }>();
  const resolvePayloadCalls: string[] = [];
  const resolvePayload = vi.fn(async (origin: string): Promise<ResolvePayloadResult> => {
    resolvePayloadCalls.push(origin);
    const fixture = resolvePayloadFixtures.get(origin);
    if (fixture === undefined) return { ok: false, code: 'ORIGIN_UNAVAILABLE', message: `no fixture for "${origin}"` };
    if ('code' in fixture) return { ok: false, code: fixture.code, message: fixture.message };
    return { ok: true, payload: fixture };
  });

  const readDiskEntry = vi.fn(async (absolutePath: string): Promise<DiskEntry> => {
    return disk.has(absolutePath) ? { kind: 'file', content: disk.get(absolutePath)! } : { kind: 'absent' };
  });
  const writeDiskFile = vi.fn(async (absolutePath: string, content: string) => {
    disk.set(absolutePath, content);
  });
  const renameDiskFile = vi.fn(async (from: string, to: string) => {
    if (!disk.has(from)) throw new Error(`rename source "${from}" does not exist`);
    disk.set(to, disk.get(from)!);
    disk.delete(from);
  });
  const unlinkDiskFile = vi.fn(async (absolutePath: string) => {
    disk.delete(absolutePath);
  });
  const listDiskFiles = vi.fn(async (absoluteDir: string) => {
    const prefix = absoluteDir.endsWith('/') ? absoluteDir : `${absoluteDir}/`;
    const results: string[] = [];
    for (const key of disk.keys()) {
      if (key.startsWith(prefix)) results.push(key.slice(prefix.length));
    }
    return results;
  });

  let nextDecision: 'approved' | 'declined' = 'approved';
  const presentedPlans: UpgradePlan[] = [];
  const presentPlan: PresentUpgradePlanFn = vi.fn(async (plan: UpgradePlan) => {
    presentedPlans.push(plan);
    return nextDecision;
  });

  const promoteInventory = vi.fn(async (_name: string) => {});
  const refreshAiBundle = vi.fn(async (_name: string) => {});

  const deps: UpgradeEngineDeps = {
    repoRoot: REPO_ROOT,
    readProjectStateFn,
    writeProjectStateFn,
    resolvePayload,
    resolveRegisteredExclusions: async () => [],
    readDiskEntry,
    writeDiskFile,
    renameDiskFile,
    unlinkDiskFile,
    listDiskFiles,
    canonicalizeFn: (raw) => raw,
    presentPlan,
    promoteInventory,
    refreshAiBundle,
  };

  function seedProjectState(document: ProjectStateDocument): void {
    projectStateContent = JSON.stringify(document);
  }

  function readProjectStateDocument(): ProjectStateDocument {
    if (projectStateContent === null) throw new Error('project state was never written');
    return JSON.parse(projectStateContent) as ProjectStateDocument;
  }

  function registerOrigin(origin: string, fixture: ResolvedPayload | { code: 'ORIGIN_UNAVAILABLE'; message: string }): void {
    resolvePayloadFixtures.set(origin, fixture);
  }

  return {
    deps,
    disk,
    presentedPlans,
    resolvePayloadCalls,
    promoteInventory,
    refreshAiBundle,
    presentPlan,
    seedProjectState,
    readProjectStateDocument,
    registerOrigin,
    setDecision: (decision: 'approved' | 'declined') => {
      nextDecision = decision;
    },
    wasProjectStateWritten: () => projectStateWriteCount > 0,
    projectStateWriteCount: () => projectStateWriteCount,
  };
}

describe('upgradeToOrigin (cpt-frontx-flow-upgrade-changeset-review-approval)', () => {
  // cpt-frontx-cli-nfr-template-scale's upgrade-preparation threshold: a
  // reviewable change set for ONE registered name in a project that has at
  // least twenty registered, without requiring any unrelated template to
  // upgrade. The second half is the load-bearing one, and it is asserted on
  // the resolve log rather than on the outcome: an engine that re-resolved
  // every registered name to prepare one upgrade would still produce a
  // correct plan, and the criterion would still be false.
  it('prepares a plan for one name in a 20-template project without resolving any unrelated name', async () => {
    const h = makeHarness();
    const NAMES = Array.from({ length: 20 }, (_, i) => `tpl-${String(i).padStart(2, '0')}`);
    const templates = Object.fromEntries(
      NAMES.map((name) => [
        name,
        { origin: `origin-${name}`, version: '1.0.0', targets: [`apps/${name}`] },
      ]),
    );
    h.seedProjectState({ formatVersion: 1, templates, projectOwnedRoots: [] });

    // Every registered name has a resolvable origin, so a needless
    // re-resolution would succeed rather than fail — the log is the only thing
    // that distinguishes the two.
    for (const name of NAMES) {
      h.registerOrigin(`origin-${name}`, payload({ name, version: '1.0.0', origin: `origin-${name}` }));
    }
    const upgraded = NAMES[7];
    h.registerOrigin('origin-next', payload({ name: upgraded, version: '2.0.0', origin: 'origin-next' }));

    const result = await upgradeToOrigin(upgraded, 'origin-next', h.deps);

    expect(result.ok).toBe(true);
    expect(h.presentedPlans).toHaveLength(1);
    expect(h.presentedPlans[0]?.name).toBe(upgraded);

    // Only the upgraded name's baseline and the new origin were resolved.
    const resolvedOthers = h.resolvePayloadCalls.filter(
      (origin) => origin !== 'origin-next' && origin !== `origin-${upgraded}`,
    );
    expect(resolvedOthers).toEqual([]);

    // And no unrelated name moved: every other entry is byte-identical.
    const after = h.readProjectStateDocument();
    for (const name of NAMES) {
      if (name === upgraded) continue;
      expect(after.templates[name]).toEqual(templates[name]);
    }
  });

  it('refuses TEMPLATE_NOT_REGISTERED for a name with no project-state entry', async () => {
    const h = makeHarness();
    h.seedProjectState({ formatVersion: 1, templates: {}, projectOwnedRoots: [] });

    const result = await upgradeToOrigin('my-template', 'origin-b', h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TEMPLATE_NOT_REGISTERED');
    expect(h.presentPlan).not.toHaveBeenCalled();
  });

  it('refuses TARGET_NOT_APPLIED for a name whose targets[] is empty', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'my-template': { origin: 'origin-a', version: '1.0.0', targets: [] } },
      projectOwnedRoots: [],
    });

    const result = await upgradeToOrigin('my-template', 'origin-b', h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TARGET_NOT_APPLIED');
  });

  it('declining the presented plan writes nothing anywhere and never calls commit-side seams', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'my-template': { origin: 'origin-a', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    });
    const stateBefore = h.readProjectStateDocument();
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0' }));
    h.registerOrigin('origin-b', payload({ origin: 'origin-b', version: '2.0.0' }));
    h.setDecision('declined');

    const result = await upgradeToOrigin('my-template', 'origin-b', h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe('declined');
    expect(h.readProjectStateDocument()).toEqual(stateBefore);
    expect(h.wasProjectStateWritten()).toBe(false);
    expect(h.promoteInventory).not.toHaveBeenCalled();
    expect(h.refreshAiBundle).not.toHaveBeenCalled();
  });

  it('approving a clean plan commits successfully and presents exactly the plan that was committed', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'my-template': { origin: 'origin-a', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    });
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['index.ts', 'old']]) }));
    h.registerOrigin('origin-b', payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['index.ts', 'new']]) }));
    h.disk.set('/repo/app/index.ts', 'old');
    h.setDecision('approved');

    const result = await upgradeToOrigin('my-template', 'origin-b', h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A real narrowing guard, not `expect(...).toBe('success')`: the matcher
    // asserts at runtime but tells the compiler nothing, so the `noop`
    // variant (which carries no `plan`) stays in the union and reading
    // `result.plan` below does not type-check.
    if (result.outcome !== 'success') throw new Error(`expected outcome "success", got "${result.outcome}"`);
    expect(result.plan).toBe(h.presentedPlans[0]);
    expect(h.disk.get('/repo/app/index.ts')).toBe('new');
    expect(h.readProjectStateDocument().templates['my-template']).toMatchObject({
      origin: 'origin-b',
      version: '2.0.0',
      previous: { origin: 'origin-a', version: '1.0.0' },
    });
    expect(h.promoteInventory).toHaveBeenCalledWith('my-template');
    expect(h.refreshAiBundle).toHaveBeenCalledWith('my-template');
  });

  it('reports the noop outcome without presenting anything when the candidate resolves to the baseline', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'my-template': { origin: 'origin-a', version: '1.0.0', targets: ['app'], excludedSubtrees: [] } },
      projectOwnedRoots: [],
    });
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0' }));

    const result = await upgradeToOrigin('my-template', 'origin-a', h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe('noop');
    expect(h.presentPlan).not.toHaveBeenCalled();
    // The baseline entry already carries a recorded `excludedSubtrees`, so
    // there is nothing missing to backfill — see the SEPARATE test below for
    // a legacy entry with no recorded value, where this same no-op DOES
    // write.
    expect(h.wasProjectStateWritten()).toBe(false);
  });

  // Defect-3 fix: a no-op for the pair {origin, version} is not a no-op for
  // a document missing a field the current code writes — a legacy entry
  // registered before `excludedSubtrees` existed must acquire it the first
  // time an upgrade lands on the same origin.
  it('records excludedSubtrees onto a legacy entry (no recorded value) even though the {origin, version} transition itself is a no-op', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'my-template': { origin: 'origin-a', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    });
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0', excludedSubtrees: ['vendor/'] }));

    const result = await upgradeToOrigin('my-template', 'origin-a', h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe('noop');
    expect(h.presentPlan).not.toHaveBeenCalled();
    expect(h.wasProjectStateWritten()).toBe(true);
    expect(h.readProjectStateDocument().templates['my-template']).toMatchObject({
      origin: 'origin-a',
      version: '1.0.0',
      targets: ['app'],
      excludedSubtrees: ['vendor/'],
    });
  });

  // --- each of the five commit outcomes mapped to its own return ----------

  it('maps a pre-rename drift refusal to CONTENT_CONFLICT with nothing committed', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'my-template': { origin: 'origin-a', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    });
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['index.ts', 'old']]) }));
    h.registerOrigin('origin-b', payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['index.ts', 'new']]) }));
    // Disk matches baseline at CLASSIFICATION time (queued below to drift
    // only once commit re-verifies) — simulate drift by mutating disk right
    // before commit's own verification runs, via a readDiskEntry override.
    h.disk.set('/repo/app/index.ts', 'old');
    let readCount = 0;
    (h.deps.readDiskEntry as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (absolutePath: string) => {
      readCount += 1;
      // First read is validate's own classification; drift the disk before
      // commit's pre-rename verification (its own read of the same path).
      if (absolutePath === '/repo/app/index.ts' && readCount > 1) {
        return { kind: 'file', content: 'drifted-since-review' };
      }
      return h.disk.has(absolutePath) ? { kind: 'file', content: h.disk.get(absolutePath)! } : { kind: 'absent' };
    });

    const result = await upgradeToOrigin('my-template', 'origin-b', h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTENT_CONFLICT');
    expect(h.wasProjectStateWritten()).toBe(false);
  });

  it('maps a recovered I/O failure to INTERNAL, leaving every target and the project state untouched', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'my-template': { origin: 'origin-a', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    });
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['index.ts', 'old']]) }));
    h.registerOrigin('origin-b', payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['index.ts', 'new']]) }));
    h.disk.set('/repo/app/index.ts', 'old');
    (h.deps.renameDiskFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error('simulated rename failure');
    });

    const result = await upgradeToOrigin('my-template', 'origin-b', h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INTERNAL');
    expect(result.details).toHaveProperty('originalFailure');
    expect(result.details).not.toHaveProperty('unrecovered');
    expect(h.wasProjectStateWritten()).toBe(false);
    // Recovery unlinks the landed temp write's destination attempt — the
    // real destination file is untouched at its baseline content.
    expect(h.disk.get('/repo/app/index.ts')).toBe('old');
  });

  it('maps a failed recovery to INTERNAL naming both the original failure and the unrecovered paths', async () => {
    const h = makeHarness();
    // TWO targets so the FIRST rename actually lands (giving recovery
    // something to undo) before the SECOND rename fails and triggers it —
    // a single-target plan's rename failure never lands anything at all
    // (that is the PRIOR "recovered" test, above), so recovery would be
    // vacuously successful rather than exercising the failed-recovery path.
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'my-template': { origin: 'origin-a', version: '1.0.0', targets: ['app1', 'app2'] } },
      projectOwnedRoots: [],
    });
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['index.ts', 'old']]) }));
    h.registerOrigin('origin-b', payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['index.ts', 'new']]) }));
    h.disk.set('/repo/app1/index.ts', 'old');
    h.disk.set('/repo/app2/index.ts', 'old');
    (h.deps.renameDiskFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (from: string, to: string) => {
      if (to === '/repo/app2/index.ts') throw new Error('simulated rename failure');
      if (!h.disk.has(from)) throw new Error(`rename source "${from}" does not exist`);
      h.disk.set(to, h.disk.get(from)!);
      h.disk.delete(from);
    });
    (h.deps.writeDiskFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (absolutePath: string, content: string) => {
      // Every temp-file materialization succeeds; only recovery's own
      // attempt to restore app1's already-landed destination back to
      // baseline content fails.
      if (absolutePath === '/repo/app1/index.ts') throw new Error('simulated recovery write failure');
      h.disk.set(absolutePath, content);
    });

    const result = await upgradeToOrigin('my-template', 'origin-b', h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INTERNAL');
    expect(result.details).toHaveProperty('originalFailure');
    expect(result.details).toHaveProperty('unrecovered');
    expect(h.wasProjectStateWritten()).toBe(false);
  });

  it('maps a promotion failure to INTERNAL while the transition itself stands committed', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'my-template': { origin: 'origin-a', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    });
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['index.ts', 'old']]) }));
    h.registerOrigin('origin-b', payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['index.ts', 'new']]) }));
    h.disk.set('/repo/app/index.ts', 'old');
    h.promoteInventory.mockImplementation(async () => {
      throw new Error('simulated promotion failure');
    });

    const result = await upgradeToOrigin('my-template', 'origin-b', h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INTERNAL');
    expect(result.details).toHaveProperty('slot');
    // The transition itself stands committed regardless.
    expect(h.readProjectStateDocument().templates['my-template']).toMatchObject({ origin: 'origin-b', version: '2.0.0' });
    expect(h.refreshAiBundle).not.toHaveBeenCalled();
  });

  it('maps an AI-bundle refresh failure to INTERNAL while the transition and promotion both stand', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'my-template': { origin: 'origin-a', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    });
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['index.ts', 'old']]) }));
    h.registerOrigin('origin-b', payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['index.ts', 'new']]) }));
    h.disk.set('/repo/app/index.ts', 'old');
    h.refreshAiBundle.mockImplementation(async () => {
      throw new Error('simulated bundle refresh failure');
    });

    const result = await upgradeToOrigin('my-template', 'origin-b', h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INTERNAL');
    expect(result.details).toHaveProperty('bundle');
    expect(h.readProjectStateDocument().templates['my-template']).toMatchObject({ origin: 'origin-b', version: '2.0.0' });
    expect(h.promoteInventory).toHaveBeenCalledWith('my-template');
  });
});

describe('restorePreceding (cpt-frontx-flow-upgrade-changeset-restore)', () => {
  it('refuses NOTHING_TO_RESTORE when no preceding pair is recorded', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'my-template': { origin: 'origin-a', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    });

    const result = await restorePreceding('my-template', h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOTHING_TO_RESTORE');
    expect(h.presentPlan).not.toHaveBeenCalled();
    // No resolution was ever attempted for a name with nothing recorded.
    expect(h.resolvePayloadCalls).toEqual([]);
  });

  it('restores to the preceding origin, resolving it exactly once, and records the just-left origin as the new preceding origin', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: {
        'my-template': {
          origin: 'origin-b',
          version: '2.0.0',
          targets: ['app'],
          previous: { origin: 'origin-a', version: '1.0.0' },
        },
      },
      projectOwnedRoots: [],
    });
    h.registerOrigin('origin-b', payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['index.ts', 'new']]) }));
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['index.ts', 'old']]) }));
    h.disk.set('/repo/app/index.ts', 'new');

    const result = await restorePreceding('my-template', h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe('success');
    expect(h.disk.get('/repo/app/index.ts')).toBe('old');
    expect(h.readProjectStateDocument().templates['my-template']).toMatchObject({
      origin: 'origin-a',
      version: '1.0.0',
      previous: { origin: 'origin-b', version: '2.0.0' },
    });
    // 'origin-a' (the preceding/candidate origin) is resolved EXACTLY ONCE —
    // inside validateUpgrade's single call — never a second time by this
    // flow before or after.
    expect(h.resolvePayloadCalls.filter((origin) => origin === 'origin-a')).toHaveLength(1);
  });

  it('two restores in a row toggle back, and the second is NOT NOTHING_TO_RESTORE', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: {
        'my-template': {
          origin: 'origin-b',
          version: '2.0.0',
          targets: ['app'],
          previous: { origin: 'origin-a', version: '1.0.0' },
        },
      },
      projectOwnedRoots: [],
    });
    h.registerOrigin('origin-b', payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['index.ts', 'new']]) }));
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['index.ts', 'old']]) }));
    h.disk.set('/repo/app/index.ts', 'new');

    const first = await restorePreceding('my-template', h.deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.outcome).toBe('success');
    expect(h.readProjectStateDocument().templates['my-template']).toMatchObject({
      origin: 'origin-a',
      previous: { origin: 'origin-b', version: '2.0.0' },
    });

    const second = await restorePreceding('my-template', h.deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // NEVER NOTHING_TO_RESTORE: it moves back to 'origin-b', the origin the
    // first restore had just left.
    expect(second.outcome).toBe('success');
    expect(h.readProjectStateDocument().templates['my-template']).toMatchObject({
      origin: 'origin-b',
      version: '2.0.0',
      previous: { origin: 'origin-a', version: '1.0.0' },
    });
    expect(h.disk.get('/repo/app/index.ts')).toBe('new');
  });

  it('restore reports a commit outcome (never an unconditional success) when the commit refuses', async () => {
    const h = makeHarness();
    h.seedProjectState({
      formatVersion: 1,
      templates: {
        'my-template': {
          origin: 'origin-b',
          version: '2.0.0',
          targets: ['app'],
          previous: { origin: 'origin-a', version: '1.0.0' },
        },
      },
      projectOwnedRoots: [],
    });
    h.registerOrigin('origin-b', payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['index.ts', 'new']]) }));
    h.registerOrigin('origin-a', payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['index.ts', 'old']]) }));
    h.disk.set('/repo/app/index.ts', 'new');
    (h.deps.renameDiskFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error('simulated rename failure');
    });

    const result = await restorePreceding('my-template', h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INTERNAL');
  });
});
