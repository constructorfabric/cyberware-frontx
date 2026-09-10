// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
//
// REDUCED (checkpoint 3): the OLD `addTemplate` command function this file
// used to export is retired. `commands/apply.ts`'s `runApplyPipeline` (the
// `apply` command's core, also reused by `seed`) replaces it under the new
// uniform batch model (FEATURE §2 "Apply a Batch into an Already-Assembled
// Repository") — the command TOKEN is `apply`, not `add`
// (`cpt-frontx-flow-cli-scaffolding-add-template`'s own realizing command).
//
// This file survives ONLY as the shared home of `TargetPathState`/
// `ReadTargetPathStateFn` — a generic "what stands at this absolute path"
// seam `commands/ownership.ts` (finished this checkpoint, not this
// developer's to touch) imports from this EXACT path (`./add-template`),
// and `adapters/fs-target-path.ts` still implements it against that same
// path. Relocating the type would require editing `ownership.ts`'s import,
// which is out of this checkpoint's territory — kept here instead, with
// every other piece of the old `add` command retired.
export type TargetPathState = 'directory' | 'file' | 'absent';

export type ReadTargetPathStateFn = (absolutePath: string) => Promise<TargetPathState>;
