/**
 * FrontX Dependency Cruiser Configuration Package (ecosystem)
 *
 * Configuration for the FrontX ecosystem's boundary model
 * (architecture/DESIGN.md §1.3):
 * - base: universal rules for all ecosystem code
 * - core: Core Framework layer (api, gts-plugin, mfes) — zero @gears-frontx
 *   imports except the type-substrate port, and no React
 *
 * The former `framework`, `react`, and `screenset` configs described the
 * retired L1/L2/L3 chain, whose packages emigrated to the templates
 * repository. That repository enforces its own internal layering in its
 * own `.dependency-cruiser.cjs`; this package is ecosystem-only.
 */

module.exports = {
  base: require('./base.cjs'),
  core: require('./core.cjs'),
};
