// @cpt-algo:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
//
// PLAN CORRECTION (2026-07-14) — REOPENED: no import from the CLI package.
// `enrichUpgradeChangeSet` is now a pure function over an already-computed
// `ChangeSet` (as received from the `frontx upgrade` command surface); these
// tests exercise it with locally constructed fixtures, never the real engine.
import { describe, it, expect } from 'vitest';
import { enrichUpgradeChangeSet, computeChangeImpact, computeDownstreamEffects } from '../enrich.js';
import type { ChangeSet, SelectedTemplate } from '../types.js';

const SELECTED_TEMPLATE: SelectedTemplate = {
  name: 'my-template',
  origin: 'path:./templates/my-template',
  version: '1.0.0',
  targets: ['apps/web'],
};

const RESOLVED_CHANGESET: ChangeSet = {
  templateIdentity: 'my-template',
  baselineVersion: '1.0.0',
  targetVersion: '2.0.0',
  clean: [{ kind: 'add', path: 'src/new.ts', content: 'x' }],
  conflicts: [
    { path: 'src/App.tsx', templateKind: 'modify', templateContent: 'v2', localContent: 'local-edit' },
  ],
};

const EMPTY_CHANGESET: ChangeSet = {
  templateIdentity: 'my-template',
  baselineVersion: '1.0.0',
  targetVersion: '1.0.0',
  clean: [],
  conflicts: [],
};

describe('computeChangeImpact', () => {
  // inst-impact-analysis
  it('flags conflicts as requiring attention, clean entries as not', () => {
    const impact = computeChangeImpact(RESOLVED_CHANGESET);
    expect(impact.entries).toHaveLength(2);
    expect(impact.entries.find((e) => e.path === 'src/new.ts')?.requiresAttention).toBe(false);
    expect(impact.entries.find((e) => e.path === 'src/App.tsx')?.requiresAttention).toBe(true);
  });
});

describe('computeDownstreamEffects', () => {
  // inst-downstream-assess
  it('surfaces one incompatibility message per conflict', () => {
    const assessment = computeDownstreamEffects(RESOLVED_CHANGESET);
    expect(assessment.incompatibilities).toHaveLength(1);
    expect(assessment.incompatibilities[0]).toContain('src/App.tsx');
  });

  it('reports no incompatibilities when there are no conflicts', () => {
    const changeSet: ChangeSet = { ...RESOLVED_CHANGESET, conflicts: [] };
    expect(computeDownstreamEffects(changeSet).incompatibilities).toHaveLength(0);
  });
});

describe('enrichUpgradeChangeSet (pure enrichment over an already-computed change set)', () => {
  // inst-receive-changeset / inst-combine-results / inst-return-enriched
  it('enriches a resolved, non-empty change set with impact analysis and downstream assessment', () => {
    const result = enrichUpgradeChangeSet(RESOLVED_CHANGESET, SELECTED_TEMPLATE);
    expect(result.status).toBe('enriched');
    if (result.status !== 'enriched') return;
    expect(result.package.changeSet.targetVersion).toBe('2.0.0');
    expect(result.package.impactAnalysis.entries.length).toBeGreaterThan(0);
    expect(result.package.downstreamAssessment).toBeDefined();
  });

  // inst-extract-provenance / inst-combine-results — enrichment reflects the SELECTED template's
  // templates[name] entry (name, origin, version, targets), not any other entry in the document
  it('combines the SELECTED template\'s name, origin, version, and targets into the enriched package', () => {
    const otherSelection: SelectedTemplate = {
      name: 'other-template',
      origin: 'path:./templates/other-template',
      version: '3.4.0',
      targets: ['apps/admin'],
    };
    const result = enrichUpgradeChangeSet(RESOLVED_CHANGESET, otherSelection);
    expect(result.status).toBe('enriched');
    if (result.status !== 'enriched') return;
    expect(result.package.selectedTemplate).toEqual(otherSelection);
  });

  // inst-check-empty / inst-empty-signal
  it('returns the empty signal when the change set has no clean/conflict entries', () => {
    const result = enrichUpgradeChangeSet(EMPTY_CHANGESET, SELECTED_TEMPLATE);
    expect(result.status).toBe('empty');
  });
});
