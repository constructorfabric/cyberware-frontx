// @cpt-flow:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1
// @cpt-state:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
//
// PLAN CORRECTION (2026-07-14) — REOPENED: no import from the CLI package,
// no linking of `computeChangeSet`/`applyChangeSet`. `invokeUpgradeCommand` is
// a test double for the `frontx upgrade` COMMAND/INVOCATION SURFACE: it
// receives a callback that this orchestration layer uses to enrich the raw
// change set and return a review decision, mirroring exactly how a real
// process-boundary adapter (spawning the `frontx` CLI, parsing its JSON
// output) would be wired without ever importing the CLI package.
//
// Single-document provenance model: `readProvenance` returns the project's
// single state document (`ProjectStateDocument`, one `TemplateEntry` per
// registered name, `cpt-frontx-contract-project-provenance`); orchestration
// selects the NAMED template's entry from its `templates` map before
// invoking the command surface. Three distinct guards precede that
// selection/invocation — unreadable document, unregistered name, and a
// registered name with no applied targets — each with its own outcome code
// (FEATURE §2 steps 3-5).
import { describe, it, expect, vi } from 'vitest';
import { orchestrateAiDrivenUpgrade, type OrchestrationDeps } from '../orchestrate.js';
import type { ChangeSet, InvokeUpgradeCommandFn, ReviewDecision } from '../types.js';
import type { ProjectStateDocument } from '../../project-state.js';

const PROJ_ROOT = '/proj';

const PROJECT_STATE: ProjectStateDocument = {
  formatVersion: 1,
  templates: {
    // Recorded at a REMOTE origin carrying an `@ref`, because that is what a
    // version-driven upgrade can actually be resolved against: the engine
    // reads its second argument as a source-spec, so the target version has
    // to be rebased onto this origin's ref (`resolveTargetOrigin`). These
    // fixtures used a `path:` origin while the orchestration passed the bare
    // version straight through to a MOCKED command surface, so the mismatch
    // never showed up here — against the real engine a bare `2.0.0` is
    // refused for having no `host:` prefix.
    'my-template': { origin: 'github:acme/my-template@v1.0.0', version: '1.0.0', targets: ['apps/web'] },
    // A second registered template's entry — proves selection reaches into a
    // multi-entry `templates` map rather than assuming a single
    // whole-repository origin.
    'other-template': { origin: 'github:acme/other-template@v3.4.0', version: '3.4.0', targets: ['apps/admin'] },
    // Registered but with no applied target — the `TARGET_NOT_APPLIED` guard.
    // Keeps a `path:` origin deliberately: this entry refuses before origin
    // resolution is ever reached, which is what makes the guard order visible.
    'no-target-template': { origin: 'path:./templates/no-target-template', version: '1.0.0', targets: [] },
    // Registered at a LOCAL origin with an applied target — no ref to rebase
    // a version onto, so this is the `ORIGIN_UNAVAILABLE` limit.
    'local-template': { origin: 'path:./templates/local-template', version: '1.0.0', targets: ['apps/local'] },
  },
  projectOwnedRoots: [],
};

const RESOLVABLE_CHANGESET: ChangeSet = {
  templateIdentity: 'my-template',
  baselineVersion: '1.0.0',
  targetVersion: '2.0.0',
  clean: [{ kind: 'modify', path: 'src/App.tsx', content: 'v2 content' }],
  conflicts: [],
};

