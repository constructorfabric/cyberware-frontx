// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONCRETE_EXPORT_DENYLIST,
  MFES_BARREL_RELATIVE_PATH,
  findBarrelViolations,
  findConsumerFiles,
  findConsumerViolations,
  findMfesImportSites,
  isConcreteImplementationName,
  parseImportedNames,
  runCli,
  stripComments,
} from './mfes-import-boundary-check.mjs';

/** @type {string | undefined} */
let rootDir;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

async function makeRoot() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-mfes-boundary-'));
  return rootDir;
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @param {string} content
 */
async function writeSource(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

/** A barrel that honors ADR-0003: contracts and the creation function only. */
const CLEAN_BARREL = [
  "export { MfeRegistry } from './registry/MfeRegistry';",
  "export { createMfeRegistryFactory } from './runtime/DefaultMfeRegistryFactory';",
  "export { MfeHandlerMF, LruCache } from './handler/MfeHandlerMF';",
].join('\n');

/** Runs the guard with its output captured, so a case can assert what it named. */
/** @param {string} root */
function run(root) {
  /** @type {string[]} */
  const lines = [];
  /** @param {string} line */
  const record = (line) => lines.push(line);
  const exitCode = runCli({ rootDir: root, log: record, logError: record });
  return { exitCode, output: lines.join('\n') };
}

// The forbidden set is a naming rule, not a list (see the guard's docblock):
// a class list would leave the next DefaultFooManager born unguarded.
describe('isConcreteImplementationName', () => {
  it('matches Default-prefixed class names, including ones that do not exist yet', () => {
    for (const name of ['DefaultMfeRegistry', 'DefaultMfeRegistryFactory', 'DefaultLifecycleManager', 'DefaultFooManager']) {
      expect(isConcreteImplementationName(name)).toBe(true);
    }
  });

  it('matches the Default-suffixed bridge factory', () => {
    expect(isConcreteImplementationName('MfeBridgeFactoryDefault')).toBe(true);
  });

  it('leaves contract and creation-function names alone', () => {
    for (const name of ['MfeRegistry', 'createMfeRegistryFactory', 'MfeHandlerMF', 'ConcurrentMountStrategy', 'ExtensionManager']) {
      expect(isConcreteImplementationName(name)).toBe(false);
    }
  });

  it('flags a name seeded into CONCRETE_EXPORT_DENYLIST, in both barrel and consumer halves', () => {
    CONCRETE_EXPORT_DENYLIST.add('OperationSerializer');
    try {
      expect(isConcreteImplementationName('OperationSerializer')).toBe(true);
      expect(
        findBarrelViolations("export { OperationSerializer } from './runtime/operation-serializer';"),
      ).toEqual([{ file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'OperationSerializer' }]);
      const sites = findMfesImportSites(
        "import { OperationSerializer } from '@gears-frontx/mfes'",
        'app.ts',
      );
      expect(findConsumerViolations(sites)).toEqual([
        { file: 'app.ts', kind: 'concrete-name', detail: 'OperationSerializer' },
      ]);
    } finally {
      CONCRETE_EXPORT_DENYLIST.delete('OperationSerializer');
    }
  });
});

describe('findMfesImportSites', () => {
  it('captures a multi-line named-import block whole and strips aliases and type keywords', () => {
    const content = [
      "import {",
      "  type MfeRegistry,",
      "  DefaultMfeRegistry as Registry,",
      "  createMfeRegistryFactory,",
      "} from '@gears-frontx/mfes'",
    ].join('\n');
    const [site] = findMfesImportSites(content, 'a.ts');
    expect(site.specifier).toBe('@gears-frontx/mfes');
    expect(site.names).toEqual(['MfeRegistry', 'DefaultMfeRegistry', 'createMfeRegistryFactory']);
  });

  it('captures deep-subpath specifiers', () => {
    const [site] = findMfesImportSites(
      "import { DefaultMfeRegistry } from '@gears-frontx/mfes/dist/runtime/DefaultMfeRegistry'",
      'a.ts',
    );
    expect(site.specifier).toBe('@gears-frontx/mfes/dist/runtime/DefaultMfeRegistry');
  });

  it('ignores mentions with no from-clause: eslint groups, bundler externals, prose', () => {
    const content = [
      "const groups = ['@gears-frontx/mfes', '@gears-frontx/mfes/*'];",
      "// exported from @gears-frontx/mfes for convenience",
      "export default { external: ['@gears-frontx/mfes'] };",
    ].join('\n');
    expect(findMfesImportSites(content, 'a.ts')).toEqual([]);
  });

  it('captures side-effect and dynamic imports, which carry no from-clause', () => {
    const sideEffect = findMfesImportSites("import '@gears-frontx/mfes/runtime/DefaultMfeRegistry'", 'a.ts');
    expect(sideEffect).toHaveLength(1);
    expect(sideEffect[0].specifier).toBe('@gears-frontx/mfes/runtime/DefaultMfeRegistry');
    const dynamic = findMfesImportSites("const m = await import('@gears-frontx/mfes/internal/wiring')", 'a.ts');
    expect(dynamic).toHaveLength(1);
    expect(dynamic[0].specifier).toBe('@gears-frontx/mfes/internal/wiring');
  });

  it('backtracks past a substring match on the keyword: importManifest does not fool the statement start', () => {
    const [site] = findMfesImportSites(
      "import { DefaultMfeRegistry, importManifest } from '@gears-frontx/mfes'",
      'a.ts',
    );
    expect(site.names).toEqual(['DefaultMfeRegistry', 'importManifest']);
    expect(findConsumerViolations([site])).toEqual([
      { file: 'a.ts', kind: 'concrete-name', detail: 'DefaultMfeRegistry' },
    ]);
  });

  it('backtracks past a substring match inside a comment, and does not launder the following name into the comment text', () => {
    const content = [
      'import {',
      '  type MfeRegistry,',
      '  // imported for typing only',
      '  DefaultLifecycleManager,',
      "} from '@gears-frontx/mfes'",
    ].join('\n');
    const [site] = findMfesImportSites(content, 'a.ts');
    expect(site.names).toEqual(['MfeRegistry', 'DefaultLifecycleManager']);
    expect(findConsumerViolations([site])).toEqual([
      { file: 'a.ts', kind: 'concrete-name', detail: 'DefaultLifecycleManager' },
    ]);
  });

  // Round 3: a comment that reads as a real import could previously LAUNDER
  // that import past the guard when a comment landed between the `import`
  // keyword and the specifier (see the reverted keyword-backtrack repro
  // below). Comments are now stripped before matching, so a fully
  // commented-out import is no longer reported at all — a false negative
  // here (missing a real import) is never acceptable, but a false negative
  // is exactly what letting comments launder a name produces; the guard
  // would rather risk the opposite, narrower false positive of matching
  // statement-shaped text inside a string literal (see the test below).
  it('no longer reports a fully commented-out import statement', () => {
    const content = "// import { DefaultMfeRegistry } from '@gears-frontx/mfes'";
    expect(findMfesImportSites(content, 'a.ts')).toEqual([]);
  });

  // Round 4: the exact end-to-end shape the reviewer reproduced on a shared
  // vitest config file — a glob string carrying `/*` above a real import, an
  // ordinary JSDoc below it. The round-3 strip deleted everything between
  // the two as one giant "comment", import included.
  it('reports a concrete import sitting between a glob string literal and a real block comment', () => {
    const content = [
      "const globs = ['src/**'];",
      "import { DefaultMfeRegistry } from '@gears-frontx/mfes';",
      '/** a perfectly ordinary JSDoc */',
    ].join('\n');
    const [site] = findMfesImportSites(content, 'a.ts');
    expect(site.names).toEqual(['DefaultMfeRegistry']);
    expect(findConsumerViolations([site])).toEqual([
      { file: 'a.ts', kind: 'concrete-name', detail: 'DefaultMfeRegistry' },
    ]);
  });

  // Round 5, end-to-end: the exact consumer-half exploit — a nested template
  // used to swallow the import line into the outer "literal"'s strip-scan.
  it('reports a concrete import following a nested template literal carrying a URL', () => {
    const content = [
      'const u = `${`https://a.b`}`;',
      "import { DefaultMfeRegistry } from '@gears-frontx/mfes';",
    ].join('\n');
    const [site] = findMfesImportSites(content, 'a.ts');
    expect(site.names).toEqual(['DefaultMfeRegistry']);
    expect(findConsumerViolations([site])).toEqual([
      { file: 'a.ts', kind: 'concrete-name', detail: 'DefaultMfeRegistry' },
    ]);
  });

  it('still reports a statement-shaped string literal — the guard does not parse JS', () => {
    const content = "const example = \"import { DefaultMfeRegistry } from '@gears-frontx/mfes'\";";
    const [site] = findMfesImportSites(content, 'a.ts');
    expect(site.names).toEqual(['DefaultMfeRegistry']);
    expect(findConsumerViolations([site])).toEqual([
      { file: 'a.ts', kind: 'concrete-name', detail: 'DefaultMfeRegistry' },
    ]);
  });

  // The repro the reviewer asked to close: a comment INSIDE the brace block
  // that itself contains a whole-word `import` becomes, under the old
  // last-keyword backtrack, the statement start — the slice from there to
  // the specifier has no opening brace, `parseImportedNames` returns `[]`,
  // and the concrete import walks through unreported. Stripping comments
  // first removes the false keyword match entirely, so the backtrack lands
  // on the statement's real `import` and the name is still caught.
  it('reports a concrete name even when a comment inside the block contains a whole-word import/export keyword', () => {
    const content = [
      'import {',
      '  MfeRegistry,',
      '  // do not import DefaultLifecycleManager elsewhere',
      '  DefaultLifecycleManager,',
      "} from '@gears-frontx/mfes'",
    ].join('\n');
    const [site] = findMfesImportSites(content, 'a.ts');
    expect(site.names).toEqual(['MfeRegistry', 'DefaultLifecycleManager']);
    expect(findConsumerViolations([site])).toEqual([
      { file: 'a.ts', kind: 'concrete-name', detail: 'DefaultLifecycleManager' },
    ]);
  });
});

describe('stripComments', () => {
  it('replaces a block comment with a single space', () => {
    expect(stripComments('const x = /* keep out */ 1;')).toBe('const x =   1;');
  });

  it('removes a line comment without eating the trailing newline', () => {
    expect(stripComments('const x = 1; // trailing\nconst y = 2;')).toBe('const x = 1;  \nconst y = 2;');
  });

  it('leaves code outside comments untouched', () => {
    const code = "import { MfeRegistry } from '@gears-frontx/mfes';";
    expect(stripComments(code)).toBe(code);
  });

  it('preserves the newlines of a multi-line block comment, so line-anchored patterns keep their lines', () => {
    expect(stripComments('a; /* one\ntwo */ b;')).toBe('a;  \n b;');
  });

  // Round 4: the round-3 strip was not string-aware, so a `/*` inside an
  // ordinary string opened a strip that ran to the next `*/` anywhere in the
  // file and silently DELETED the real code in between — a false negative,
  // the failure mode the guard's contract forbids. These pin the three
  // literal kinds the reviewer probed: string, template literal, regex.
  it('does not treat comment markers inside a string literal as comments', () => {
    const code = "const globs = ['src/**', 'src/*.ts']; // real comment";
    expect(stripComments(code)).toBe("const globs = ['src/**', 'src/*.ts'];  ");
  });

  it('does not treat comment markers inside a template literal as comments', () => {
    const code = 'const t = `/* not a comment */ // neither`;';
    expect(stripComments(code)).toBe(code);
  });

  it('does not treat comment markers inside a regex literal as comments', () => {
    const code = 'const re = /[/*]+/; const div = a / b;';
    expect(stripComments(code)).toBe(code);
  });

  it('a /* inside a string cannot swallow the code between it and a later real comment', () => {
    const source = [
      "const globs = ['src/**'];",
      "import { DefaultMfeRegistry } from '@gears-frontx/mfes';",
      '/** a perfectly ordinary JSDoc */',
    ].join('\n');
    expect(stripComments(source)).toContain("import { DefaultMfeRegistry } from '@gears-frontx/mfes';");
  });

  it('an unterminated single-quote string stops shielding at its newline', () => {
    const stripped = stripComments("const broken = 'oops\n// gone\ncode;");
    expect(stripped).not.toContain('// gone');
    expect(stripped).toContain('code;');
  });

  // Round 5: `scanStringLiteral` used to return at the FIRST backtick it met
  // — for a template nested inside `${…}` that was the inner template's
  // OPENING backtick, so everything after scanned as code and a `//` inside
  // the nested template (a URL is enough) started a strip that deleted real
  // code. These pin the reviewer's probes: nested-template boundary, comment
  // markers kept verbatim inside `${…}`, brace depth, regex-in-expression,
  // and the unterminated-expression fail-closed path.
  it('tracks ${} nesting: a nested template carrying a URL cannot end the outer literal early', () => {
    const source = [
      'const u = `${`https://a.b`}`;',
      "import { DefaultMfeRegistry } from '@gears-frontx/mfes';",
    ].join('\n');
    expect(stripComments(source)).toContain("import { DefaultMfeRegistry } from '@gears-frontx/mfes';");
  });

  it('a comment inside a ${} expression is kept verbatim and cannot end the expression early', () => {
    const code = 'const t = `${x /* } */ + 1}`; const y = 2;';
    expect(stripComments(code)).toBe(code);
  });

  it('tracks brace depth inside ${}: an object literal does not end the expression', () => {
    const code = 'const t = `${ { a: 1 }.a }`; // real comment';
    expect(stripComments(code)).toBe('const t = `${ { a: 1 }.a }`;  ');
  });

  it('a backtick inside a regex within ${} does not open a nested string', () => {
    const code = 'const t = `${/`/.test(x)}`; const y = 1;';
    expect(stripComments(code)).toBe(code);
  });

  it('an unterminated ${ expression shields the rest of the file rather than deleting any of it', () => {
    const source = 'const t = `${ oops\n// inside the still-open expression\ncode;';
    expect(stripComments(source)).toBe(source);
  });

  // Round 5, second class: with the slash after `if (…)` read as division,
  // the regex body scanned as code and its `[/*]` character class opened a
  // block-comment strip. Condition parens are now tracked.
  it('a [/*] character class in a regex after an if-condition cannot open a comment strip', () => {
    const source = [
      'if (x) /[/*]/.test(y);',
      "import { DefaultMfeRegistry } from '@gears-frontx/mfes';",
      '/** a perfectly ordinary JSDoc */',
    ].join('\n');
    expect(stripComments(source)).toContain("import { DefaultMfeRegistry } from '@gears-frontx/mfes';");
  });

  it('a slash after a call or grouping paren is still division', () => {
    const code = 'const half = f(x) / 2; const t = (a + b) / c;';
    expect(stripComments(code)).toBe(code);
  });
});

describe('parseImportedNames', () => {
  it('yields no names for namespace imports — the barrel half guards those', () => {
    expect(parseImportedNames("import * as mfes from '@gears-frontx/mfes'")).toEqual([]);
  });
});

describe('findBarrelViolations', () => {
  it('flags a concrete value export by its exported name', () => {
    const violations = findBarrelViolations(
      "export { DefaultMfeRegistry } from './runtime/DefaultMfeRegistry';",
    );
    expect(violations).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultMfeRegistry' },
    ]);
  });

  it('flags a concrete class on EITHER side of an alias — renaming does not launder the constructor', () => {
    expect(findBarrelViolations("export { Registry as DefaultMfeRegistry } from './r';")).toHaveLength(1);
    expect(findBarrelViolations("export { DefaultMfeRegistry as MfeRegistryImpl } from './r';")).toHaveLength(1);
  });

  it('prohibits wildcard re-exports outright — nobody can review what crosses an unnamed barrel', () => {
    expect(findBarrelViolations("export * from './runtime/internals';")).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'wildcard-export', detail: './runtime/internals' },
    ]);
    expect(findBarrelViolations("export * as internals from './runtime/internals';")).toHaveLength(1);
  });

  it('prohibits type-only wildcard re-exports too', () => {
    expect(findBarrelViolations("export type * from './runtime/internals';")).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'wildcard-export', detail: './runtime/internals' },
    ]);
  });

  it('flags type-only exports the same as value exports — type coupling is still coupling', () => {
    expect(findBarrelViolations("export type { DefaultMfeRegistry } from './r';")).toHaveLength(1);
    expect(findBarrelViolations("export { type DefaultMfeRegistry } from './r';")).toHaveLength(1);
  });

  it('passes the ADR-honoring barrel', () => {
    expect(findBarrelViolations(CLEAN_BARREL)).toEqual([]);
  });

  // Round 3: a comment sitting inside the braced list, on its own line
  // between the opening brace and the name, otherwise glues onto the name it
  // precedes in the comma-split — `// kept for the shell until #999\n
  // DefaultMfeRegistry,` becomes one entry, laundering the concrete name past
  // the naming rule. Stripping comments before the split closes this.
  it('flags a concrete name even when a comment sits on its own line inside the braced list', () => {
    const content = [
      'export {',
      '  // kept for the shell until #999',
      '  DefaultMfeRegistry,',
      "} from './runtime/DefaultMfeRegistry';",
    ].join('\n');
    expect(findBarrelViolations(content)).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultMfeRegistry' },
    ]);
  });

  it('flags a concrete class declared directly in the barrel, not just re-exported', () => {
    expect(findBarrelViolations('export class DefaultFooManager {}')).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultFooManager' },
    ]);
  });

  it('leaves a directly-declared abstract contract class alone', () => {
    expect(findBarrelViolations('export abstract class ExtensionManager {}')).toEqual([]);
  });

  it('flags a directly-declared const that matches the naming rule', () => {
    expect(findBarrelViolations('export const DefaultConfig = {};')).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultConfig' },
    ]);
  });

  // Round 4: `async`/`default` were not in the modifier group and `^\s*`
  // demanded a line start, so all four of these walked through at exit 0.
  it('flags async, generator, default, and mid-line declarations — modifiers do not launder a name', () => {
    expect(findBarrelViolations('export async function DefaultFoo() {}')).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultFoo' },
    ]);
    expect(findBarrelViolations('export function* DefaultGen() {}')).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultGen' },
    ]);
    expect(findBarrelViolations('export default class DefaultX {}')).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultX' },
    ]);
    expect(findBarrelViolations('const x = 1;export class DefaultX {}')).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultX' },
    ]);
  });

  // Round 5: the barrel-half twin of the nested-template exploit.
  it('flags a concrete export following a nested template literal carrying a URL', () => {
    const content = [
      'const u = `${`https://a.b`}`;',
      "export { DefaultMfeRegistry } from './runtime/DefaultMfeRegistry';",
    ].join('\n');
    expect(findBarrelViolations(content)).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultMfeRegistry' },
    ]);
  });

  it('flags a directly-declared const enum — the alternation does not eat the enum keyword', () => {
    expect(findBarrelViolations('export const enum DefaultKind { A }')).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultKind' },
    ]);
  });

  it('flags a bare export-default of an existing concrete binding', () => {
    expect(findBarrelViolations("import { DefaultMfeRegistry } from './r';\nexport default DefaultMfeRegistry;")).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultMfeRegistry' },
    ]);
  });

  // Round 6: `export\s+` demanded at least one whitespace character between
  // `export` and what follows, so valid no-space TypeScript — a formatter or
  // a minifier is free to emit `export{X}from'./r'` — walked through both
  // barrel patterns at exit 0.
  it('flags a no-space braced re-export — whitespace after `export` is not guaranteed', () => {
    expect(findBarrelViolations("export{DefaultMfeRegistry}from'./r';")).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'barrel-export', detail: 'DefaultMfeRegistry' },
    ]);
  });

  it('flags a no-space wildcard re-export — whitespace after `export` is not guaranteed', () => {
    expect(findBarrelViolations("export*from'./r';")).toEqual([
      { file: MFES_BARREL_RELATIVE_PATH, kind: 'wildcard-export', detail: './r' },
    ]);
  });
});

