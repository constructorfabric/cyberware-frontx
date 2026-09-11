import { describe, expect, it } from 'vitest';
import { classifySpecifier, extractModuleSpecifiers } from './helpers/module-specifiers.js';

// N1 (review round 16-re3): unit-tests the extractor/classifier
// `dist-imports.test.ts` relies on, against a fixture rather than a real
// `tsc` build — this is what actually proves the regex covers the dynamic
// `import("…")` form a per-file `tsc` emit uses (the shape the F3 fix was
// supposed to close but the previous version of this test, matching only
// `from '…'`, could not see: `@tanstack/router-core` appeared exactly this
// way in `router-creation.d.ts`, not in `index.d.ts`'s own `from '…'`).
describe('extractModuleSpecifiers', () => {
  it('captures a static `from` import, a dynamic `import()` type reference, a relative path, and a node: builtin', () => {
    const fixture = `
export type Foo = typeof import("@tanstack/router-core").RouterCore;
import { bar } from 'react';
export { baz } from './local-file.js';
declare function readsFs(fs: typeof import("node:fs")): void;
`;
    expect(extractModuleSpecifiers(fixture)).toEqual([
      '@tanstack/router-core',
      'react',
      './local-file.js',
      'node:fs',
    ]);
  });

  it('returns no specifiers for a file that imports nothing', () => {
    expect(extractModuleSpecifiers('export declare const x: number;')).toEqual([]);
  });
});

describe('classifySpecifier', () => {
  const declared = new Set(['react', '@tanstack/router-core']);

  it('classifies a declared dependency as declared', () => {
    expect(classifySpecifier('@tanstack/router-core', declared)).toBe('declared');
    expect(classifySpecifier('react', declared)).toBe('declared');
  });

  it('classifies a relative path as relative, regardless of whether it is also declared', () => {
    expect(classifySpecifier('./local-file.js', declared)).toBe('relative');
    expect(classifySpecifier('/abs/path.js', declared)).toBe('relative');
  });

  it('classifies an undeclared node: builtin as undeclared — this package declares none', () => {
    expect(classifySpecifier('node:fs', declared)).toBe('undeclared');
  });

  it('classifies any other non-relative, non-declared specifier as undeclared', () => {
    expect(classifySpecifier('left-pad', declared)).toBe('undeclared');
  });
});
