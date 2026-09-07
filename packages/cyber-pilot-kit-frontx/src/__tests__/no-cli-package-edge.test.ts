// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
//
// Guard: `@gears-frontx/cyber-pilot-kit-frontx` holds NO intra-ecosystem
// package edge to `@gears-frontx/cli` — coordination with the CLI happens
// ONLY over its command/invocation surface (DESIGN §3.4;
// cpt-frontx-dod-ai-upgrade-orchestration-single-engine). This source-string
// guard complements the dependency-cruiser rule
// (`frontx-single-intra-ecosystem-edge-kit-standalone` in
// `.dependency-cruiser.cjs`) with a fast, package-local check.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Kit package root: src/__tests__/ -> src/ -> package root
const KIT_ROOT = join(SRC_ROOT, '..');

// Never walked: build output and dependencies are not kit-authored content, and
// `coverage/` embeds kit source inside generated HTML, which would match every
// pattern below from a report rather than from a shipped document.
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

function listFiles(dir: string, matches: (name: string) => boolean): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name)) continue;
    const full = join(dir, name);
    // lstat, not stat: a symlinked directory under the kit root would otherwise
    // be walked as if it were part of the kit, taking the scan outside the root
    // it is meant to cover or into an ELOOP cycle.
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      files.push(...listFiles(full, matches));
    } else if (matches(name)) {
      files.push(full);
    }
  }
  return files;
}

function listSourceFiles(dir: string): string[] {
  return listFiles(dir, (name) => /\.(ts|tsx)$/.test(name));
}

// Matches an actual ESM/CJS import or require specifier naming the CLI
// package — not prose mentions of the package name in comments/docstrings
// (this guard file and the adapter's own doc-comments legitimately name it).
const CLI_IMPORT_PATTERN = /(?:from\s+|require\()\s*['"]@gears-frontx\/cli(?:\/[^'"]*)?['"]/;

describe('no @gears-frontx/cli package edge (cpt-frontx-dod-ai-upgrade-orchestration-single-engine)', () => {
  it('contains no import/require specifier naming @gears-frontx/cli anywhere in kit source', () => {
    const selfPath = fileURLToPath(import.meta.url);
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      if (file === selfPath) continue; // this guard's own doc-comments name the package in prose
      const content = readFileSync(file, 'utf-8');
      if (CLI_IMPORT_PATTERN.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

// The kit's entry points ship as DOCUMENTS, not modules, so the .ts scan above
// cannot see them: an instruction telling an agent to import the CLI package or
// to read its inventory storage would be a real boundary breach that no
// compiler, no dependency-cruiser rule, and no test reached
// (cpt-frontx-dod-ai-project-scaffolding-command-surface-only).
//
// The CLI's inventory storage specifically — NOT `.frontx/` generally. Reading
// `.frontx/provenance.json` and scanning `.frontx/ai/<template-identity>/` are
// the two sanctioned filesystem handoffs (DESIGN §3.4), so a pattern matching
// `.frontx/` as a whole would flag the documents for doing exactly what the
// architecture tells them to do.
const INVENTORY_STORAGE_PATTERN = /\.frontx[/\\]inventory|FRONTX_INVENTORY_ROOT/i;

describe('shipped kit documents reach the CLI only over its command surface', () => {
  // `.mjs` alongside `.md`: the kit now ships an executable resource as well as
  // documents, and a script is the one shipped surface that could carry a real
  // import of the CLI package rather than an instruction to run it. The `.ts`
  // scan above does not see it (it is not TypeScript) and the document scan did
  // not either until this predicate was widened.
  const documents = () => listFiles(KIT_ROOT, (name) => name.endsWith('.md') || name.endsWith('.mjs'));

  it('walks the shipped documents and scripts, including the entry points outside src/', () => {
    const found = documents().map((f) => f.slice(KIT_ROOT.length + 1));

    expect(found).toContain('SKILL.md');
    expect(found).toContain(join('skills', 'project-scaffolding', 'SKILL.md'));
    expect(found).toContain('AGENTS.md');
    expect(found).toContain(join('skills', 'project-scaffolding', 'scripts', 'verify-walk.mjs'));
  });

  it('contains no import/require specifier naming @gears-frontx/cli in any shipped document', () => {
    const offenders = documents().filter((file) => CLI_IMPORT_PATTERN.test(readFileSync(file, 'utf-8')));

    expect(offenders).toEqual([]);
  });

  // Prose forbidding the read is not a read; the patterns match an addressed
  // location, which is what an instruction to go and read it would carry.
  it('directs no shipped document at the CLI inventory storage', () => {
    const offenders = documents().filter((file) => INVENTORY_STORAGE_PATTERN.test(readFileSync(file, 'utf-8')));

    expect(offenders).toEqual([]);
  });
});
