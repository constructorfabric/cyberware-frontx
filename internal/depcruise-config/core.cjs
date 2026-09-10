/**
 * FrontX Dependency Cruiser Core Configuration
 * Rules for the published libraries holding the `core` property — the
 * UI-framework-agnostic subset of the published-libraries layer
 * (architecture/DESIGN.md §1.3). Membership is the property, not this file's
 * choice: the source set derives from `PUBLISHED_LIBRARY_PROPERTIES` in
 * layer-constants.cjs.
 *
 * Core packages MUST have:
 * - NO @gears-frontx/* imports, with exactly one exception: the type-substrate
 *   port (gts-plugin -> mfes), the `GTS -- "type-substrate port" --> MFES` edge
 *   of the DESIGN §1.3 diagram.
 * - NO React imports (the substrate is UI-framework-agnostic —
 *   `cpt-frontx-principle-agnostic-core`).
 *
 * Replaces the former `sdk.cjs` (L1 of the retired SDK -> framework -> react
 * chain); the packages that chain governed now live in the templates
 * repository and are enforced by that repository's own
 * `.dependency-cruiser.cjs`.
 */

const base = require('./base.cjs');
const {
  CORE_SRC_PATTERN,
  TYPE_SUBSTRATE_IMPORT_PORT,
  GEARS_FRONTX_TARGET_PATTERNS,
} = require('./layer-constants.cjs');

const PORT_SRC_PATTERN = `^packages/${TYPE_SUBSTRATE_IMPORT_PORT.from}/src`;

// The port's permitted target, in every shape it can resolve to (see
// GEARS_FRONTX_TARGET_PATTERNS in layer-constants.cjs).
const PORT_TARGET_PATTERNS = [
  `^packages/${TYPE_SUBSTRATE_IMPORT_PORT.to}/`,
  `(^|/)@gears-frontx/${TYPE_SUBSTRATE_IMPORT_PORT.to}(/|$)`,
];

// `CORE_SRC_PATTERN` captures the owning package name in group 1, and
// `ECOSYSTEM_TARGET_PATTERN` captures the target's. depcruise substitutes `$1`
// in `to.pathNot` from the `from.path` match, so this exempts a module from
// "importing" its own package — without it every intra-package import in
// `packages/api/src` would match the cross-package target pattern.
const OWN_PACKAGE_PATTERN = '^packages/$1/';

// Turning on `tsPreCompilationDeps` (below) makes type-only edges visible to
// every rule, including base's `no-circular`. Type-level cycles are erased
// before emit and are an idiomatic TS shape (`types.ts` <-> the class it types),
// so counting them here would report two pre-existing non-problems in `mfes` and
// `api` and pressure someone into reshaping working code. The exemption lives
// in `viaOnly` — a per-edge `to.dependencyTypesNot` only filters the edge the
// cycle is evaluated from, so the same cycle would still be reported from its
// runtime side; `viaOnly` requires every edge in the cycle to be runtime, which
// is exactly "the cycle survives to runtime". The rule keeps its name —
// `verify-guard-configs.ts` asserts base inheritance by that name.
const TYPE_ONLY_DEPENDENCY_TYPES = ['type-only', 'type-import'];
const baseNoCircular = base.forbidden.find((rule) => rule.name === 'no-circular');
const runtimeOnlyNoCircular = {
  ...baseNoCircular,
  to: {
    ...baseNoCircular.to,
    viaOnly: { dependencyTypesNot: TYPE_ONLY_DEPENDENCY_TYPES },
  },
};

module.exports = {
  forbidden: [
    ...base.forbidden.filter((rule) => rule.name !== 'no-circular'),
    runtimeOnlyNoCircular,

    // ============ CORE ISOLATION RULES ============
    {
      name: 'core-no-gears-frontx-imports',
      severity: 'error',
      from: { path: CORE_SRC_PATTERN, pathNot: PORT_SRC_PATTERN },
      to: { path: GEARS_FRONTX_TARGET_PATTERNS, pathNot: OWN_PACKAGE_PATTERN },
      comment:
        'CORE VIOLATION: core published libraries must have ZERO @gears-frontx imports. The only permitted cross-package edge is the type-substrate port (gts-plugin -> mfes).',
    },
    {
      name: 'core-port-provider-only-imports-runtime',
      severity: 'error',
      from: { path: PORT_SRC_PATTERN },
      to: {
        path: GEARS_FRONTX_TARGET_PATTERNS,
        pathNot: [`^packages/${TYPE_SUBSTRATE_IMPORT_PORT.from}/`, ...PORT_TARGET_PATTERNS],
      },
      comment:
        'CORE VIOLATION: The type-system provider may only import the runtime it implements the type-substrate port for. No other @gears-frontx import is permitted.',
    },
    {
      name: 'core-no-react',
      severity: 'error',
      from: { path: CORE_SRC_PATTERN },
      // Both React packages, in both resolution shapes. `react-dom` is not
      // reachable via the `react` pattern, and an uninstalled tree yields the
      // bare specifier — see GEARS_FRONTX_TARGET_PATTERNS in layer-constants.cjs
      // for the same three-shape reasoning applied to workspace packages.
      to: { path: '(^|/)node_modules/react(-dom)?(/|$)|^react(-dom)?(/|$)' },
      comment:
        'CORE VIOLATION: core published libraries cannot import React. The substrate must stay UI-framework-agnostic (cpt-frontx-principle-agnostic-core).',
    },
  ],
  options: {
    ...base.options,
    // Type-only imports are erased before the emitted graph exists, so without
    // this the port edge (`import type { TypeSystemPlugin } from
    // '@gears-frontx/mfes'`) — and any boundary crossing written as `import
    // type` — is invisible to every rule above. The layer contract is about
    // coupling, not about whether the coupling survives to runtime.
    tsPreCompilationDeps: true,
  },
};