// Test double for the `frontx upgrade` command/invocation surface. Mirrors
// the real command's contract: it computes (or fails to compute) a change
// set, hands it to `onChangeSet` for review, and applies only on 'approved'.
function makeCommandInvoker(options: {
  resolutionFailure?: { code: string; message: string };
  noop?: boolean;
  applyFails?: boolean;
  changeSet?: ChangeSet;
}): { invoke: InvokeUpgradeCommandFn; appliedSpy: ReturnType<typeof vi.fn> } {
  const appliedSpy = vi.fn();
  const invoke: InvokeUpgradeCommandFn = async (_projectRoot, _templateName, _targetVersion, onChangeSet) => {
    if (options.resolutionFailure) {
      return { ok: false, status: 'resolution-failed', code: options.resolutionFailure.code, message: options.resolutionFailure.message };
    }
    if (options.noop) {
      // The command surface's first, unconfirmed call reporting the
      // project is already at the target version — `onChangeSet` is never
      // invoked, exactly as it never is for a genuine resolution failure;
      // this is the real no-op this kit's own `empty-changeset` status
      // names, never a refusal.
      return { ok: true, status: 'noop' };
    }
    const decision: ReviewDecision = await onChangeSet(options.changeSet ?? RESOLVABLE_CHANGESET);
    if (decision === 'approved') {
      if (options.applyFails) {
        return { ok: false, status: 'apply-failed', message: 'Could not write project files.' };
      }
      appliedSpy();
      return { ok: true, status: 'applied' };
    }
    return { ok: true, status: 'declined' };
  };
  return { invoke, appliedSpy };
}

function baseDeps(overrides: Partial<OrchestrationDeps> = {}): OrchestrationDeps {
  const { invoke } = makeCommandInvoker({});
  return {
    readProvenance: vi.fn().mockResolvedValue(PROJECT_STATE),
    invokeUpgradeCommand: invoke,
    presentEnrichedReview: vi.fn().mockResolvedValue('declined'),
    ...overrides,
  };
}

