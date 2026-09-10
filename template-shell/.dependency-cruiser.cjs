/**
 * FrontX Template Dependency Cruiser Configuration (template-shell/, self-contained)
 *
 * Template-internal layering/isolation rules, relocated here from the
 * ecosystem monorepo root by Phase 11 template-move: MFE vertical-slice
 * isolation, screenset flux architecture, app/package boundary, and the
 * state/i18n -> framework -> react layer purity chain — all fully contained
 * within this directory. See the ecosystem root's `.dependency-cruiser.cjs`
 * for the rules that still apply to `mfes`, `gts-plugin`, `api`, `cli`,
 * `screensets`.
 *
 * This is the template's only dependency-cruiser config. The former
 * `template-shell/internal/depcruise-config/` copy and the four per-package
 * `.dependency-cruiser.cjs` files it served are deleted: the
 * `arch:deps:sdk|framework|react` scripts that loaded them are gone, which left
 * them as present-but-dead guard config. The two rules that had no survivor
 * here — error-severity `no-circular` and `sdk-no-gears-frontx-imports` — are
 * restored below rather than dropped.
 */

/**
 * A cross-package import inside this tree reaches dependency-cruiser under two
 * different shapes, and a `to` rule covering only one of them never fires:
 *
 * 1. Resolved: with `node_modules` installed, `preserveSymlinks` is false, so
 *    `@gears-frontx/state` resolves through the workspace symlink and then
 *    through the package's `exports`/`main` — which every package here points at
 *    `./dist/...`. The resolved path is therefore `packages/state/dist/index.js`,
 *    NOT `packages/state/src/...`, which is why `dist` must stay in the graph
 *    (see `doNotFollow` below, not `exclude`).
 * 2. Unresolvable: with `node_modules` absent — the normal state of this tree,
 *    which is consumed as a template rather than installed — `resolved` falls
 *    back to the bare specifier `@gears-frontx/state`.
 *
 * `pkgTargets` covers both, derived from the package directory names, so the
 * layer chain holds in an installed tree and in a bare one.
 */
const pkgTargets = (...dirs) => {
  const group = dirs.join('|');
  return [`^packages/(${group})/`, `(^|/)@gears-frontx/(${group})(/|$)`];
};

/**
 * Every workspace package in this tree, for the rules that mean "any sibling
 * package" rather than a named layer. Kept as a list so adding a package to
 * `packages/` does not silently narrow those rules.
 */
const TEMPLATE_PACKAGES = ['auth', 'state', 'i18n', 'framework', 'react', 'studio', 'mfe-test-support'];

/**
 * Own-package exemption for a `to` built from `pkgTargets`, in both shapes.
 * `$1` is substituted from the `from.path` capture group, so a rule using this
 * must capture the depending package's directory name.
 */
const OWN_PACKAGE_PATTERNS = ['^packages/$1/', '(^|/)@gears-frontx/$1(/|$)'];

// Type-only edges are visible because `tsPreCompilationDeps` is on (see
// `options` below), and a `types.ts` <-> the class it types cycle is idiomatic
// TS that is erased before emit. The exemption lives in `viaOnly`, not in a
// per-edge `to.dependencyTypesNot`: the latter only filters the edge the cycle
// is evaluated from, so the same cycle is still reported from its runtime side.
// `viaOnly` requires *every* edge in the cycle to be runtime, which is exactly
// "the cycle survives to runtime". Mirrors `internal/depcruise-config/core.cjs`.
const TYPE_ONLY_DEPENDENCY_TYPES = ['type-only', 'type-import'];

