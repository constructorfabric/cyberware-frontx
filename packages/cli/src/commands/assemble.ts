// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
// @cpt-flow:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1
//
// `assemble` — cpt-frontx-flow-cli-scaffolding-assemble-preview. Stateless:
// resolves the batch and runs the pre-flight conflict check through the
// SAME `resolveAndCheckBatch` formulation `apply` calls
// (`./apply.ts`) — never a second, independently-formulated resolve-and-
// check path — and returns the preview report. Nothing is ever written on
// any path: no `writeFileFn`, no `mutateProjectState`, no on-disk existing-
// content reconciliation. The one exception, matching `uniformApply`'s own
// documented behavior for EVERY caller including this one, is that a named
// template not yet locally available is auto-installed into the CLI's own
// local template inventory cache — a write to the resolver's cache
// directory, never to the developer's REPOSITORY or its project state
// document, which is what this flow's own DoD promises stays byte-
// identical before and after.
import type { UniformApplyBatch } from '../scaffold/assembler';
import type { ReadProjectStateFn } from '../project-state/types';
import type { ErrorCode } from '../envelope';
import { resolveAndCheckBatch } from './apply';
import type { ResolveAndCheckDeps } from './apply';

export interface AssemblePreviewEntry {
  templateName: string;
  target: string;
  installedContentPath: string;
  exclusionRoots: string[];
}

export type AssembleOutcome =
  | { ok: true; entries: AssemblePreviewEntry[] }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

// @cpt-dod:cpt-frontx-dod-cli-scaffolding-uniform-apply:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-conflict-check:p1
/**
 * cpt-frontx-flow-cli-scaffolding-assemble-preview — the whole flow is one
 * call into the shared resolve-and-check path, mapped to a preview report on
 * success.
 */
// @cpt-begin:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-invoke
export async function assembleBatch(
  rawBatch: UniformApplyBatch,
  repoRoot: string,
  deps: ResolveAndCheckDeps,
  readProjectStateFn: ReadProjectStateFn,
): Promise<AssembleOutcome> {
  // `rawBatch`/`repoRoot` are accepted as this function's own parameters —
  // `inst-asm-resolve` through `inst-asm-return-conflict` are realized by
  // `resolveAndCheckBatch` (`./apply.ts`), marked there rather than
  // re-marked here.
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-invoke
  const resolved = await resolveAndCheckBatch(rawBatch, repoRoot, deps, readProjectStateFn);
  if (!resolved.ok) return resolved;

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-return-preview
  return {
    ok: true,
    entries: resolved.assembly.entries.map((entry) => ({
      templateName: entry.templateName,
      target: entry.target,
      installedContentPath: entry.installedContentPath,
      exclusionRoots: entry.exclusionRoots,
    })),
  };
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-return-preview
}
