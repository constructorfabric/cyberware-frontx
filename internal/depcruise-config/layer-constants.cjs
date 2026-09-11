/**
 * Single source of truth for the FrontX ecosystem's boundary model.
 *
 * Both the depcruise rules (internal/depcruise-config/core.cjs, consumed by
 * `npm run arch:deps:core`) and the package.json edge guard
 * (scripts/package-edge-tests.ts, consumed by `npm run arch:edges`) derive
 * their layer membership and allowed-edge lists from this module, so the
 * import-graph check and the manifest check cannot disagree about what the
 * layering is.
 *
 * The model here is the ecosystem layer partition of `architecture/DESIGN.md`
 * §1.3: three layers — published libraries, templates, projects orchestration —
 * with membership defined by property, plus the two stated non-layer categories
 * (build internals; non-package code). Templates are hosted outside this
 * repository and resolved by versioned source-spec, so no template-side package
 * may appear in this file; the template owns and enforces its own internal
 * layering in `template-shell/.dependency-cruiser.cjs`. This is NOT the historic
 * L1/L2/L3 SDK -> framework -> react chain — that chain described packages
 * (`state`, `i18n`, `framework`, `react`, `auth`, `studio`) that emigrated to
 * the self-contained `template-shell/` tree.
 */

/**
 * Published-libraries layer (DESIGN §1.3): units consumed as versioned
 * dependencies that do not drive a project's lifecycle. Keyed by directory name
 * under `packages/`, each carrying the layer's two independent properties:
 *
 * - `core` — the library must remain UI-framework-agnostic
 *   (`cpt-frontx-principle-agnostic-core`). Enforced by `core-no-react` over
 *   `CORE_SRC_PATTERN` below, so a `true` here is what puts the package under
 *   that rule; flipping it to `false` is an architecture decision, not a fix.
 * - `standalone` — the library declares no intra-ecosystem package dependency,
 *   with the single exception of the type-substrate port. Asserted against
 *   `ALLOWED_ECOSYSTEM_EDGES` by `arch:edges`, so a standalone library's
 *   allowlist cannot quietly grow a non-port runtime edge while the property
 *   still claims otherwise.
 *
 * The two are independent: a library may hold either, both, or neither.
 * `ui-kit` is the current example of the split — a React component library,
 * so not `core`, yet a full layer member that is `standalone`. Its import-graph
 * isolation is additionally carried by the `frontx-ui-kit-interim-*` rules in
 * the root `.dependency-cruiser.cjs` until its extraction PR replaces them with
 * the approved, traced dependency policy.
 */
const PUBLISHED_LIBRARY_PROPERTIES = Object.freeze({
  api: Object.freeze({ core: true, standalone: true }),
  'gts-plugin': Object.freeze({ core: true, standalone: true }),
  mfes: Object.freeze({ core: true, standalone: true }),
  telemetry: Object.freeze({ core: true, standalone: true }),
  'ui-kit': Object.freeze({ core: false, standalone: true }),
});

const PUBLISHED_LIBRARY_PACKAGES = Object.freeze(Object.keys(PUBLISHED_LIBRARY_PROPERTIES));

// The core subset, derived from the property rather than authored — the list
// `['api', 'gts-plugin', 'mfes', 'telemetry']` is a consequence, not a
// definition (DESIGN §1.3: membership is a property of the package).
const CORE_PACKAGES = Object.freeze(
  PUBLISHED_LIBRARY_PACKAGES.filter((name) => PUBLISHED_LIBRARY_PROPERTIES[name].core)
);

// Projects-orchestration layer (DESIGN §1.3): units that act on a project's
// lifecycle across the other layers — the lifecycle CLI and the AI Tooling
// Framework kit that drives it. Directory names under `packages/`.
const PROJECTS_ORCHESTRATION_PACKAGES = Object.freeze(['cli', 'cyber-pilot-kit-frontx']);

// Build internals (DESIGN §1.3): packages that exist only to configure the
// build, are never published, and belong to no layer. Still subject to the
// dependency-edge guard — `internal/*` is a root workspace just like
// `packages/*`, so a package consuming one is declaring a real workspace edge,
// even though the edge only exists at lint/build time. Exempt from the member
// artifact chain and the publication gate, with that scope stated in the
// DESIGN rather than implied. Directory names under `internal/`.
const BUILD_INTERNALS_PACKAGES = Object.freeze(['eslint-config', 'depcruise-config', 'test-support']);

// Every ecosystem package, in layer order.
const ECOSYSTEM_PACKAGES = Object.freeze([
  ...PUBLISHED_LIBRARY_PACKAGES,
  ...PROJECTS_ORCHESTRATION_PACKAGES,
  ...BUILD_INTERNALS_PACKAGES,
]);

/**
 * Directory of each ecosystem package, relative to the repo root. The two
 * workspace roots (`packages/*`, `internal/*`) mean a package's name does not
 * determine its location, so anything resolving a package directory must go
 * through this map rather than assuming a prefix.
 */