describe('orchestrateAiDrivenUpgrade (F17 — drives the SINGLE F14 engine through its command surface, never a second one)', () => {
  // inst-request-upgrade / inst-read-provenance / inst-check-provenance-unreadable / inst-provenance-unreadable
  it('returns project-invalid and never invokes the command surface when the project state document is absent/unreadable', async () => {
    const { invoke } = makeCommandInvoker({});
    const invokeSpy = vi.fn(invoke);
    const deps = baseDeps({ readProvenance: vi.fn().mockResolvedValue(null), invokeUpgradeCommand: invokeSpy });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'my-template', '2.0.0', deps);
    expect(result.status).toBe('project-invalid');
    if (result.status === 'project-invalid') expect(result.code).toBe('PROJECT_INVALID');
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  // inst-check-not-registered / inst-provenance-not-registered — the document has entries, but none for the named template
  it('returns template-not-registered when the document holds no templates[name] entry for the named template', async () => {
    const { invoke } = makeCommandInvoker({});
    const invokeSpy = vi.fn(invoke);
    const deps = baseDeps({ readProvenance: vi.fn().mockResolvedValue(PROJECT_STATE), invokeUpgradeCommand: invokeSpy });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'no-such-template', '2.0.0', deps);
    expect(result.status).toBe('template-not-registered');
    if (result.status === 'template-not-registered') {
      expect(result.code).toBe('TEMPLATE_NOT_REGISTERED');
      expect(result.message).toContain('no-such-template');
    }
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  // inst-check-no-targets / inst-provenance-no-targets — the entry exists but its targets array is empty
  it('returns target-not-applied when the named template is registered but its targets array is empty', async () => {
    const { invoke } = makeCommandInvoker({});
    const invokeSpy = vi.fn(invoke);
    const deps = baseDeps({ readProvenance: vi.fn().mockResolvedValue(PROJECT_STATE), invokeUpgradeCommand: invokeSpy });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'no-target-template', '2.0.0', deps);
    expect(result.status).toBe('target-not-applied');
    if (result.status === 'target-not-applied') {
      expect(result.code).toBe('TARGET_NOT_APPLIED');
      expect(result.message).toContain('no-target-template');
    }
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  // inst-check-not-registered — a multi-entry document, selects the NAMED entry (not the first one)
  it('selects the entry for the named template out of a multi-entry templates map', async () => {
    const readProvenance = vi.fn().mockResolvedValue(PROJECT_STATE);
    const { invoke } = makeCommandInvoker({});
    const deps = baseDeps({
      readProvenance,
      invokeUpgradeCommand: invoke,
      presentEnrichedReview: vi.fn().mockResolvedValue('declined'),
    });
    // Named template is NOT the first key in the `templates` map.
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'other-template', '4.0.0', deps);
    expect(readProvenance).toHaveBeenCalledWith(PROJ_ROOT);
    expect(result.status).toBe('declined');
    if (result.status === 'declined') {
      expect(result.reviewPackage.selectedTemplate).toEqual({
        name: 'other-template',
        origin: 'github:acme/other-template@v3.4.0',
        version: '3.4.0',
        targets: ['apps/admin'],
      });
    }
  });

  // inst-invoke-enrichment / inst-check-changeset — a genuine no-op (the
  // command surface's baseline already equals the candidate) is the ONLY
  // case that legitimately reports "nothing to update": `onChangeSet` is
  // never invoked, and the command surface itself reports `ok:true,
  // status:'noop'` rather than a refusal.
  it('returns empty-changeset and presents no review for a genuine no-op (baseline already equals the candidate)', async () => {
    const { invoke } = makeCommandInvoker({ noop: true });
    const presentSpy = vi.fn();
    const deps = baseDeps({ invokeUpgradeCommand: invoke, presentEnrichedReview: presentSpy });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'my-template', '1.0.0', deps);
    expect(result.status).toBe('empty-changeset');
    expect(presentSpy).not.toHaveBeenCalled();
  });

  // inst-invoke-enrichment / inst-check-changeset — a genuine CLI refusal
  // from the command surface's first call MUST surface as a failure
  // carrying its own code, never as "nothing to update": `onChangeSet` is
  // never invoked for this status either, which is exactly what used to
  // make this indistinguishable from the real no-op above.
  it.each([
    { code: 'CONTENT_CONFLICT', message: 'A file was changed both by the candidate and on disk.' },
    { code: 'TARGET_CONFLICT', message: 'Ground newly claimed holds another template\'s nested target.' },
    { code: 'PROJECT_INVALID', message: 'The project state document is absent or unreadable.' },
  ])('surfaces $code from the command surface as resolution-failed, never empty-changeset', async ({ code, message }) => {
    const { invoke } = makeCommandInvoker({ resolutionFailure: { code, message } });
    const presentSpy = vi.fn();
    const deps = baseDeps({ invokeUpgradeCommand: invoke, presentEnrichedReview: presentSpy });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'my-template', '9.9.9', deps);
    expect(result.status).toBe('resolution-failed');
    if (result.status === 'resolution-failed') {
      expect(result.code).toBe(code);
      expect(result.message).toBe(message);
    }
    expect(presentSpy).not.toHaveBeenCalled();
  });

  // inst-invoke-enrichment / inst-check-changeset / inst-empty-changeset — resolved but empty change set
  it('returns empty-changeset when the resolved change set has no clean/conflict entries', async () => {
    const emptyChangeSet: ChangeSet = { ...RESOLVABLE_CHANGESET, clean: [], conflicts: [] };
    const { invoke } = makeCommandInvoker({ changeSet: emptyChangeSet });
    const presentSpy = vi.fn();
    const deps = baseDeps({ invokeUpgradeCommand: invoke, presentEnrichedReview: presentSpy });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'my-template', '1.0.0', deps);
    expect(result.status).toBe('empty-changeset');
    expect(presentSpy).not.toHaveBeenCalled();
  });

  // inst-extract-provenance / inst-invoke-engine — the selected name and the target version's
  // RESOLVED origin are passed directly to the command surface (issue #508), so the engine cannot
  // name a different template, and its second argument is a source-spec it can actually parse.
  it("invokes the command surface with the selected template name and the target version's resolved origin", async () => {
    const { invoke } = makeCommandInvoker({});
    const invokeSpy = vi.fn(invoke);
    const deps = baseDeps({
      invokeUpgradeCommand: invokeSpy,
      presentEnrichedReview: vi.fn().mockResolvedValue('declined'),
    });
    await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'my-template', '2.0.0', deps);
    // The recorded origin's ref is rebased onto the target version — never the
    // bare `2.0.0`, which the engine would refuse for having no `host:` prefix.
    expect(invokeSpy).toHaveBeenCalledWith(
      PROJ_ROOT,
      'my-template',
      'github:acme/my-template@2.0.0',
      expect.any(Function),
    );
  });

  // inst-invoke-engine's limit: a name recorded at a local `path:` origin has no ref for a
  // version to be rebased onto, so the upgrade refuses at the boundary that can explain it
  // rather than handing the engine a string that means something else.
  it('refuses with ORIGIN_UNAVAILABLE when the selected name is recorded at a local origin', async () => {
    const { invoke } = makeCommandInvoker({});
    const invokeSpy = vi.fn(invoke);
    const deps = baseDeps({ invokeUpgradeCommand: invokeSpy });

    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'local-template', '2.0.0', deps);

    expect(result.status).toBe('origin-unavailable');
    expect(result).toMatchObject({ code: 'ORIGIN_UNAVAILABLE' });
    // Refused BEFORE the engine was touched: no change set was ever computed.
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  // Guard order is observable: an entry with no applied target refuses as
  // TARGET_NOT_APPLIED even though its origin is also unresolvable, because
  // step 5 runs before origin resolution.
  it('reports TARGET_NOT_APPLIED, not ORIGIN_UNAVAILABLE, for a local-origin entry with no targets', async () => {
    const deps = baseDeps({});
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'no-target-template', '2.0.0', deps);
    expect(result.status).toBe('target-not-applied');
  });

  // inst-extract-provenance / inst-present-review / inst-gate-approve / inst-engine-apply / inst-update-provenance / inst-return-applied
  it('approval triggers the command surface\'s engine apply exactly once, enrichment reflects the selected template', async () => {
    const { invoke, appliedSpy } = makeCommandInvoker({});
    const deps = baseDeps({
      invokeUpgradeCommand: invoke,
      presentEnrichedReview: vi.fn().mockResolvedValue('approved'),
    });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'my-template', '2.0.0', deps);
    expect(result.status).toBe('applied');
    expect(appliedSpy).toHaveBeenCalledTimes(1);
    if (result.status === 'applied') {
      expect(result.reviewPackage.impactAnalysis.entries.length).toBeGreaterThan(0);
      expect(result.reviewPackage.selectedTemplate).toEqual({
        name: 'my-template',
        origin: 'github:acme/my-template@v1.0.0',
        version: '1.0.0',
        targets: ['apps/web'],
      });
    }
  });

  // inst-gate-approve / apply-failed path
  it('surfaces apply-failed from the command surface without treating it as applied', async () => {
    const { invoke, appliedSpy } = makeCommandInvoker({ applyFails: true });
    const deps = baseDeps({
      invokeUpgradeCommand: invoke,
      presentEnrichedReview: vi.fn().mockResolvedValue('approved'),
    });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'my-template', '2.0.0', deps);
    expect(result.status).toBe('apply-failed');
    expect(appliedSpy).not.toHaveBeenCalled();
  });

  // inst-gate-decline / inst-no-write / inst-return-declined — the review gate stands unconditionally
  it('decline never triggers the command surface\'s engine apply', async () => {
    const { invoke, appliedSpy } = makeCommandInvoker({});
    const deps = baseDeps({
      invokeUpgradeCommand: invoke,
      presentEnrichedReview: vi.fn().mockResolvedValue('declined'),
    });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'my-template', '2.0.0', deps);
    expect(result.status).toBe('declined');
    expect(appliedSpy).not.toHaveBeenCalled();
  });

  // Single-engine / command-surface invariant: driven exactly once, never a second implementation
  it('drives the injected command surface exactly once per upgrade (no reimplementation, no duplicate invocation)', async () => {
    const { invoke } = makeCommandInvoker({});
    const invokeSpy = vi.fn(invoke);
    const deps = baseDeps({
      invokeUpgradeCommand: invokeSpy,
      presentEnrichedReview: vi.fn().mockResolvedValue('approved'),
    });
    await orchestrateAiDrivenUpgrade(PROJ_ROOT, 'my-template', '2.0.0', deps);
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });
});