describe('findConsumerViolations', () => {
  it('reports a deep import once, without also parsing its names', () => {
    const sites = findMfesImportSites(
      "import { DefaultMfeRegistry } from '@gears-frontx/mfes/dist/runtime/DefaultMfeRegistry'",
      'app.ts',
    );
    expect(findConsumerViolations(sites)).toEqual([
      { file: 'app.ts', kind: 'deep-import', detail: '@gears-frontx/mfes/dist/runtime/DefaultMfeRegistry' },
    ]);
  });

  it('reports a side-effect deep import — no bindings needed to reach past the barrel', () => {
    const sites = findMfesImportSites("import '@gears-frontx/mfes/runtime/DefaultMfeRegistry'", 'app.ts');
    expect(findConsumerViolations(sites)).toEqual([
      { file: 'app.ts', kind: 'deep-import', detail: '@gears-frontx/mfes/runtime/DefaultMfeRegistry' },
    ]);
  });

  it('reports concrete names imported from the barrel, type imports included', () => {
    const sites = findMfesImportSites(
      "import { createMfeRegistryFactory, type DefaultLifecycleManager } from '@gears-frontx/mfes'",
      'app.ts',
    );
    expect(findConsumerViolations(sites)).toEqual([
      { file: 'app.ts', kind: 'concrete-name', detail: 'DefaultLifecycleManager' },
    ]);
  });
});