const ECOSYSTEM_PACKAGE_DIRS = Object.freeze(
  Object.fromEntries([
    ...PUBLISHED_LIBRARY_PACKAGES.map((name) => [name, `packages/${name}`]),
    ...PROJECTS_ORCHESTRATION_PACKAGES.map((name) => [name, `packages/${name}`]),
    ...BUILD_INTERNALS_PACKAGES.map((name) => [name, `internal/${name}`]),
  ])
);

/**
 * The complete set of `@gears-frontx/*` package.json edges the boundary model
 * permits, keyed by the depending package's directory name. An ecosystem package
 * declaring any `@gears-frontx/*` dependency outside its entry here is a layer
 * violation — which is also how the template boundary is enforced: no
 * template-side package name appears in any allowlist, so an ecosystem package
 * that starts depending on one fails without the guard needing to know the
 * template's identity or location.
 *
 * Each entry splits the edges by what the dependency group *means*, because the
 * two are not interchangeable:
 *
 * - `runtime` — `dependencies` + `peerDependencies`. These are the layering
 *   proper: an edge here ships to consumers and constrains the
 *   architecture. Keep these minimal and justified individually.
 * - `dev` — `devDependencies`. Build/lint config consumed at development time
 *   only. Still allowlisted rather than waved through, so a genuine
 *   boundary-crossing coupling cannot hide by being declared under devDeps, but
 *   held separately so that legitimately depending on a shared ESLint config is
 *   not reported as a runtime layer violation.
 *
 * An omitted or empty list means "zero @gears-frontx dependencies in that group".
 */
const ALLOWED_ECOSYSTEM_EDGES = Object.freeze({
  // ---- Published libraries ----
  api: Object.freeze({
    runtime: Object.freeze([]),
    dev: Object.freeze([
      // Shared lint/architecture config, required by `eslint.config.js` and
      // `.dependency-cruiser.cjs`. Build-time only — nothing under `src/` may
      // import these, which `core-no-gears-frontx-imports` enforces separately.
      '@gears-frontx/eslint-config',
      '@gears-frontx/depcruise-config',
    ]),
  }),
  mfes: Object.freeze({
    runtime: Object.freeze([
      // Optional peer only — the injection contract for the default type-substrate
      // provider (`cpt-frontx-adr-default-type-substrate-provider`). The runtime
      // must not *import* it; that direction is forbidden by
      // `core-no-gears-frontx-imports` in core.cjs and by the MFES-4 boundary
      // check in `npm run arch:check`.
      '@gears-frontx/gts-plugin',
    ]),
    dev: Object.freeze([]),
  }),
  // Standalone browser SDK: no `@gears-frontx` edge in either group. Asserted
  // rather than assumed — an empty entry here is what makes adding one fail.
  telemetry: Object.freeze({ runtime: Object.freeze([]), dev: Object.freeze([]) }),
  'gts-plugin': Object.freeze({
    runtime: Object.freeze([
      // The type-substrate port: the provider implements the runtime's opaque
      // port, so it imports the port's types from the runtime. This is the
      // `GTS -- "type-substrate port" --> MFES` edge of the DESIGN §1.3
      // diagram, specified in `packages/mfes/architecture/features/type-substrate-port/`.
      '@gears-frontx/mfes',
    ]),
    dev: Object.freeze([]),
  }),
  // React and react-dom are peers, not `@gears-frontx` edges, so the standalone
  // property holds; the `frontx-ui-kit-interim-*` depcruise rules assert the
  // same isolation at the import-graph level.
  'ui-kit': Object.freeze({ runtime: Object.freeze([]), dev: Object.freeze([]) }),

  // ---- Projects orchestration ----
  cli: Object.freeze({
    runtime: Object.freeze([]),
    // Test-only path-containment helper, exercised by the CLI's own test suite.
    dev: Object.freeze(['@gears-frontx/test-support']),
  }),
  // KIT --> CLI is a *command-surface* relationship, not a package edge: the AI
  // upgrade orchestration (`cpt-frontx-adr-ai-driven-upgrade-orchestration`)
  // invokes the `frontx` CLI as a process, deliberately without depending on it
  // (see the wiring commit "command-surface-only, no package edge"). The
  // import-graph side of that is `frontx-single-intra-ecosystem-edge-kit-standalone`
  // in the root `.dependency-cruiser.cjs`; listing `@gears-frontx/cli` here would
  // permit exactly the manifest edge the ADR forbids.
  'cyber-pilot-kit-frontx': Object.freeze({
    runtime: Object.freeze([]),
    // Test-only path-containment helper, exercised by the kit's own test suite.
    dev: Object.freeze(['@gears-frontx/test-support']),
  }),

  // ---- Build internals (internal/*) ----
  // These sit below everything: a config package depending on another ecosystem
  // package would invert the build order.
  'eslint-config': Object.freeze({ runtime: Object.freeze([]), dev: Object.freeze([]) }),
  'depcruise-config': Object.freeze({ runtime: Object.freeze([]), dev: Object.freeze([]) }),
  'test-support': Object.freeze({ runtime: Object.freeze([]), dev: Object.freeze([]) }),
});