module.exports = {
  forbidden: [
    // ============ L0 BASE: UNIVERSAL RULES ============
    // Restored here from the `internal/depcruise-config/base.cjs` copy that the
    // deleted `arch:deps:sdk|framework|react` scripts used to load. Those
    // scripts were the only consumers of that copy, so dropping them without
    // this rule would have quietly retired error-severity cycle detection over
    // `packages/` — `no-circular-screenset-deps` below is `warn` and covers
    // only `src-app/screensets`.
    {
      name: 'no-circular',
      severity: 'error',
      from: { path: '^(?!.*node_modules)' },
      to: { circular: true, viaOnly: { dependencyTypesNot: TYPE_ONLY_DEPENDENCY_TYPES } },
      comment:
        'Circular dependencies create tight coupling and make code harder to reason about.',
    },

    // ============ L4 SCREENSET: ISOLATION RULES ============
    {
      name: 'no-cross-mfe-imports',
      severity: 'error',
      from: { path: '^src-app/mfe_packages/([^/]+)/' },
      to: {
        path: '^src-app/mfe_packages/[^/]+/',
        pathNot: [
          '^src-app/mfe_packages/$1/',
          '^src-app/mfe_packages/shared/',
        ],
      },
      comment: 'MFE packages must not import from other MFE packages (vertical slice isolation).',
    },
    {
      name: 'no-circular-screenset-deps',
      severity: 'warn',
      from: { path: '^src-app/screensets/([^/]+)/' },
      to: {
        path: '^src-app/screensets/$1/',
        circular: true,
      },
      comment: 'Avoid circular dependencies within screenset modules.',
    },

    // ============ L4 SCREENSET: FLUX ARCHITECTURE RULES ============
    {
      name: 'flux-no-actions-in-effects-folder',
      severity: 'error',
      from: { path: '/effects/' },
      to: { path: '/actions/' },
      comment: 'FLUX VIOLATION: Effects folder cannot import from actions folder.',
    },
    {
      name: 'flux-no-effects-in-actions-folder',
      severity: 'error',
      from: { path: '/actions/' },
      to: { path: '/effects/' },
      comment: 'FLUX VIOLATION: Actions folder cannot import from effects folder.',
    },

    // ============ TEMPLATE PACKAGE RULES ============
    {
      name: 'no-internal-package-imports',
      severity: 'error',
      from: { path: '^src-app/' },
      to: { path: '^packages/[^/]+/src/' },
      comment: 'MONOREPO VIOLATION: App cannot import package internals. Use package root exports.'
    },
    {
      name: 'sdk-no-framework-import',
      severity: 'error',
      from: { path: '^packages/(state|i18n)/' },
      to: { path: pkgTargets('framework', 'react') },
      comment: 'SDK VIOLATION: SDK packages (L1) cannot import from Framework (L2) or React (L3) layers.'
    },
    {
      // Deliberately overlaps `sdk-no-framework-import` above. That rule states
      // the layer chain (L1 must not reach up to L2/L3) and is the message you
      // want when the chain is what was broken; this one states the stronger
      // property the SDK layer actually has — complete isolation from *every*
      // sibling package, including ones no layer rule names (`auth`, `studio`).
      // Restored from the `sdk-no-gears-frontx-imports` rule in the
      // `internal/depcruise-config/sdk.cjs` copy that the deleted
      // `arch:deps:sdk` script loaded; without it `@gears-frontx/state`
      // importing `@gears-frontx/auth` became legal.
      name: 'sdk-no-gears-frontx-imports',
      severity: 'error',
      from: { path: '^packages/(state|i18n)/' },
      to: { path: pkgTargets(...TEMPLATE_PACKAGES), pathNot: OWN_PACKAGE_PATTERNS },
      comment: 'SDK VIOLATION: SDK packages must have ZERO @gears-frontx dependencies. Each SDK package is completely isolated.'
    },
    {
      name: 'framework-no-react',
      severity: 'error',
      from: { path: '^packages/framework/' },
      to: { path: pkgTargets('react') },
      comment: 'LAYER VIOLATION: Framework (L2) cannot import React (L3).'
    },
    {
      // Distinct from `framework-no-react` above, which forbids the workspace
      // *package* `@gears-frontx/react`. This forbids the React *library*: L1 and
      // L2 are headless, and only the L3 adapter may bind to a UI framework.
      // Carried over from the per-package configs at
      // `packages/{framework,state,i18n}/.dependency-cruiser.cjs`, retired when
      // the template stopped extending the ecosystem's `sdk`/`framework` configs.
      // `^react(-dom)?(/|$)` matches the bare-specifier fallback for a tree whose
      // node_modules is not installed.
      name: 'headless-packages-no-react-library',
      severity: 'error',
      from: { path: '^packages/(framework|state|i18n)/' },
      to: { path: '(^|/)node_modules/react(-dom)?(/|$)|^react(-dom)?(/|$)' },
      comment: 'LAYER VIOLATION: Framework (L2) and SDK (L1) packages cannot import React. Only the React adapter (L3) binds to a UI framework.'
    },
    {
      name: 'react-no-sdk',
      severity: 'error',
      from: { path: '^packages/react/' },
      to: { path: pkgTargets('state', 'i18n') },
      comment: 'LAYER VIOLATION: React (L3) cannot import SDK (L1) directly. Use @gears-frontx/framework re-exports.'
    },
    {
      name: 'packages-no-src-app-import',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^src-app/' },
      comment: 'PACKAGE VIOLATION: Packages cannot import from app src-app/. Packages must be self-contained.'
    },
  ],
  options: {
    // `packages/*/dist` and `src-app/mfe_packages/*/dist` are here rather than in
    // `exclude` on purpose. `exclude` removes a module from the graph outright,
    // and since every package's `exports`/`main` points at `./dist/...`,
    // excluding it deletes the very node every cross-package layer rule needs as
    // its `to` — silently making the layer chain unenforceable. `doNotFollow`
    // keeps the node visible as an un-traversed leaf, which is all the noise
    // reduction that was wanted. A composed MFE overlay builds into
    // `src-app/mfe_packages/*/dist` the same way, and `arch:deps` has no more
    // business type-parsing that output than a package's own.
    //
    // node_modules is matched at ANY depth, not just the root: after
    // registering and applying template-mfe (or CI's composition of
    // template-mfe onto this shell), `npm install` nests a node_modules
    // under each src-app/mfe_packages/* workspace whose pins conflict with
    // the shell's. Anchored `^node_modules`
    // misses those, and dependency-cruiser then traverses the entire installed
    // dependency universe — which is not a rule violation but an OOM. Those same
    // overlaid workspaces build into `src-app/mfe_packages/*/dist`, listed below
    // beside `packages/*/dist` for the same reason: bundled output no rule can
    // fire on, which `tsPreCompilationDeps` would otherwise type-parse in full.
    doNotFollow: {
      path: [
        '(^|/)node_modules/',
        '^packages/[^/]+/dist',
        '^src-app/mfe_packages/[^/]+/dist',
      ],
    },
    // Nothing is path-excluded. `exclude` drops modules from the graph outright,
    // so anything listed here becomes unusable as a rule's `to` — which is how
    // both `node_modules` (React) and `packages/*/dist` (every cross-package
    // edge) were silently unreachable. Traversal is bounded by `doNotFollow`
    // above instead, which keeps the nodes visible.
    exclude: {
      dynamic: true,
    },
    // Type-only imports are erased before emit, so without this an
    // `import type { ReactNode } from 'react'` in a headless package — or any
    // boundary crossing written as `import type` — is invisible to every rule
    // above. The layer contract is about coupling, not about what survives to
    // runtime. Mirrors `internal/depcruise-config/core.cjs`.
    tsPreCompilationDeps: true,
  },
};