describe('runCli', () => {
  it('passes a repo whose barrel and consumers both honor the boundary', async () => {
    const root = await makeRoot();
    await writeSource(root, MFES_BARREL_RELATIVE_PATH, CLEAN_BARREL);
    await writeSource(
      root,
      'packages/gts-plugin/src/mfe/registry.ts',
      "import { createMfeRegistryFactory, type MfeRegistryFactory } from '@gears-frontx/mfes'\n",
    );
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(0);
    expect(output).toContain('import-boundary check passed');
  });

  it('fails when the barrel re-grows a concrete export, naming the export', async () => {
    const root = await makeRoot();
    await writeSource(
      root,
      MFES_BARREL_RELATIVE_PATH,
      `${CLEAN_BARREL}\nexport { DefaultMfeRegistry } from './runtime/DefaultMfeRegistry';\n`,
    );
    await writeSource(root, 'packages/cli/src/app.ts', 'export {}\n');
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('DefaultMfeRegistry');
    expect(output).toContain('barrel exports concrete implementation');
  });

  it('fails when a consumer couples to a concrete class — the exact #540 coupling', async () => {
    const root = await makeRoot();
    await writeSource(root, MFES_BARREL_RELATIVE_PATH, CLEAN_BARREL);
    await writeSource(
      root,
      'packages/gts-plugin/src/mfe/registry.ts',
      "import { DefaultMfeRegistryFactory } from '@gears-frontx/mfes'\nexport const f = new DefaultMfeRegistryFactory()\n",
    );
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('packages/gts-plugin/src/mfe/registry.ts'.split('/').join(path.sep));
    expect(output).toContain('DefaultMfeRegistryFactory');
  });

  it('never scans packages/mfes itself or node_modules/dist trees', async () => {
    const root = await makeRoot();
    await writeSource(root, MFES_BARREL_RELATIVE_PATH, CLEAN_BARREL);
    // The runtime's own sources and tests wire concrete classes by design.
    await writeSource(
      root,
      'packages/mfes/src/runtime/wiring.ts',
      "import { DefaultLifecycleManager } from './default-lifecycle-manager'\n",
    );
    await writeSource(
      root,
      'packages/cli/node_modules/@gears-frontx/mfes/dist/index.js',
      "export { DefaultMfeRegistry } from '@gears-frontx/mfes/internal'\n",
    );
    await writeSource(root, 'packages/cli/src/app.ts', 'export {}\n');
    expect(run(root).exitCode).toBe(0);
  });

  it('ignores a stale .claude/worktrees/* copy of this repo carrying the pre-#540 coupling', async () => {
    const root = await makeRoot();
    await writeSource(root, MFES_BARREL_RELATIVE_PATH, CLEAN_BARREL);
    await writeSource(
      root,
      'packages/gts-plugin/src/mfe/registry.ts',
      "import { createMfeRegistryFactory, type MfeRegistryFactory } from '@gears-frontx/mfes'\n",
    );
    // As vitest.scripts.config.mjs documents, `.claude/worktrees/*` can hold a
    // full second copy of this repo — a stale one here still importing the
    // pre-#540 concrete factory must not fail a local guard run.
    await writeSource(
      root,
      '.claude/worktrees/stale/packages/gts-plugin/src/mfe/registry.ts',
      "import { DefaultMfeRegistryFactory } from '@gears-frontx/mfes'\nexport const f = new DefaultMfeRegistryFactory()\n",
    );
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(0);
    expect(output).toContain('import-boundary check passed');
  });

  it('fails closed when the barrel is missing', async () => {
    const root = await makeRoot();
    await writeSource(root, 'packages/cli/src/app.ts', 'export {}\n');
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('barrel not found');
  });

  it('fails closed when the walk finds nothing to scan — zero files is a broken guard, not a pass', async () => {
    const root = await makeRoot();
    await writeSource(root, MFES_BARREL_RELATIVE_PATH, CLEAN_BARREL);
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('no consumer source files');
  });

  // A broken walk still short-circuits with exit 1, but it used to discard
  // barrel violations already found before the walk ran — the run named only
  // the broken walk and stayed silent about a real, already-known coupling.
  it('names already-found barrel violations even when the consumer walk finds nothing', async () => {
    const root = await makeRoot();
    await writeSource(
      root,
      MFES_BARREL_RELATIVE_PATH,
      `${CLEAN_BARREL}\nexport { DefaultMfeRegistry } from './runtime/DefaultMfeRegistry';\n`,
    );
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('no consumer source files');
    expect(output).toContain('DefaultMfeRegistry');
    expect(output).toContain('barrel exports concrete implementation');
  });
});

