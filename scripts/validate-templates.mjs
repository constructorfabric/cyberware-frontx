/**
 * Prepublish Template Validation CI Guard (#493 work item 2).
 *
 * Runs the CLI's prepublish validate command (`frontx validate`) - manifest
 * contract PLUS content self-containment (#493) - against every template at
 * the repo root. No CI job invoked this command before #493; the CLI has
 * always had it (`cpt-frontx-dod-template-manifest-validate-command`), but
 * nothing wired it into a pipeline.
 *
 * Generic by construction: no template name is hardcoded. Discovery is
 * `template-discovery.mjs`'s manifest-presence rule, shared with the pin-drift
 * guard - a future template is covered whatever it ends up named or located at
 * the repo root, with no change to this script or the workflow step that runs
 * it. The #470 split already exercised that: `template-standard/` became
 * `template-shell/` plus `template-mfe/`, and both were picked up unchanged.
 *
 * Imports `@gears-frontx/cli`'s command directly rather than spawning the
 * built `frontx` binary as a child process - one less path assumption, and it
 * runs against the exact in-repo build `npm run build:packages:cli` just
 * produced. That import is DYNAMIC (`loadCliModule` below), not a static
 * top-level `import`: a static import fails module EVALUATION itself with
 * node's raw `ERR_MODULE_NOT_FOUND` stack trace the instant `packages/cli/dist`
 * is missing (a fresh clone, a `clean:artifacts` run) - before this script's
 * own code ever runs, so it can't be caught or turned into a clear message.
 * The dynamic import runs inside `runCli`, where a missing build is caught
 * and reported as an actionable instruction instead (the #492 review's
 * "confusing module-resolution error" class, finding 3).
 *
 * CLI entry: `node scripts/validate-templates.mjs` (exit 0 on success).
 * Core logic is exported for unit tests in
 * `scripts/validate-templates.test.mjs`.
 */
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { findTemplateDirs } from './template-discovery.mjs';

/**
 * @param {unknown} error
 * @returns {boolean} whether `error` is node's "module not found" error -
 *   the shape a missing `packages/cli/dist` produces on `import('@gears-frontx/cli')`.
 */
function isModuleNotFoundError(error) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND';
}

/**
 * Dynamically imports `@gears-frontx/cli`, mapping a missing build to a
 * clear, actionable result instead of letting node's raw
 * `ERR_MODULE_NOT_FOUND` stack trace reach the caller unexplained (#492
 * review finding 3's "confusing module-resolution error" class).
 *
 * @param {(specifier: string) => Promise<unknown>} [importFn] injected for testing
 * @returns {Promise<{ ok: true; module: typeof import('@gears-frontx/cli') } | { ok: false; message: string }>}
 */
export async function loadCliModule(importFn = (specifier) => import(specifier)) {
  try {
    const module = /** @type {typeof import('@gears-frontx/cli')} */ (await importFn('@gears-frontx/cli'));
    return { ok: true, module };
  } catch (error) {
    if (isModuleNotFoundError(error)) {
      return {
        ok: false,
        message:
          'built @gears-frontx/cli not found (packages/cli/dist is missing) - run `npm run build:packages:cli` first.',
      };
    }
    throw error;
  }
}

/**
 * @param {{
 *   rootDir?: string;
 *   loadCliModule?: typeof loadCliModule;
 *   readFileFn?: import('@gears-frontx/cli').ReadFileFn;
 *   listPayloadFilesFn?: import('@gears-frontx/cli').ListPayloadFilesFn;
 *   resolveDeclaredExclusionFn?: import('@gears-frontx/cli').ResolveDeclaredExclusionFn;
 *   log?: (line: string) => void;
 *   logError?: (line: string) => void;
 * }} [options]
 * @returns {Promise<number>} 0 on success, 1 on failure.
 */
export async function runCli(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;

  const loaded = await (options.loadCliModule ?? loadCliModule)();
  if (!loaded.ok) {
    logError(`[validate-templates] FAIL: ${loaded.message}`);
    return 1;
  }
  const {
    createFsListPayloadFilesFn,
    createFsResolveDeclaredExclusionFn,
    createFsReadFileFn,
    MANIFEST_FILENAME,
    validateCommand,
  } = loaded.module;

  const readFileFn = options.readFileFn ?? createFsReadFileFn();
  const listPayloadFilesFn = options.listPayloadFilesFn ?? createFsListPayloadFilesFn();
  const resolveDeclaredExclusionFn = options.resolveDeclaredExclusionFn ?? createFsResolveDeclaredExclusionFn();

  const templateDirs = findTemplateDirs(rootDir, MANIFEST_FILENAME);

  // A5 review finding: an empty result is never a silent pass. It means
  // either no template exists (unexpected - this repo always ships at least
  // one) or discovery is broken (wrong `rootDir`, a renamed manifest
  // filename) - either way, a human needs to see it, not a green checkmark.
  if (templateDirs.length === 0) {
    logError(`[validate-templates] FAIL: no template found under ${rootDir} (looked for a top-level directory carrying ${MANIFEST_FILENAME}).`);
    return 1;
  }

  let failed = false;

  for (const templateDir of templateDirs) {
    const templateName = path.basename(templateDir);
    const result = await validateCommand(templateDir, readFileFn, listPayloadFilesFn, resolveDeclaredExclusionFn);
    if (result.ok) {
      log(`[validate-templates] PASS: ${templateName}`);
    } else {
      failed = true;
      logError(`[validate-templates] FAIL: ${templateName}\n${result.message}`);
    }
  }

  return failed ? 1 : 0;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  // `process.exitCode` rather than `process.exit()`: the latter can truncate a
  // still-flushing stderr write, which for a guard means losing the very
  // violation list that says what failed.
  process.exitCode = await runCli();
}
