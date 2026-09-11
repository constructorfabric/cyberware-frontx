// @vitest-environment node

/**
 * Tests for the expose CSS-delivery guard in the frontx-mf-gts plugin.
 *
 * The guard is a pure function over (federation exposes, captured chunk
 * graph): a package-own stylesheet imported plainly in an expose's module
 * graph while the manifest attributes no CSS to that expose can never be
 * injected into the MFE's shadow root — the host injects manifest-attributed
 * CSS only, so the screen renders unstyled with no error anywhere. Tests
 * cover that silent failure (CSS hoisted into a shared chunk), the three
 * healthy shapes (`?inline` delivery, manifest-attributed CSS, UI-kit
 * CSS-modules from node_modules that the host delivers by style adoption),
 * and graph traversal through static and dynamic imports.
 */
// @cpt-FEATURE:frontx-mf-gts-plugin:p1

import { describe, expect, it } from 'vitest';
import {
  findUndeclaredExposeCss,
  formatUndeclaredExposeCssError,
  isOwnCssModule,
  type CapturedChunk,
} from '../../src/build/mf-gts';

function chunk(
  fileName: string,
  overrides: Partial<Omit<CapturedChunk, 'fileName'>> = {}
): [string, CapturedChunk] {
  return [
    fileName,
    {
      fileName,
      imports: [],
      dynamicImports: [],
      ownCssModules: [],
      ...overrides,
    },
  ];
}

function expose(
  path: string,
  js: string[],
  css: string[] = []
): { id: string; name: string; path: string; assets: { js: { sync: string[]; async: string[] }; css: { sync: string[]; async: string[] } } } {
  const name = path.replace('./', '');
  return {
    id: `mfe:${name}`,
    name,
    path,
    assets: {
      js: { sync: js, async: [] },
      css: { sync: css, async: [] },
    },
  };
}

describe('isOwnCssModule', () => {
  it('accepts a package-own stylesheet, plain or with a non-inline query', () => {
    expect(isOwnCssModule('/app/src/globals.css')).toBe(true);
    expect(isOwnCssModule('/app/src/globals.css?used')).toBe(true);
  });

  it('rejects ?inline imports — they travel inside the JS as strings', () => {
    expect(isOwnCssModule('/app/src/globals.css?inline')).toBe(false);
    expect(isOwnCssModule('/app/src/globals.css?used&inline=')).toBe(false);
  });

  it('rejects node_modules CSS — the host delivers it by style adoption', () => {
    expect(isOwnCssModule('/app/node_modules/@gears-frontx/ui-kit/dist/input.module.css')).toBe(false);
  });

  it('rejects non-CSS modules', () => {
    expect(isOwnCssModule('/app/src/lifecycle-login.tsx')).toBe(false);
  });
});

describe('findUndeclaredExposeCss', () => {
  it('flags own CSS hoisted into a shared chunk while the expose declares none (the silent no-op)', () => {
    const chunks = new Map([
      chunk('assets/lifecycle-login.js', { imports: ['assets/shared-chunk.js'] }),
      chunk('assets/shared-chunk.js', { ownCssModules: ['/app/src/globals.css'] }),
    ]);
    expect(
      findUndeclaredExposeCss([expose('./lifecycle-login', ['assets/lifecycle-login.js'])], chunks)
    ).toEqual([{ exposePath: './lifecycle-login', missingCss: ['/app/src/globals.css'] }]);
  });

  it('trusts an expose that declares CSS — the guard targets the empty-attribution hoist', () => {
    const chunks = new Map([
      chunk('assets/lifecycle-login.js', { ownCssModules: ['/app/src/globals.css'] }),
    ]);
    expect(
      findUndeclaredExposeCss(
        [expose('./lifecycle-login', ['assets/lifecycle-login.js'], ['assets/login.css'])],
        chunks
      )
    ).toEqual([]);
  });

  it('accepts inlined styles — ?inline module ids are filtered out at capture', () => {
    const chunks = new Map([chunk('assets/lifecycle-login.js')]);
    expect(
      findUndeclaredExposeCss([expose('./lifecycle-login', ['assets/lifecycle-login.js'])], chunks)
    ).toEqual([]);
  });

  it('reaches own CSS through dynamic imports (lazy screen chunks)', () => {
    const chunks = new Map([
      chunk('assets/lifecycle-tasks.js', { dynamicImports: ['assets/lazy-screen.js'] }),
      chunk('assets/lazy-screen.js', { ownCssModules: ['/app/src/screens/lazy.css'] }),
    ]);
    expect(
      findUndeclaredExposeCss([expose('./lifecycle-tasks', ['assets/lifecycle-tasks.js'])], chunks)
    ).toEqual([{ exposePath: './lifecycle-tasks', missingCss: ['/app/src/screens/lazy.css'] }]);
  });

  it('ignores CSS on chunks not reachable from the expose (the standalone dev entry)', () => {
    const chunks = new Map([
      chunk('assets/lifecycle-login.js'),
      chunk('assets/index.js', { ownCssModules: ['/app/src/globals.css'] }),
    ]);
    expect(
      findUndeclaredExposeCss([expose('./lifecycle-login', ['assets/lifecycle-login.js'])], chunks)
    ).toEqual([]);
  });

  it('survives cycles and manifest assets missing from the captured graph', () => {
    const chunks = new Map([
      chunk('assets/a.js', { imports: ['assets/b.js', 'assets/gone.js'] }),
      chunk('assets/b.js', { imports: ['assets/a.js'] }),
    ]);
    expect(findUndeclaredExposeCss([expose('./x', ['assets/a.js'])], chunks)).toEqual([]);
  });
});

describe('formatUndeclaredExposeCssError', () => {
  it('names the expose path, each missing CSS module, and the ?inline/initializeStyles fix', () => {
    const message = formatUndeclaredExposeCssError([
      { exposePath: './lifecycle-login', missingCss: ['/app/src/globals.css', '/app/src/screens/lazy.css'] },
    ]);
    expect(message).toContain("expose './lifecycle-login' needs");
    expect(message).toContain('/app/src/globals.css');
    expect(message).toContain('/app/src/screens/lazy.css');
    expect(message).toContain('?inline');
    expect(message).toContain('initializeStyles()');
  });

  it('lists one line per finding for multiple undeclared exposes', () => {
    const message = formatUndeclaredExposeCssError([
      { exposePath: './lifecycle-login', missingCss: ['/app/src/globals.css'] },
      { exposePath: './lifecycle-tasks', missingCss: ['/app/src/screens/lazy.css'] },
    ]);
    expect(message).toContain("expose './lifecycle-login' needs: /app/src/globals.css");
    expect(message).toContain("expose './lifecycle-tasks' needs: /app/src/screens/lazy.css");
  });
});
