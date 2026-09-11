import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// F3 (review round 16-re): the published `dist/index.d.ts` must never
// import a module specifier this package does not declare as a dependency
// or peerDependency (or a relative path) — an undeclared import resolves
// only by accident, through hoisting in this monorepo's own workspace, and
// breaks the moment a consumer installs this package on its own (the
// defect this round's own `@tanstack/router-core` fix closed: it appeared
// in `dist/index.d.ts` while only implicitly present via
// `@tanstack/react-router`'s own dependency).
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distIndexDts = path.join(packageRoot, 'dist/index.d.ts');

describe('published dist/index.d.ts module specifiers (F3)', () => {
  it('every non-relative import is a declared dependency or peerDependency', () => {
    if (!existsSync(distIndexDts)) {
      // Built on demand — a fresh clone has no `dist/` yet, and this
      // check's whole point is to inspect the artifact that ships, not a
      // source-level reconstruction of it.
      execSync('npm run build -w packages/routing-tanstack', {
        cwd: path.resolve(packageRoot, '../..'),
        stdio: 'pipe',
      });
    }

    const dts = readFileSync(distIndexDts, 'utf-8');
    const specifiers = new Set(
      Array.from(dts.matchAll(/from '([^']+)'/g), (match) => match[1]),
    );
    expect(specifiers.size).toBeGreaterThan(0);

    const packageJson = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ]);

    for (const specifier of specifiers) {
      const isRelative = specifier.startsWith('.') || specifier.startsWith('/');
      const isDeclared = declared.has(specifier);
      expect(isRelative || isDeclared, `undeclared module specifier: ${specifier}`).toBe(true);
    }
  });
});
