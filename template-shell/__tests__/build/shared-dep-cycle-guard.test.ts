// @vitest-environment node

/**
 * Tests for the shared-dependency cycle guard in the frontx-mf-gts plugin.
 *
 * The guard is a pure function over the graph of the shared chunks the plugin
 * mints with esbuild: one node per shared dep, one edge per sibling shared
 * chunk that dep's emitted file actually imports (read from esbuild's
 * metafile, not from the declared externals). Rollup's own CIRCULAR_CHUNK
 * check never sees these files, and esbuild has no equivalent, so a cycle
 * here would reach runtime — where per-load isolation makes the cycle-closing
 * import unresolvable and every MFE fails to mount, all of them at once.
 */

import { describe, expect, it } from 'vitest';
import type { Metafile } from 'esbuild';
import {
  externalImportsOf,
  findSharedDepCycle,
  formatSharedDepCycleError,
  type SharedChunkNode,
} from '../../src/build/mf-gts';

function chunk(name: string, imports: string[] = []): SharedChunkNode {
  return { name, imports };
}

describe('findSharedDepCycle', () => {
  it('returns undefined for an empty graph', () => {
    expect(findSharedDepCycle([])).toBeUndefined();
  });

  it('returns undefined for isolated nodes with no shared edges', () => {
    expect(
      findSharedDepCycle([chunk('react'), chunk('@gears-frontx/mfes')])
    ).toBeUndefined();
  });

  it('passes the real current shared graph untouched', () => {
    // The shape template-shell mints today: react as a leaf, everything else
    // importing inward onto it, plus the react-dom/client subpath edge onto
    // its parent package. @gears-frontx/mfes and @gears-frontx/gts-plugin
    // declare each other in package.json and are mutually external, yet
    // neither minted chunk imports the other — every cross-reference is
    // `import type` or JSDoc — so neither has an edge here.
    const real: SharedChunkNode[] = [
      chunk('react'),
      chunk('react-dom', ['react']),
      chunk('react-dom/client', ['react-dom', 'react']),
      chunk('@gears-frontx/mfes'),
      chunk('@gears-frontx/gts-plugin'),
      chunk('@gears-frontx/react', ['react', 'react-dom']),
    ];
    expect(findSharedDepCycle(real)).toBeUndefined();
  });

  it('ignores edges pointing at packages that are not shared chunks', () => {
    // A minted chunk may leave a non-shared bare import in its output; such a
    // target is not a chunk and must never be mistaken for a node.
    expect(
      findSharedDepCycle([chunk('react-dom', ['scheduler', 'react'])])
    ).toBeUndefined();
  });

  it('does not flag mutually-external packages that import nothing of each other', () => {
    // The live near-miss: @gears-frontx/mfes and @gears-frontx/gts-plugin
    // each declare the other as a dependency, so each is external to the
    // other's esbuild run — but the emitted chunks carry no import edge, and
    // a guard keyed on declared externals rather than emitted imports would
    // fail this healthy build.
    expect(
      findSharedDepCycle([
        chunk('@gears-frontx/mfes', []),
        chunk('@gears-frontx/gts-plugin', []),
      ])
    ).toBeUndefined();
  });

  it('detects a two-package cycle and names both packages in order', () => {
    const cycle = findSharedDepCycle([
      chunk('@gears-frontx/mfes', ['@gears-frontx/gts-plugin']),
      chunk('@gears-frontx/gts-plugin', ['@gears-frontx/mfes']),
    ]);
    expect(cycle).toEqual([
      '@gears-frontx/mfes',
      '@gears-frontx/gts-plugin',
      '@gears-frontx/mfes',
    ]);
  });

  it('detects a self-edge as a length-one cycle', () => {
    expect(findSharedDepCycle([chunk('weird', ['weird'])])).toEqual([
      'weird',
      'weird',
    ]);
  });

  it('detects a longer cycle and reports it in traversal order', () => {
    const cycle = findSharedDepCycle([
      chunk('a', ['b']),
      chunk('b', ['c']),
      chunk('c', ['a']),
    ]);
    expect(cycle).toEqual(['a', 'b', 'c', 'a']);
  });

  it('reports the cycle itself, not the acyclic path that reached it', () => {
    const cycle = findSharedDepCycle([
      chunk('entry', ['a']),
      chunk('a', ['b']),
      chunk('b', ['a']),
    ]);
    expect(cycle).toEqual(['a', 'b', 'a']);
  });

  it('finds a cycle in a component not reachable from the first node', () => {
    const cycle = findSharedDepCycle([
      chunk('react'),
      chunk('react-dom', ['react']),
      chunk('x', ['y']),
      chunk('y', ['x']),
    ]);
    expect(cycle).toEqual(['x', 'y', 'x']);
  });

  it('does not mistake a diamond (shared successor) for a cycle', () => {
    expect(
      findSharedDepCycle([
        chunk('top', ['left', 'right']),
        chunk('left', ['bottom']),
        chunk('right', ['bottom']),
        chunk('bottom'),
      ])
    ).toBeUndefined();
  });
});

describe('formatSharedDepCycleError', () => {
  it('names every package on the cycle, in order, on one arrow-joined line', () => {
    const message = formatSharedDepCycleError([
      '@gears-frontx/mfes',
      '@gears-frontx/gts-plugin',
      '@gears-frontx/mfes',
    ]);
    expect(message).toContain(
      'Cyclic shared-dependency graph: @gears-frontx/mfes -> ' +
        '@gears-frontx/gts-plugin -> @gears-frontx/mfes'
    );
    expect(message).toContain('[frontx-mf-gts]');
    expect(message).toContain('Fix:');
  });
});

describe('externalImportsOf', () => {
  /** Minimal metafile shape: only the fields the reader touches. */
  function metafile(
    outputs: Record<string, Metafile['outputs'][string]['imports']>
  ): Metafile {
    return {
      inputs: {},
      outputs: Object.fromEntries(
        Object.entries(outputs).map(([file, imports]) => [
          file,
          { imports, exports: [], entryPoint: undefined, inputs: {}, bytes: 0 },
        ])
      ),
    } as Metafile;
  }

  it('matches the output entry by resolved path, not by key', () => {
    // esbuild keys outputs relative to its working directory, while the
    // plugin holds an absolute outfile.
    const abs = `${process.cwd()}/dist/shared/react-dom.js`;
    const meta = metafile({
      'dist/shared/react-dom.js': [
        { path: 'react', kind: 'require-call', external: true },
      ],
    });
    expect(externalImportsOf(meta, abs)).toEqual(['react']);
  });

  it('counts require-call edges as well as import-statement edges', () => {
    // CJS packages bundled to ESM reach their externals via __require(),
    // which patchCjsExternals later rewrites into real ESM imports.
    const meta = metafile({
      'out.js': [
        { path: 'react', kind: 'require-call', external: true },
        { path: '@gears-frontx/state', kind: 'import-statement', external: true },
      ],
    });
    expect(externalImportsOf(meta, 'out.js')).toEqual([
      'react',
      '@gears-frontx/state',
    ]);
  });

  it('ignores bundled (non-external) imports and unrelated outputs', () => {
    const meta = metafile({
      'other.js': [{ path: 'react', kind: 'import-statement', external: true }],
      'out.js': [
        { path: './internal.js', kind: 'import-statement', external: false },
      ],
    });
    expect(externalImportsOf(meta, 'out.js')).toEqual([]);
  });

  it('returns no edges when the output is absent from the metafile', () => {
    expect(externalImportsOf(metafile({}), 'out.js')).toEqual([]);
  });
});
