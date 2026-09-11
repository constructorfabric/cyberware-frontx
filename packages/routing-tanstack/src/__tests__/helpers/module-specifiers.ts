// Extraction/classification helpers for `dist-imports.test.ts` (F3), pulled
// out into their own module so the regex and the declared/relative
// classification rule can be unit-tested directly against a fixture,
// without paying for a real `tsc` build per assertion (N1, review round
// 16-re3).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Matches both the static form (`import { x } from '…'`, `export { x } from
// '…'`) and the dynamic type-only form TypeScript emits for a declaration
// it can only reference lazily (`import("…").Foo`) — a per-file `tsc` emit
// uses the latter routinely for a type that is used, but not re-exported,
// by the file doing the importing (N1: `router-creation.d.ts` importing
// `@tanstack/router-core` this way is exactly what the previous version of
// this test, matching only `from '…'`, could not see).
const SPECIFIER_PATTERN = /(?:from\s+|import\()\s*['"]([^'"]+)['"]/g;

/** Every module specifier a single `.d.ts` file's text imports from — in
 * the order they first appear, duplicates included (callers that only care
 * about the set of distinct specifiers dedupe themselves). */
export function extractModuleSpecifiers(dts: string): string[] {
  return Array.from(dts.matchAll(SPECIFIER_PATTERN), (match) => match[1]);
}

function listDtsFilesRecursive(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listDtsFilesRecursive(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.d.ts') ? [fullPath] : [];
  });
}

/** Every module specifier imported by any `*.d.ts` file under `dir`,
 * recursively — a per-file `tsc` emit (as opposed to a single rolled-up
 * bundle) spreads a package's own import surface across several files
 * (N1), so reading only the entry point's own `index.d.ts` understates it. */
export function collectModuleSpecifiers(dir: string): Set<string> {
  const specifiers = new Set<string>();
  for (const file of listDtsFilesRecursive(dir)) {
    for (const specifier of extractModuleSpecifiers(readFileSync(file, 'utf-8'))) {
      specifiers.add(specifier);
    }
  }
  return specifiers;
}

export type SpecifierClass = 'relative' | 'declared' | 'undeclared';

/** A specifier is safe to publish only if it resolves without this
 * package's own `dependencies`/`peerDependencies` doing the work implicitly
 * — a relative path (resolves on its own, no package lookup involved) or a
 * specifier this package's own `package.json` actually declares. Anything
 * else — including a Node builtin like `node:path`, which this package
 * happens not to declare — is `'undeclared'`: correct for this package (it
 * has none), and exactly the behaviour a package that legitimately needs
 * one would have to declare it for. */
export function classifySpecifier(specifier: string, declared: ReadonlySet<string>): SpecifierClass {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return 'relative';
  }
  return declared.has(specifier) ? 'declared' : 'undeclared';
}
