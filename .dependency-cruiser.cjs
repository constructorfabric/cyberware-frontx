/**
 * FrontX Dependency Cruiser Configuration (Ecosystem Root)
 *
 * Contains the dependency rules for the FrontX ecosystem packages (mfes,
 * gts-plugin, api, cli, cyber-pilot-kit-frontx).
 *
 * The template-side packages (state, i18n, framework, react, auth, studio)
 * and the host app now live in the self-contained top-level
 * `template-shell/` (Phase 11 template-move; split from its MFE content into
 * the sibling `template-mfe/` in issue #470); its template-internal
 * layering/isolation rules moved into its own `.dependency-cruiser.cjs`.
 * Once template-shell is no longer an npm workspace of this repo,
 * ecosystem packages have no module-resolution path into it at all — the
 * forbid rules below enforce that boundary generically (by shape, not by
 * naming the template's path), so they keep working if the template's
 * location or identity changes.
 */

/**
 * A cross-package `@gears-frontx/*` import reaches dependency-cruiser under
 * three resolved shapes, and a `to` rule covering only one of them is a rule
 * that silently never fires. This is the same three-shape reasoning as
 * `internal/depcruise-config/layer-constants.cjs` and
 * `template-shell/.dependency-cruiser.cjs`; it is repeated here rather than
 * imported because this config must stay loadable with nothing built.
 *
 * 1. In-tree, symlink resolved: `preserveSymlinks` is false, so
 *    `@gears-frontx/api` resolves *through* the workspace symlink and then
 *    through the package's `exports`/`main` to `packages/api/dist/index.cjs` —
 *    which is why `dist` must stay in the graph (`doNotFollow`, never
 *    `exclude`). A source-path-only `to` never sees this edge.
 * 2. Under `node_modules/`: a genuinely installed, non-workspace-linked copy.
 * 3. Unresolvable: `resolved` falls back to the bare specifier, which is the
 *    normal shape before `npm install` and the only shape a template-side
 *    package ever has in this tree.
 */
const pkgTargets = (...dirs) => {
  const group = dirs.join('|');
  return [
    `^packages/(${group})/`,
    `(^|/)node_modules/@gears-frontx/(${group})(/|$)`,
    `^@gears-frontx/(${group})(/|$)`,
  ];
};

// Type-only edges become visible once `tsPreCompilationDeps` is on (see
// `options`). A type-level cycle is erased before emit, so the `no-circular`
// exemption lives in `viaOnly` — a per-edge `to.dependencyTypesNot` only
// filters the edge the cycle is evaluated from, leaving the same cycle
// reportable from its runtime side. Mirrors `internal/depcruise-config/core.cjs`.
const TYPE_ONLY_DEPENDENCY_TYPES = ['type-only', 'type-import'];

