// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FORBIDDEN_PATTERN,
  collectSourceFiles,
  findViolationsInContent,
  runCli,
} from './token-format-check.mjs';

/** @type {string | undefined} */
let rootDir;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

async function makeRoot() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-tokenformat-'));
  return rootDir;
}

/**
 * @param {string} filePath
 * @param {string} content
 */
async function write(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

// A minimal marker manifest - discovery only checks for the file's presence
// (`findTemplateDirs`), never its content.
/** @param {string} templateDir */
async function writeManifest(templateDir) {
  await write(path.join(templateDir, 'frontx-template.json'), '{}');
}

/** Runs the guard with its output captured, so a case can assert what it named. */
/** @param {string} root */
function run(root) {
  /** @type {string[]} */
  const lines = [];
  const capture = (/** @type {string} */ line) => {
    lines.push(line);
  };
  const exitCode = runCli({ rootDir: root, log: capture, logError: capture });
  return { exitCode, output: lines.join('\n') };
}

describe('FORBIDDEN_PATTERN', () => {
  it('matches hsl(var(, hsla(var(, and whitespace after the paren', () => {
    expect(FORBIDDEN_PATTERN.test("fill: hsl(var(--primary));")).toBe(true);
    expect(FORBIDDEN_PATTERN.test("color: hsla(var(--x) / 0.5);")).toBe(true);
    expect(FORBIDDEN_PATTERN.test("color: hsl( var(--x));")).toBe(true);
    // CSS function names are ASCII case-insensitive; the guard must be too.
    expect(FORBIDDEN_PATTERN.test("color: HSL(var(--x));")).toBe(true);
    expect(FORBIDDEN_PATTERN.test("color: Hsla(var(--x) / 0.5);")).toBe(true);
  });

  it('does not match the full-color vocabulary', () => {
    // Plain consumption, alpha via color-mix, and a full-color fallback
    // INSIDE var() — the three forms the migration standardized on.
    expect(FORBIDDEN_PATTERN.test("color: var(--primary);")).toBe(false);
    expect(FORBIDDEN_PATTERN.test("color: color-mix(in oklab, var(--x) 50%, transparent);")).toBe(false);
    expect(FORBIDDEN_PATTERN.test("background: var(--background, hsl(0 0% 100%));")).toBe(false);
    // Token DEFINITIONS as full colors are the point, not a violation.
    expect(FORBIDDEN_PATTERN.test("--primary: hsl(221 83% 53%);")).toBe(false);
  });
});

describe('findViolationsInContent', () => {
  it('reports 1-based line numbers with trimmed text', () => {
    const hits = findViolationsInContent('a\n  fill="hsl(var(--primary))"\nb');
    expect(hits).toEqual([{ line: 2, text: 'fill="hsl(var(--primary))"' }]);
  });

  it('catches a wrapper whose argument starts on the next line', () => {
    const hits = findViolationsInContent('a\ncolor: hsl(\n  var(--primary)\n);\nb');
    expect(hits).toEqual([{ line: 2, text: 'color: hsl(' }]);
  });

  it('reports one hit per line even with several matches on it', () => {
    const hits = findViolationsInContent('x: hsl(var(--a)) hsla(var(--b));');
    expect(hits).toHaveLength(1);
  });
});

describe('collectSourceFiles', () => {
  it('skips node_modules, dist, and dot-directories but scans css/ts/tsx', async () => {
    const root = await makeRoot();
    const tpl = path.join(root, 'template-x');
    await write(path.join(tpl, 'src/app.tsx'), '');
    await write(path.join(tpl, 'src/globals.css'), '');
    await write(path.join(tpl, 'node_modules/pkg/index.ts'), '');
    await write(path.join(tpl, 'dist/out.css'), '');
    await write(path.join(tpl, '.frontx/ai/thing.ts'), '');
    await write(path.join(tpl, 'README.md'), '');
    const files = collectSourceFiles(tpl).map((f) => path.relative(tpl, f)).sort();
    expect(files).toEqual(['src/app.tsx', 'src/globals.css']);
  });
});

describe('runCli', () => {
  it('fails hard with zero templates discovered', async () => {
    const root = await makeRoot();
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('no template directories');
  });

  it('fails hard when templates exist but nothing was scannable', async () => {
    const root = await makeRoot();
    const tpl = path.join(root, 'template-docs-only');
    await writeManifest(tpl);
    await write(path.join(tpl, 'DESIGN.md'), '# only markdown');
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('zero source files scanned');
  });

  it('passes a clean template and names the scan volume', async () => {
    const root = await makeRoot();
    const tpl = path.join(root, 'template-clean');
    await writeManifest(tpl);
    await write(path.join(tpl, 'src/globals.css'), ':root { --primary: hsl(221 83% 53%); }\n.a { color: var(--primary); }');
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(0);
    expect(output).toContain('Token-format check passed');
  });

  it('fails on a violation and names file, line, and the offending text', async () => {
    const root = await makeRoot();
    const tpl = path.join(root, 'template-dirty');
    await writeManifest(tpl);
    await write(path.join(tpl, 'src/chart.tsx'), 'export const fill = "hsl(var(--primary))";');
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain(`${path.join('template-dirty', 'src', 'chart.tsx')}:1`);
    expect(output).toContain('hsl(var(--primary))');
    expect(output).toContain('color-mix');
  });

  it('scans every discovered template, not just the first', async () => {
    const root = await makeRoot();
    const clean = path.join(root, 'template-clean');
    await writeManifest(clean);
    await write(path.join(clean, 'src/a.css'), '.a { color: var(--x); }');
    const dirty = path.join(root, 'template-dirty');
    await writeManifest(dirty);
    await write(path.join(dirty, 'src/b.css'), '.b { color: hsl(var(--x)); }');
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain(path.join('template-dirty', 'src', 'b.css'));
  });
});
