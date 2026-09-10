# Workflow: Add multiple MFE packages in parallel

Use with the `add-mfe-package` skill when a task needs two or more new MFE
packages. That skill stays the authority on every per-package step; this
workflow adds the phase structure that lets the per-package work run
concurrently. It exists because MFE packages are disjoint directories: once
scaffolding has touched the shared files, one agent per package can fill its
own directory without ever contending with the others, and total wall-clock
approaches the slowest single package instead of the sum.

The structural rule the whole workflow enforces: **every write to a shared
file happens in a serial phase; the parallel phase writes only inside each
agent's own package directory.** Shared files are the root `package.json` and
lockfile, `public/generated-mfe-manifests.json`, and anything under
`src-app/app/` — nothing else on this list should ever need touching for a
new MFE.

## Phase 1 — Scaffold serially (orchestrator)

1. For each new MFE, run the `add-mfe-package` skill steps 1-4: copy
   `_blank-mfe` and strip `templateExample`, assign the port, rename the
   package identity, assign GTS IDs. Assign all ports from one central list
   (`3010`, `3020`, ...) in this phase — two parallel agents choosing their
   own ports is a collision, and `dev:all`'s auto-discovery will not warn.
2. Declare each package's full dependency set now (the scaffold already
   carries `@gears-frontx/ui-kit` and the framework packages; add anything
   the screen's plan calls for), then run `npm install` once. The lockfile is
   a shared file: after this step, no agent installs anything.
3. Confirm each scaffold with the skill's flag-strip check before
   dispatching; a package that kept `templateExample` fails silently and the
   parallel phase would build a screen nothing will ever load.

## Phase 2 — Fill in parallel (one agent per MFE)

Dispatch one implementation agent per package using your environment's
subagent mechanism (the Task/Agent tool in Claude Code and compatible
harnesses), issuing every dispatch in a single message so they actually run
concurrently. Dispatch in the FOREGROUND — blocking calls whose results
return into your turn. Never dispatch as background tasks and end your turn
to wait for notifications: in headless runs the session exits with your turn
and orphans every background agent mid-write. This phase is a dispatch, not a description: when a subagent
mechanism exists, performing the per-package fill inline in your own context
is not following this workflow. Only if your environment truly has no way to
run agents does Phase 2 fall back to filling the packages one at a time under
the same per-package contract and boundaries — and then your final report
must say the parallel phase ran serially and why, because a silent fallback
reads as parallel execution that never happened.

Each dispatch prompt must carry, explicitly:

- the single package directory the agent owns — the only place it may write;
- skill steps 5-6 (lifecycle, screen from the installed ui-kit) as its
  contract, plus the skill's Boundaries section;
- when a design-contract bundle is installed (any AI bundle shipping a
  `generate-interface` skill — check for
  `.frontx/ai/*/*/skills/generate-interface/`),
  the full contract handover that skill requires:
  the concrete paths of the contract files and routed guidelines, and the
  instruction to read them first — the contract does not transfer by
  implication, and per-agent dispatch is exactly the delegation case that
  rule exists for;
- the iteration-scoped check commands: `npm run type-check
  --workspace=<package-name>`, `npm run test:unit --workspace=<package-name>`,
  `npm run build --workspace=<package-name>`. Scoped checks are what make the
  parallelism safe — a full sweep run mid-fill would judge another agent's
  half-finished package and fail on defects that are not this agent's to fix.

Hard boundaries for every parallel agent, stated in the dispatch prompt:

- no writes outside its own package directory;
- no `npm install`, no lockfile or root-manifest edits — a mid-fill
  dependency need is a blocking return to the orchestrator, which applies it
  serially and re-dispatches that one agent;
- no `generate:mfe-manifests`, no full type-check/test/build sweeps, no dev
  server — rendered verification belongs to Phase 3.

Each agent returns its changed files, the states it implemented, and its
unresolved or unverified gaps (the `generate-interface` return shape when the
guardrails bundle governs).

## Phase 3 — Integrate serially (orchestrator)

1. `npm run build:mfes`, then `npm run generate:mfe-manifests` — once, after
   every agent has returned.
2. The full gate, once: `npm run type-check`, `npm run test:unit`,
   `npm run arch:deps`.
3. `npm run dev:all`; confirm every new screen mounts with zero console
   errors. When the guardrails bundle is installed, run its `verify-interface`
   flow once across all new screens' routes — one closing pass, not one per
   package.
4. Review the new screens against each other: parallel agents never saw each
   other's output, so cross-screen consistency (shared terminology, matching
   list/detail conventions, consistent density and action placement) is the
   one defect class this workflow structurally cannot catch earlier and must
   check here.

If any Phase 3 step fails inside one package, hand the failure back to that
package's agent (or a fresh one) with the same Phase 2 contract and re-run
only the affected integration steps — the other packages' results stand.