module.exports = {
  forbidden: [
    // ============ L0 BASE: UNIVERSAL RULES ============
    {
      name: 'no-circular',
      severity: 'error',
      from: { path: '^(?!.*node_modules)' },
      to: { circular: true, viaOnly: { dependencyTypesNot: TYPE_ONLY_DEPENDENCY_TYPES } },
      comment: 'Circular dependencies create tight coupling and make code harder to reason about.',
    },

    // ============ @gears-frontx/mfes BOUNDARY STUBS ============
    {
      name: 'mfes-no-type-format-literals',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-mfes-no-type-format-literals (MFES-1) — @gears-frontx/mfes must contain no type-system-format string literals.',
    },
    {
      name: 'mfes-no-solution-shared-properties',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-mfes-no-solution-shared-properties (MFES-2)',
    },
    {
      name: 'mfes-no-layout-domain-values',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-mfes-no-layout-domain-values (MFES-3)',
    },
    {
      name: 'mfes-no-type-format-dependency',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-mfes-no-type-format-dependency (MFES-4)',
    },
    {
      name: 'mfes-opaque-schema-surface',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-mfes-opaque-schema-surface (MFES-5)',
    },

    // ============ @gears-frontx/gts-plugin BOUNDARY STUBS ============
    {
      name: 'gts-plugin-owns-infra-schemas',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-gts-plugin-owns-infra-schemas (GTS-PLUGIN-1)',
    },
    {
      name: 'gts-plugin-excludes-solution-schemas',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-gts-plugin-excludes-solution-schemas (GTS-PLUGIN-2)',
    },

    // ============ @gears-frontx/api BOUNDARY STUB ============
    {
      name: 'api-no-solution-content',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-api-no-solution-content (API-1)',
    },

    // ============ @gears-frontx/cli BOUNDARY STUB ============
    {
      name: 'cli-template-independence',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-cli-template-independence (CLI-1)',
    },

    // ============ CORE SUBSTRATE BOUNDARY ENFORCEMENT (Phase 10) ============

    // @cpt-begin:cpt-frontx-constraint-mfes-no-type-format-dependency:p10:inst-dep-cruiser-rule
    {
      name: 'frontx-mfes-4-type-format-dep',
      severity: 'error',
      from: { path: '^packages/mfes/' },
      to: {
        path: [
          ...pkgTargets('gts-plugin'),
          '(^|/)node_modules/@globaltypesystem/',
          '^@globaltypesystem/',
        ],
      },
      comment: 'cpt-frontx-constraint-mfes-no-type-format-dependency (MFES-4): @gears-frontx/mfes must declare no dependency on any concrete type-format implementation.',
    },
    // @cpt-end:cpt-frontx-constraint-mfes-no-type-format-dependency:p10:inst-dep-cruiser-rule

    // @cpt-begin:cpt-frontx-constraint-gts-plugin-owns-infra-schemas:p10:inst-dep-cruiser-rule
    {
      name: 'frontx-gts-plugin-1-infra-schemas',
      severity: 'error',
      from: { path: '^packages/', pathNot: '^packages/gts-plugin/' },
      to: { path: '^packages/gts-plugin/src/frontx\\.mfes/' },
      comment: 'cpt-frontx-constraint-gts-plugin-owns-infra-schemas (GTS-PLUGIN-1): Infrastructure schemas are owned exclusively by @gears-frontx/gts-plugin.',
    },
    // @cpt-end:cpt-frontx-constraint-gts-plugin-owns-infra-schemas:p10:inst-dep-cruiser-rule

    // @cpt-begin:cpt-frontx-constraint-gts-plugin-excludes-solution-schemas:p10:inst-dep-cruiser-rule
    {
      name: 'frontx-gts-plugin-2-no-solution-schemas',
      severity: 'error',
      from: { path: '^packages/gts-plugin/' },
      to: { path: '^(?!packages/|node_modules/|internal/|scripts/).+' },
      comment: 'cpt-frontx-constraint-gts-plugin-excludes-solution-schemas (GTS-PLUGIN-2): @gears-frontx/gts-plugin must not import solution-specific schemas.',
    },
    // @cpt-end:cpt-frontx-constraint-gts-plugin-excludes-solution-schemas:p10:inst-dep-cruiser-rule

    // @cpt-begin:cpt-frontx-constraint-api-no-solution-content:p10:inst-dep-cruiser-rule
    {
      name: 'frontx-api-1-no-solution-content',
      severity: 'error',
      from: { path: '^packages/api/src/', pathNot: '__tests__' },
      to: { path: '^(?!packages/|node_modules/|internal/|scripts/).+' },
      comment: 'cpt-frontx-constraint-api-no-solution-content (API-1): @gears-frontx/api production surface must contain no solution-specific content.',
    },
    // @cpt-end:cpt-frontx-constraint-api-no-solution-content:p10:inst-dep-cruiser-rule

    {
      name: 'frontx-telemetry-1-no-template-content',
      severity: 'error',
      from: { path: '^packages/telemetry/src/', pathNot: '__tests__' },
      to: { path: '^(?!packages/|node_modules/|internal/|scripts/).+' },
      comment:
        'ecosystem-boundaries: @gears-frontx/telemetry is an ecosystem package and must not import template territory at the source level.',
    },
    {
      name: 'frontx-ui-kit-1-no-template-content',
      severity: 'error',
      // __test-utils__ is test-only plumbing (never built: not a Vite
      // entry, nulled in the exports map) and legitimately reads theme.css
      // via node:fs — the same carve-out telemetry's rule above gives its
      // __tests__ dir. Shipped component source stays fully covered.
      from: { path: '^packages/ui-kit/src/', pathNot: '\\.test\\.|__test-utils__' },
      to: { path: '^(?!packages/|node_modules/|internal/|scripts/).+' },
      comment:
        'ecosystem-boundaries: @gears-frontx/ui-kit is an ecosystem package and must not import template territory at the source level.',
    },

    // ============ CLI BOUNDARY ENFORCEMENT (Phase 17) ============

    // @cpt-begin:cpt-frontx-constraint-cli-template-independence:p17:inst-dep-cruiser-rule
    // Scoped to SHIPPED source only (packages/cli/src, excluding the
    // auto-generated version registry). packages/cli/templates/ and
    // packages/cli/template-sources/ are fixture/scratch dirs (NOT shipped —
    // package.json "files": ["dist"]) that legitimately contain template
    // names/content; they must never trip the CLI-1 boundary check.
    {
      name: 'frontx-cli-1-no-bundled-template-content',
      severity: 'error',
      from: { path: '^packages/cli/src/', pathNot: '^packages/cli/src/generated/' },
      to: { path: '^(?!packages/|node_modules/|internal/|scripts/).+', dependencyTypesNot: ['core'] },
      comment: 'cpt-frontx-constraint-cli-template-independence (CLI-1): @gears-frontx/cli must have zero dependency on bundled template content/assets/packages. Templates are resolved by source-spec at runtime.',
    },
    // @cpt-end:cpt-frontx-constraint-cli-template-independence:p17:inst-dep-cruiser-rule

    // ============ AI TOOLING BOUNDARY ENFORCEMENT (Phase 20) ============

    // @cpt-begin:cpt-frontx-adr-ai-driven-upgrade-orchestration:p20:inst-dep-cruiser-rule
    // DESIGN §3.4: "the inter-package dependency graph is intentionally
    // minimal. The single intra-ecosystem package dependency is the MFE
    // Runtime's consumption of the Type System plugin... The API Protocol
    // Surface, the CLI, and the AI Tooling Framework hold no intra-ecosystem
    // package dependencies. Coordination between the AI Tooling Framework
    // and the CLI is an orchestration relationship over the CLI's command
    // surface, not a compile-time package dependency." (ADR-0026
    // cpt-frontx-adr-ai-driven-upgrade-orchestration). These two rules
    // together enforce that the ONLY intra-ecosystem package edge is
    // @gears-frontx/mfes -> @gears-frontx/gts-plugin — in particular they
    // forbid @gears-frontx/cyber-pilot-kit-frontx -> @gears-frontx/cli
    // (reopened after a prior run shipped that edge).
    {
      name: 'frontx-single-intra-ecosystem-edge-api-standalone',
      severity: 'error',
      from: { path: '^packages/api/src/' },
      to: { path: pkgTargets('mfes', 'gts-plugin', 'cli', 'cyber-pilot-kit-frontx', 'telemetry') },
      comment:
        'cpt-frontx-adr-ai-driven-upgrade-orchestration: @gears-frontx/api holds no intra-ecosystem package dependency.',
    },
    {
      name: 'frontx-single-intra-ecosystem-edge-cli-standalone',
      severity: 'error',
      from: { path: '^packages/cli/src/' },
      to: { path: pkgTargets('mfes', 'gts-plugin', 'api', 'cyber-pilot-kit-frontx', 'telemetry') },
      comment:
        'cpt-frontx-adr-ai-driven-upgrade-orchestration: @gears-frontx/cli holds no intra-ecosystem package dependency.',
    },
    {
      name: 'frontx-single-intra-ecosystem-edge-kit-standalone',
      severity: 'error',
      from: { path: '^packages/cyber-pilot-kit-frontx/src/' },
      to: { path: pkgTargets('mfes', 'gts-plugin', 'api', 'cli', 'telemetry') },
      comment:
        'cpt-frontx-adr-ai-driven-upgrade-orchestration: @gears-frontx/cyber-pilot-kit-frontx holds no intra-ecosystem package dependency — in particular no @gears-frontx/cli edge; it coordinates with the CLI only over its command/invocation surface.',
    },
    {
      name: 'frontx-single-intra-ecosystem-edge-mfes-gts-plugin-only',
      severity: 'error',
      from: { path: '^packages/mfes/src/' },
      to: { path: pkgTargets('api', 'cli', 'cyber-pilot-kit-frontx', 'telemetry') },
      comment:
        'cpt-frontx-adr-ai-driven-upgrade-orchestration: the only intra-ecosystem package edge is @gears-frontx/mfes -> @gears-frontx/gts-plugin (via the type-substrate port); @gears-frontx/mfes must not depend on @gears-frontx/api, @gears-frontx/cli, or @gears-frontx/cyber-pilot-kit-frontx.',
    },
    // @cpt-end:cpt-frontx-adr-ai-driven-upgrade-orchestration:p20:inst-dep-cruiser-rule

    // Interim isolation while #495 defines UI Kit's architecture ownership and
    // dependency policy. Keep these rules outside CDSL markers: no accepted ADR
    // owns this boundary yet. Replace them with the approved, traced policy when
    // the temporary artifacts.toml ignore is removed.
    {
      name: 'frontx-ui-kit-interim-not-imported-by-ecosystem',
      severity: 'error',
      from: { path: '^packages/(mfes|gts-plugin|api|cli|cyber-pilot-kit-frontx|telemetry)/src/' },
      to: { path: pkgTargets('ui-kit') },
      comment:
        'INTERIM (#495): existing ecosystem packages must not acquire an unapproved dependency on @gears-frontx/ui-kit.',
    },
    {
      name: 'frontx-ui-kit-interim-no-intra-ecosystem-imports',
      severity: 'error',
      from: { path: '^packages/ui-kit/src/' },
      to: { path: pkgTargets('mfes', 'gts-plugin', 'api', 'cli', 'cyber-pilot-kit-frontx', 'telemetry') },
      comment:
        'INTERIM (#495): @gears-frontx/ui-kit remains isolated until its dependency policy is approved.',
    },
    {
      name: 'frontx-single-intra-ecosystem-edge-telemetry-standalone',
      severity: 'error',
      from: { path: '^packages/telemetry/src/' },
      to: { path: pkgTargets('mfes', 'gts-plugin', 'api', 'cli', 'cyber-pilot-kit-frontx', 'ui-kit') },
      comment:
        'ecosystem-boundaries: @gears-frontx/telemetry holds no intra-ecosystem package dependency.',
    },

    // ============ TEST-SUPPORT BOUNDARY ENFORCEMENT ============

    // `@gears-frontx/test-support` (internal/test-support) is a test-only
    // path-containment helper: `layer-constants.cjs`'s `ALLOWED_ECOSYSTEM_EDGES`
    // lists it only under `cli.dev`/`cyber-pilot-kit-frontx.dev`, and
    // `scripts/package-edge-tests.ts` (`npm run arch:edges`) checks that at the
    // package.json-manifest level only. This rule is the import-graph side of
    // the same boundary: it forbids any *production* source file from
    // importing it, regardless of what a package's manifest declares. Test
    // files are excluded by shape (`.test.ts`/`.test.tsx`, or anything under a
    // `__tests__/`/`__test-utils__/` directory), matching the same convention
    // `frontx-ui-kit-1-no-template-content` above uses for its own test
    // carve-out.
    {
      name: 'frontx-test-support-test-only',
      severity: 'error',
      from: {
        path: '^packages/[^/]+/src/',
        pathNot: '\\.test\\.(ts|tsx)$|__tests__|__test-utils__',
      },
      to: {
        path: [
          '^internal/test-support/',
          '(^|/)node_modules/@gears-frontx/test-support(/|$)',
          '^@gears-frontx/test-support(/|$)',
        ],
      },
      comment:
        '@gears-frontx/test-support is a test-only path-containment helper; no production source file may import it.',
    },
  ],
  options: {
    // `node_modules` and `packages/*/dist` are bounded here, not in `exclude`.
    // `exclude` removes a module from the graph outright, so anything listed
    // there is unusable as a rule's `to` — which is precisely how the
    // intra-ecosystem edge rules above were vacuous: a workspace import
    // resolves through `exports`/`main` to `packages/<pkg>/dist/...`, and
    // excluding `dist` deleted the very node those rules needed to match.
    // `doNotFollow` keeps the node visible as an un-traversed leaf, which is
    // all the noise reduction that was ever wanted.
    //
    // `node_modules` matches at any depth, not just the root — see
    // `internal/depcruise-config/base.cjs` for why (#523). The `dist` entry
    // stays anchored: it is deliberately workspace-root-relative.
    doNotFollow: { path: ['(^|/)node_modules/', '^packages/[^/]+/dist'] },
    exclude: {
      dynamic: true,
      // Only genuinely-not-ours trees are path-excluded, and none of them is a
      // rule target: `packages/cli/templates` and `template-sources` are
      // fixture/scratch dirs the CLI resolves at runtime rather than imports,
      // `packages/mfes/mfes` is generated output, and `.claude/worktrees` are
      // disposable agent-spawned repo checkouts.
      path: 'packages/mfes/mfes|packages/cli/templates|packages/cli/template-sources|\\.claude',
    },
    // Type-only imports are erased before emit, so without this a boundary
    // crossing written as `import type` is invisible to every rule above. The
    // boundary contract is about coupling, not about what survives to runtime.
    // `no-circular` compensates via `viaOnly` (see the top of this file).
    tsPreCompilationDeps: true,
    // dependency-cruiser defaults `exportsFields` to `[]` (its enhanced-resolve
    // 4 backwards-compatibility choice), which makes the `exports` map
    // invisible and leaves resolution to the legacy `main`. Dependencies that
    // ship an `exports` map and no `main` - `@tanstack/react-table`,
    // `@shadcn/react/*` - therefore came back `couldNotResolve`, and an
    // unresolved specifier keeps its bare form as `resolved`, which reads as
    // "outside packages/" and tripped `frontx-ui-kit-1-no-template-content` on
    // ordinary node_modules imports. Restoring enhanced-resolve's own defaults
    // makes them resolve the way Node and the bundlers already do.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