describe('findConsumerFiles', () => {
  it('walks only scannable extensions outside packages/mfes', async () => {
    const root = await makeRoot();
    await writeSource(root, 'packages/mfes/src/index.ts', 'export {}\n');
    await writeSource(root, 'packages/gts-plugin/src/plugin.ts', 'export {}\n');
    await writeSource(root, 'packages/cli/README.md', 'prose\n');
    await writeSource(root, 'packages/cli/src/app.tsx', 'export {}\n');
    // Root tooling is not a consumer of the runtime package — and this guard's
    // own test fixtures quote the statements the guard forbids.
    await writeSource(root, 'scripts/some-guard.test.mjs', "import { DefaultMfeRegistry } from '@gears-frontx/mfes'\n");
    expect(findConsumerFiles(root)).toEqual([
      path.join('packages', 'cli', 'src', 'app.tsx'),
      path.join('packages', 'gts-plugin', 'src', 'plugin.ts'),
    ]);
  });

  it('does not walk dot-directories, such as a stale .claude/worktrees/* repo copy', async () => {
    const root = await makeRoot();
    await writeSource(root, 'packages/cli/src/app.tsx', 'export {}\n');
    await writeSource(root, '.claude/worktrees/stale/packages/cli/src/app.ts', 'export {}\n');
    expect(findConsumerFiles(root)).toEqual([path.join('packages', 'cli', 'src', 'app.tsx')]);
  });
});
