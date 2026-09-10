/**
 * Template Token-Format Guard.
 *
 * The design tokens shared between the templates and `@gears-frontx/ui-kit`
 * are FULL CSS COLORS (`--primary: hsl(221 83% 53%)`, consumed as
 * `var(--primary)`), not shadcn-style HSL fragments (`--primary: 221 83% 53%`,
 * consumed as `hsl(var(--primary))`). The migration to that single vocabulary
 * landed with the design-guardrails adoption (PR #586): the kit's stylesheets
 * always consumed `var(--x)` directly, so any template-side consumer still
 * wrapping a token in `hsl()` / `hsla()` reads a full color where a fragment
 * is expected — invalid at computed-value time, which CSS resolves to
 * unset/inherit, i.e. the style silently disappears rather than erroring.
 * That failure mode produced three real regressions during the migration
 * (unstyled kit components, a transparent Studio dropdown, kit-violet hover
 * colors) and one latent one this guard's first sweep caught (demo-mfe chart
 * colors) — each invisible to lint, type-check, and jsdom tests alike.
 *
 * This guard makes the vocabulary permanent: no source file in template
 * territory may consume a custom property through an `hsl()`/`hsla()` wrapper.
 * The alpha forms the old vocabulary needed (`hsl(var(--x) / 0.5)`) have
 * full-color equivalents (`color-mix(in oklab, var(--x) 50%, transparent)`),
 * and fallback forms belong INSIDE `var()` (`var(--x, hsl(0 0% 100%))`),
 * which this guard deliberately does not match.
 *
 * Scope is template territory only (top-level directories carrying
 * `frontx-template.json`, discovered the same manifest-presence way as the
 * sibling guards — never a `template-*` name guess). `packages/cli/templates/`
 * also carries the old vocabulary, but as a self-consistent pair (fragment
 * tokens + `hsl(var())` consumers) owned by the CLI scaffold; it is out of
 * scope here and migrates on its own schedule.
 *
 * Zero templates discovered — or zero files actually scanned — is a hard
 * failure, never a vacuous pass, matching the sibling guards.
 *
 * CLI entry: `node scripts/token-format-check.mjs` (exit 0 on success). Core
 * logic is exported for unit tests in `scripts/token-format-check.test.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { MANIFEST_FILENAME, findTemplateDirs } from './template-discovery.mjs';

// Re-exported for the zero-templates failure message, same as the sibling
// guards: the filename is owned by `template-discovery.mjs`.
export { MANIFEST_FILENAME };

/**
 * A custom property consumed through an HSL wrapper: `hsl(var(` / `hsla(var(`,
 * with optional whitespace after the opening paren. `var(--x, hsl(...))` — a
 * full-color fallback inside `var()` — does not match: there the wrapper
 * contains no `var(`.
 */
export const FORBIDDEN_PATTERN = /\bhsla?\(\s*var\(/i;

/**
 * Source extensions that can carry CSS values: stylesheets themselves, plus
 * TS/TSX/JS/JSX where tokens appear in tailwind configs, CSS-in-JS strings,
 * inline styles, and SVG/chart color props.
 */
export const SCANNED_EXTENSIONS = new Set(['.css', '.scss', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

/**
 * Directory names never entered: installed and generated trees. A violation
 * in build output always has a source-tree twin, and node_modules is not
 * ours to lint.
 */
export const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'dist-lib', 'coverage', '.vite', '.__mf__temp', '.git']);

/**
 * Scans one file's content for forbidden token consumptions.
 *
 * @param {string} content
 * @returns {Array<{ line: number; text: string }>} 1-based line hits.
 */
export function findViolationsInContent(content) {
  /** @type {Array<{ line: number; text: string }>} */
  const hits = [];
  const lines = content.split(/\r?\n/);
  // Scan the whole content, not line by line: CSS functional notation allows
  // a line break between the wrapper and its argument (`hsl(\n  var(--x))`),
  // which a per-line test would wave through. The hit is reported on the line
  // the wrapper starts on, one hit per line as before.
  const pattern = new RegExp(FORBIDDEN_PATTERN.source, 'gi');
  for (const match of content.matchAll(pattern)) {
    const line = content.slice(0, match.index).split(/\r?\n/).length;
    if (hits.at(-1)?.line === line) continue;
    hits.push({ line, text: lines[line - 1].trim() });
  }
  return hits;
}

/**
 * Recursively collects scannable source files under a directory.
 *
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]} absolute file paths.
 */
export function collectSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Dot-directories are tool/metadata trees (.git, .vite, .frontx — the
      // last carries only md/json bundle files), never scannable source.
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
      collectSourceFiles(full, out);
    } else if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Core check.
 *
 * @param {{
 *   rootDir: string;
 *   log: (line: string) => void;
 *   logError: (line: string) => void;
 * }} options
 * @returns {number} 0 on success, 1 on failure.
 */
export function check({ rootDir, log, logError }) {
  const templateDirs = findTemplateDirs(rootDir);
  if (templateDirs.length === 0) {
    logError(
      `[token-format-check] FAIL: no template directories found under ${rootDir} ` +
        `(a template is a top-level directory carrying ${MANIFEST_FILENAME}). ` +
        'Zero templates is a discovery bug, not a pass.',
    );
    return 1;
  }

  /** @type {Array<{ file: string; line: number; text: string }>} */
  const violations = [];
  let scannedFiles = 0;

  for (const templateDir of templateDirs) {
    for (const file of collectSourceFiles(templateDir)) {
      scannedFiles++;
      for (const hit of findViolationsInContent(fs.readFileSync(file, 'utf8'))) {
        violations.push({ file: path.relative(rootDir, file), line: hit.line, text: hit.text });
      }
    }
  }

  if (scannedFiles === 0) {
    logError(
      `[token-format-check] FAIL: ${templateDirs.length} template(s) discovered but zero source files scanned — ` +
        'the extension or skip lists no longer match the tree. Not a pass.',
    );
    return 1;
  }

  if (violations.length > 0) {
    logError(
      `[token-format-check] FAIL: ${violations.length} HSL-fragment token consumption(s) in template territory. ` +
        'Template and ui-kit tokens are full CSS colors: consume them as `var(--x)`; ' +
        'for alpha use `color-mix(in oklab, var(--x) N%, transparent)`; ' +
        'fallbacks go inside var(): `var(--x, hsl(0 0% 100%))`.',
    );
    for (const v of violations) {
      logError(`  ${v.file}:${v.line}: ${v.text}`);
    }
    return 1;
  }

  log(
    `Token-format check passed: ${scannedFiles} source file(s) across ${templateDirs.length} template(s) ` +
      'consume design tokens as full CSS colors (no hsl(var(...)) wrappers).',
  );
  return 0;
}

/**
 * CI entry point. Wired into `npm run policy:token-format` and
 * `.github/workflows/main.yml`.
 *
 * Fail-closed throws (unreadable files, discovery errors) are caught here and
 * turned into an exit code with a message naming the cause, same as the
 * sibling guards.
 *
 * @param {{
 *   rootDir?: string;
 *   log?: (line: string) => void;
 *   logError?: (line: string) => void;
 * }} [options]
 * @returns {number} 0 on success, 1 on failure.
 */
export function runCli(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;

  try {
    return check({ rootDir, log, logError });
  } catch (error) {
    logError(`[token-format-check] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  process.exitCode = runCli();
}
