#!/usr/bin/env node

/**
 * FrontX Architecture Validation Script (Monorepo)
 * Self-contained after Phase 11 template-move (the template relocated to its
 * own top-level directory; packages/cli preserved as the greenfield CLI).
 */

import { execSync } from 'child_process';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

// ─── Standalone helpers (previously in packages/cli/template-sources) ───────

interface Colors {
  red: string;
  green: string;
  yellow: string;
  blue: string;
  reset: string;
}

const colors: Colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

export function log(message: string, color: keyof Colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

export interface CommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface ValidationResult {
  passed: number;
  total: number;
  success: boolean;
}

export interface ArchCheck {
  command: string;
  description: string;
}

export function runCommand(command: string, description: string): boolean {
  log(`🔍 ${description}...`, 'blue');
  try {
    execSync(command, { stdio: 'inherit' });
    log(`✅ ${description} - PASSED`, 'green');
    return true;
  } catch (error: unknown) {
    log(`❌ ${description} - FAILED`, 'red');
    const err = error as { stdout?: Buffer; stderr?: Buffer };
    if (err.stdout) console.log(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
    return false;
  }
}

export function getStandaloneChecks(): ArchCheck[] {
  const checks: ArchCheck[] = [
    { command: 'npm run lint', description: 'ESLint rules' },
    { command: 'npm run type-check', description: 'TypeScript type check' },
  ];

  const nodeVersion = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (nodeVersion >= 24) {
    checks.push({ command: 'npm run arch:deps', description: 'Dependency rules' });
  } else {
    log(`⚠️  Dependency rules - SKIPPED (requires Node >= 24, current: ${process.versions.node})`, 'yellow');
  }

  return checks;
}

export function runValidation(checks: ArchCheck[], title: string): ValidationResult {
  log(`🏗️ ${title}`, 'blue');
  log('='.repeat(title.length + 4), 'blue');

  const results: boolean[] = [];
  for (const check of checks) {
    results.push(runCommand(check.command, check.description));
  }

  const passed = results.filter((r) => r === true).length;
  const total = results.length;
  return { passed, total, success: passed === total };
}

export function displayResults({ passed, total, success }: ValidationResult): void {
  if (success) {
    log(`🎉 ALL CHECKS PASSED (${passed}/${total})`, 'green');
    log('Architecture is compliant! 🏛️', 'green');
    process.exit(0);
  } else {
    log(`💥 ${total - passed} CHECKS FAILED (${passed}/${total})`, 'red');
    log('Architecture violations detected! 🚨', 'red');
    process.exit(1);
  }
}

// ─── Monorepo-specific checks ────────────────────────────────────────────────

/**
 * Monorepo-specific architecture checks
 * Order: clean build -> standalone checks -> unused exports
 */
function getMonorepoChecks(): ArchCheck[] {
  return [
    { command: 'npm run clean:build', description: 'Clean build (packages + app)' },
  ];
}

function getMonorepoPostChecks(): ArchCheck[] {
  return [
    { command: 'npm run arch:unused', description: 'Unused exports check' },
  ];
}

/**
 * FrontX ecosystem boundary checks (Phase 10/17 — full enforcement).
 *
 * Boundary invariants covered:
 *   cpt-frontx-constraint-mfes-no-type-format-literals     (MFES-1) — ESLint eslint.config.js
 *   cpt-frontx-constraint-mfes-no-solution-shared-properties (MFES-2) — ESLint eslint.config.js
 *   cpt-frontx-constraint-mfes-no-layout-domain-values      (MFES-3) — ESLint eslint.config.js
 *   cpt-frontx-constraint-mfes-no-type-format-dependency    (MFES-4) — dep-cruiser
 *   cpt-frontx-constraint-mfes-opaque-schema-surface        (MFES-5) — grep check below
 *   cpt-frontx-constraint-gts-plugin-owns-infra-schemas     (GTS-PLUGIN-1) — dep-cruiser
 *   cpt-frontx-constraint-gts-plugin-excludes-solution-schemas (GTS-PLUGIN-2) — dep-cruiser
 *   cpt-frontx-constraint-api-no-solution-content           (API-1) — dep-cruiser
 *   cpt-frontx-constraint-cli-template-independence         (CLI-1) — dep-cruiser + grep check below
 */
function getEcosystemBoundaryChecks(): ArchCheck[] {
  return [
    // @cpt-begin:cpt-frontx-constraint-mfes-no-type-format-dependency:p10:inst-arch-check
    {
      command:
        'npx dependency-cruiser packages/mfes/src --config .dependency-cruiser.cjs --output-type err-long',
      description:
        'MFES-4 (cpt-frontx-constraint-mfes-no-type-format-dependency): mfes boundary — no concrete type-format import',
    },
    // @cpt-end:cpt-frontx-constraint-mfes-no-type-format-dependency:p10:inst-arch-check
    // @cpt-begin:cpt-frontx-constraint-gts-plugin-owns-infra-schemas:p10:inst-arch-check
    {
      command:
        'npx dependency-cruiser packages/gts-plugin/src packages/mfes/src packages/api/src --config .dependency-cruiser.cjs --output-type err-long',
      description:
        'GTS-PLUGIN-1 (cpt-frontx-constraint-gts-plugin-owns-infra-schemas): infra schema ownership',
    },
    // @cpt-end:cpt-frontx-constraint-gts-plugin-owns-infra-schemas:p10:inst-arch-check
    // @cpt-begin:cpt-frontx-constraint-gts-plugin-excludes-solution-schemas:p10:inst-arch-check
    {
      command:
        'npx dependency-cruiser packages/gts-plugin/src --config .dependency-cruiser.cjs --output-type err-long',
      description:
        'GTS-PLUGIN-2 (cpt-frontx-constraint-gts-plugin-excludes-solution-schemas): gts-plugin boundary',
    },
    // @cpt-end:cpt-frontx-constraint-gts-plugin-excludes-solution-schemas:p10:inst-arch-check
    // @cpt-begin:cpt-frontx-constraint-api-no-solution-content:p10:inst-arch-check
    {
      command:
        'npx dependency-cruiser packages/api/src --exclude __tests__ --config .dependency-cruiser.cjs --output-type err-long',
      description:
        'API-1 (cpt-frontx-constraint-api-no-solution-content): api boundary — no solution content',
    },
    // @cpt-end:cpt-frontx-constraint-api-no-solution-content:p10:inst-arch-check
    // @cpt-begin:cpt-frontx-constraint-mfes-opaque-schema-surface:p10:inst-arch-check
    {
      command:
        "bash -c '! grep -rl \"import.*JSONSchema\" packages/mfes/src/'",
      description:
        'MFES-5 (cpt-frontx-constraint-mfes-opaque-schema-surface): mfes has no JSONSchema shape import',
    },
    // @cpt-end:cpt-frontx-constraint-mfes-opaque-schema-surface:p10:inst-arch-check
    // @cpt-begin:cpt-frontx-constraint-cli-template-independence:p17:inst-dep-cruiser-check
    {
      command:
        'npx dependency-cruiser packages/cli/src --config .dependency-cruiser.cjs --output-type err-long',
      description:
        'CLI-1 (cpt-frontx-constraint-cli-template-independence): cli boundary — no bundled template content dependency',
    },
    // @cpt-end:cpt-frontx-constraint-cli-template-independence:p17:inst-dep-cruiser-check
    // @cpt-begin:cpt-frontx-constraint-cli-template-independence:p17:inst-hardcoded-name-check
    // Structural, not name-keyed: `@gears-frontx/frontx-template` is the
    // package-naming CONVENTION every template publishes under, not a
    // specific template's identity — this repository does not know which
    // templates exist (cpt-frontx-adr-template-acquisition-and-location), so
    // the check must recognize the shape of a template package reference
    // rather than enumerate one.
    {
      command:
        "bash -c '! grep -rn \"@gears-frontx/frontx-template\" packages/cli/src/ --include=\"*.ts\" --exclude-dir=generated --exclude-dir=__tests__ | grep -v \"@cpt-\"'",
      description:
        'CLI-1 (cpt-frontx-constraint-cli-template-independence): cli sources contain no hardcoded template package names (excluding auto-generated version registry)',
    },
    // @cpt-end:cpt-frontx-constraint-cli-template-independence:p17:inst-hardcoded-name-check
  ];
}

export function validateMonorepoArchitecture(): ValidationResult {
  const allChecks = [
    ...getMonorepoChecks(),
    ...getStandaloneChecks(),
    ...getMonorepoPostChecks(),
    ...getEcosystemBoundaryChecks(),
  ];
  return runValidation(allChecks, 'Gears FrontX Monorepo Architecture Validation');
}

// Main execution
function main(): void {
  const results = validateMonorepoArchitecture();
  displayResults(results);
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  main();
}
