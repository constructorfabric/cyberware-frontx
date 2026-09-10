// @cpt-FEATURE:cpt-frontx-feature-composed-provenance:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-registration:p1
//
// `unregister <name>` — cpt-frontx-algo-composed-provenance-unregister.
// Reads and writes the single project state document this feature owns
// (`../project-state/io.ts`) through the injected `ReadProjectStateFn`/
// `WriteProjectStateFn` seams; no direct filesystem access here beyond what
// the optional `UnregisterOriginResolveDeps` seam below isolates.
import { readProjectState, mutateProjectState } from '../project-state/io';
import { resolveRegisteredManifestContent } from '../scaffold/registered-manifest';
import type { RegisteredManifestInventoryPort } from '../scaffold/registered-manifest';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { ReadFileFn } from '../manifest/types';
import type { ReadProjectStateFn, WriteProjectStateFn, TemplateEntry } from '../project-state/types';
import type { ErrorCode } from '../envelope';

export type UnregisterOutcome =
  | { ok: true; name: string }
  // The orphan-drop escape below's own outcome — deliberately a SEPARATE
  // variant from the ordinary `{ok:true, name}` above, never the same shape
  // with an optional field added to it: the ordinary case's callers (and
  // this module's own pre-existing tests) already assert the exact shape
  // `{ok:true, name}`, and this escape is a materially different fact worth
  // its own discriminant — every target this name carried is named, and
  // NONE of its files were touched, only the registration was forgotten.
  | { ok: true; name: string; outcome: 'orphan-dropped'; orphanedTargets: string[] }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

// The seams needed to determine whether a name's origin can still be
// resolved at all — the SAME primitive `scaffold/delete-plan.ts` calls to
// resolve a template's CURRENT manifest (`resolveRegisteredManifestContent`,
// `../scaffold/registered-manifest.ts`), reused here rather than a second
// formulation of "can this origin still be read". Deliberately OPTIONAL on
// `unregisterTemplate` below: a caller with no interest in the orphan-drop
// escape (this module's own pre-existing tests, exercising only the
// ordinary `TARGETS_EXIST` refusal) is never forced to supply it, and its
// absence simply means that escape can never trigger — the ordinary refusal
// stands unconditionally, exactly as it always has.
export interface UnregisterOriginResolveDeps {
  repoRoot: string;
  inventory: RegisteredManifestInventoryPort;
  readFileFn: ReadFileFn;
  canonicalizeFn: CanonicalizeTargetFn;
}

// Decides whether `entry`'s `targets[]` can NEVER yield a computable
// deletion plan by any route — the one verified state the orphan-drop
// escape is scoped to, mirroring `scaffold/delete-plan.ts`'s own
// `inst-dp-else-refuse-unestablished` condition exactly: NEITHER the
// RECORDED declaration (`entry.excludedSubtrees`) NOR the CURRENT manifest
// can establish what the name excludes. A RECORDED declaration alone is
// enough to keep the entry usable — `delete` would still compute a plan
// from it — so this returns `false` without even attempting to resolve the
// origin in that case. Otherwise the origin is probed the identical way
// `computeDeletionPlan` probes it: a clean `undefined` (no thrown error)
// means the origin is confirmed genuinely absent (its folder is gone, or
// the local inventory holds no entry for it), which is the ONE case this
// escape covers; a THROWN error means something real stands there but
// could not be read (a FIFO, a permission refusal, ...) — that origin might
// still be repaired and re-registered, so it is treated as usable and this
// returns `false`, leaving the ordinary `TARGETS_EXIST` refusal in force.
async function isUnusableOrphan(name: string, entry: TemplateEntry, deps: UnregisterOriginResolveDeps): Promise<boolean> {
  if (entry.excludedSubtrees !== undefined) return false;
  try {
    const content = await resolveRegisteredManifestContent(name, entry.origin, deps);
    return content === undefined;
  } catch {
    return false;
  }
}

/**
 * cpt-frontx-algo-composed-provenance-unregister — removes `templates[name]`
 * when its `targets` array is empty; refuses with `TARGETS_EXIST` otherwise,
 * naming every dependent target and preserving the entry — UNLESS the entry
 * is an unusable orphan (`isUnusableOrphan` above): its origin can no longer
 * be resolved at all, and no `excludedSubtrees` was ever recorded either, so
 * none of its targets can ever be reconciled into a deletion plan by any
 * route. In that one verified state this algorithm drops the entry anyway,
 * leaving every target's files untouched on disk — only the registration is
 * forgotten, never a target's ground.
 */
export async function unregisterTemplate(
  name: string,
  repoRoot: string,
  readProjectStateFn: ReadProjectStateFn,
  writeProjectStateFn: WriteProjectStateFn,
  originResolveDeps?: UnregisterOriginResolveDeps,
): Promise<UnregisterOutcome> {
  // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-accept
  // `name` is accepted as this function's own parameter.
  // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-accept

  // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-read-state
  const stateResult = await readProjectState(repoRoot, readProjectStateFn);
  // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-read-state
  if (!stateResult.ok) {
    return { ok: false, code: 'PROJECT_INVALID', message: stateResult.message };
  }

  const entry = stateResult.document.templates[name];

  // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-if-absent
  if (entry === undefined) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-return-not-registered
    return { ok: false, code: 'TEMPLATE_NOT_REGISTERED', message: `Template "${name}" is not registered.` };
    // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-return-not-registered
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-if-absent

  // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-if-targets
  if (entry.targets.length > 0) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-if-orphan
    const orphaned = originResolveDeps ? await isUnusableOrphan(name, entry, originResolveDeps) : false;
    if (orphaned) {
      // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-write-orphan-removed
      const writtenOrphan = await mutateProjectState(repoRoot, { kind: 'remove-template', name }, readProjectStateFn, writeProjectStateFn);
      // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-write-orphan-removed
      if (!writtenOrphan.ok) return { ok: false, code: 'PROJECT_INVALID', message: writtenOrphan.message };
      // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-return-orphan-dropped
      // @cpt-begin:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-applied-orphan-unregistered
      return { ok: true, name, outcome: 'orphan-dropped', orphanedTargets: entry.targets };
      // @cpt-end:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-applied-orphan-unregistered
      // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-return-orphan-dropped
    }
    // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-if-orphan

    // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-return-targets
    // @cpt-begin:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-applied-unregister-refused
    return {
      ok: false,
      code: 'TARGETS_EXIST',
      message:
        `Template "${name}" still has applied targets; unregister refused. ` +
        `Run "delete" on each target first: ${entry.targets.join(', ')}.`,
      details: { name, targets: entry.targets },
    };
    // @cpt-end:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-applied-unregister-refused
    // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-return-targets
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-if-targets

  // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-else
  // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-write-removed
  const written = await mutateProjectState(repoRoot, { kind: 'remove-template', name }, readProjectStateFn, writeProjectStateFn);
  // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-write-removed
  if (!written.ok) return { ok: false, code: 'PROJECT_INVALID', message: written.message };
  // @cpt-begin:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-return-success
  // @cpt-begin:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-empty-to-unreg
  return { ok: true, name };
  // @cpt-end:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-empty-to-unreg
  // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-return-success
  // @cpt-end:cpt-frontx-algo-composed-provenance-unregister:p1:inst-cpunreg-else
}
