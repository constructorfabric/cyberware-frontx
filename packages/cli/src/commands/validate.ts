// @cpt-flow:cpt-frontx-flow-template-manifest-validate-for-publication:p1
// @cpt-dod:cpt-frontx-dod-template-manifest-validate-command:p1
// @cpt-dod:cpt-frontx-dod-template-manifest-content-self-containment:p2
import type {
  ListPayloadFilesFn,
  ResolveDeclaredExclusionFn,
  ManifestValidationResult,
  ManifestViolation,
  ReadFileFn,
} from '../manifest/types';
import { MANIFEST_FILENAME } from '../manifest/types';
import { validateManifestContract } from '../manifest/validate-contract';
import { validateContentSelfContainment } from '../manifest/validate-content-self-containment';
import { NotRegularFileError, UnreachablePathError, PathUnreadableError } from '../adapters/fs-project-io';

export interface ValidateCommandResult {
  ok: boolean;
  exitCode: 0 | 1;
  message: string;
  violations?: ManifestViolation[];
}

// @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-invoke-validate
export async function validateCommand(
  templateDir: string,
  readFileFn: ReadFileFn,
  listPayloadFilesFn: ListPayloadFilesFn,
  resolveDeclaredExclusionFn: ResolveDeclaredExclusionFn,
): Promise<ValidateCommandResult> {
  // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-invoke-validate

  // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-locate-manifest
  const manifestPath = `${templateDir}/${MANIFEST_FILENAME}`;
  // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-locate-manifest

  let raw: string;
  try {
    raw = await readFileFn(manifestPath);
  } catch (error) {
    // A typed refusal from the read seam (`../adapters/fs-project-io.ts`)
    // means something real stands at `manifestPath` and was inspected — a
    // FIFO, socket, device, directory, or dangling symlink; a component
    // above it that is not a directory; or a path the probe accepts but
    // cannot actually open. None of those is "not found", and reporting them
    // that way would send a developer looking for a file that is right there
    // instead of at what actually blocks reading it. Anything else reaching
    // this catch (including a bare fixture error with no typed shape at all)
    // is treated as genuine absence, matching this seam's own long-standing
    // "throws on absence" contract.
    if (error instanceof NotRegularFileError || error instanceof UnreachablePathError || error instanceof PathUnreadableError) {
      return {
        ok: false,
        exitCode: 1,
        message: `manifest at "${manifestPath}" could not be read: ${error.message}`,
      };
    }
    // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-if-manifest-absent
    // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-return-manifest-absent
    return {
      ok: false,
      exitCode: 1,
      message: `manifest not found: ${manifestPath}`,
    };
    // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-return-manifest-absent
    // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-if-manifest-absent
  }

  // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-delegate-to-algo
  const result = validateManifestContract(raw);
  // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-delegate-to-algo

  // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-if-rejected
  if (result.status === 'REJECTED') {
    // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-report-violations
    const summary = result.violations
      .map((v) => `  [${v.field}] ${v.message}`)
      .join('\n');
    // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-report-violations
    // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-return-fail
    return {
      ok: false,
      exitCode: 1,
      message: `FAIL: manifest validation failed with ${result.violations.length} violation(s):\n${summary}`,
      violations: result.violations,
    };
    // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-return-fail
  }
  // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-if-rejected

  // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p2:inst-delegate-to-content-algo
  // The command is the seam where an IO failure becomes a result, exactly as it
  // already is for the manifest read above. Neither `ListPayloadFilesFn` nor
  // `ResolveDeclaredExclusionFn` has an error channel by design - the
  // algorithm behind them never touches a filesystem - so a real
  // `readdir`/`stat`/`lstat` refusal (a permission-denied directory, a path
  // that vanished mid-walk), or a declared `excludedSubtrees` entry that is a
  // broken symlink or escapes the template root, can only arrive here as a
  // throw, and before this it escaped `validateCommand` as a raw node stack
  // trace that bypassed the exit-code contract every other failure goes
  // through (review finding on #493). Catching in the adapter instead would
  // have to invent a return value for "I could not enumerate", and the only
  // one the signature allows is an empty list - a fail-open that reads as a
  // clean template.
  let contentResult: ManifestValidationResult;
  try {
    contentResult = await validateContentSelfContainment(templateDir, raw, listPayloadFilesFn, resolveDeclaredExclusionFn, readFileFn);
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      message:
        `FAIL: template content could not be inspected for self-containment: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p2:inst-delegate-to-content-algo

  // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p2:inst-if-content-violations
  if (contentResult.status === 'REJECTED') {
    // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p2:inst-report-content-violations
    const contentSummary = contentResult.violations
      .map((v) => `  [${v.field}] ${v.message}`)
      .join('\n');
    // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p2:inst-report-content-violations
    // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p2:inst-return-content-fail
    return {
      ok: false,
      exitCode: 1,
      message: `FAIL: template content is not self-contained - ${contentResult.violations.length} violation(s):\n${contentSummary}`,
      violations: contentResult.violations,
    };
    // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p2:inst-return-content-fail
  }
  // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p2:inst-if-content-violations

  // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-else-pass
  // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-report-pass
  // @cpt-begin:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-return-pass
  return {
    ok: true,
    exitCode: 0,
    message: 'PASS: manifest conforms to the template contract',
  };
  // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-return-pass
  // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-report-pass
  // @cpt-end:cpt-frontx-flow-template-manifest-validate-for-publication:p1:inst-else-pass
}