/**
 * Edges the boundary model requires to exist, asserted positively so the guard
 * fails if the port is silently dropped rather than only when an extra edge
 * appears. `[dependingPackageDir, dependencyName, whatItIs]`.
 */
const REQUIRED_ECOSYSTEM_EDGES = Object.freeze([
  Object.freeze(['gts-plugin', '@gears-frontx/mfes', 'type-substrate port']),
]);

/**
 * The type-substrate port: the one intra-ecosystem coupling the standalone
 * property exempts, in both of its shapes. At the manifest level it is
 * `mfes -> gts-plugin` (an optional peer, the injection contract); at the
 * import-graph level it is `gts-plugin -> mfes` (the provider imports the
 * port's types from the runtime it implements). Kept separate from
 * `ALLOWED_ECOSYSTEM_EDGES` because the import edge has no matching manifest
 * entry of its own: at the import-graph level the published libraries are
 * import-acyclic and only this package may reach across.
 */
const TYPE_SUBSTRATE_IMPORT_PORT = Object.freeze({
  from: 'gts-plugin',
  to: 'mfes',
});

/**
 * The manifest-level runtime edges the type-substrate port accounts for —
 * the exception written into the standalone property (DESIGN §1.3). Both
 * directions appear because the port is one contract with two shapes (see
 * TYPE_SUBSTRATE_IMPORT_PORT above). `arch:edges` uses this to verify that a
 * standalone library's allowlist permits nothing the port does not explain.
 */
const TYPE_SUBSTRATE_PORT_MANIFEST_EDGES = Object.freeze([
  Object.freeze(['gts-plugin', '@gears-frontx/mfes']),
  Object.freeze(['mfes', '@gears-frontx/gts-plugin']),
]);

/**
 * Regex source matching every core package's src root, for depcruise
 * `from`/`to` path rules. Derived from the core property above so the rules
 * and the manifest guard cannot drift.
 */
const CORE_SRC_PATTERN = `^packages/(${CORE_PACKAGES.join('|')})/src`;

/**
 * A `@gears-frontx/*` import reaches dependency-cruiser under one of three
 * resolved shapes, and a `to` rule that covers only one of them is a rule that
 * silently never fires. `preserveSymlinks` is false by default, so the shape you
 * would expect — `node_modules/@gears-frontx/<pkg>` — is in practice the one you
 * almost never see:
 *
 * 1. In-tree, symlink resolved: a workspace package resolves *through* the
 *    `node_modules/@gears-frontx/<pkg>` symlink to its real path, e.g.
 *    `@gears-frontx/mfes` -> `packages/mfes/dist/index.cjs`.
 * 2. Under `node_modules/`: a genuinely installed (non-workspace-linked) copy.
 * 3. Unresolvable: `resolved` falls back to the bare specifier, which is how a
 *    reference to a template-side package (`@gears-frontx/framework`, absent
 *    from the ecosystem tree) shows up. Matching it is what keeps the template
 *    boundary enforced at the import-graph level too.
 *
 * `ECOSYSTEM_TARGET_PATTERN` covers shape 1 and captures the target package name
 * so rules can exempt a module's own package; `BARE_SPECIFIER_PATTERN` covers
 * shapes 2 and 3.
 */
const ECOSYSTEM_TARGET_PATTERN = `^(${Object.values(ECOSYSTEM_PACKAGE_DIRS)
  .map((dir) => dir.replace('/', '\\/'))
  .join('|')})/`;
const BARE_SPECIFIER_PATTERN = '(^|/)@gears-frontx/';

/** Both shapes, for use as a `to.path` alternation. */
const GEARS_FRONTX_TARGET_PATTERNS = Object.freeze([
  ECOSYSTEM_TARGET_PATTERN,
  BARE_SPECIFIER_PATTERN,
]);

module.exports = {
  PUBLISHED_LIBRARY_PROPERTIES,
  PUBLISHED_LIBRARY_PACKAGES,
  CORE_PACKAGES,
  PROJECTS_ORCHESTRATION_PACKAGES,
  BUILD_INTERNALS_PACKAGES,
  ECOSYSTEM_PACKAGES,
  ECOSYSTEM_PACKAGE_DIRS,
  ALLOWED_ECOSYSTEM_EDGES,
  REQUIRED_ECOSYSTEM_EDGES,
  TYPE_SUBSTRATE_IMPORT_PORT,
  TYPE_SUBSTRATE_PORT_MANIFEST_EDGES,
  CORE_SRC_PATTERN,
  ECOSYSTEM_TARGET_PATTERN,
  BARE_SPECIFIER_PATTERN,
  GEARS_FRONTX_TARGET_PATTERNS,
};
