# Contributing to Gears FrontX

> **TARGET AUDIENCE:** Humans and agents
> **PURPOSE:** Contribution guidelines and workflow for developers

## Branching Model (Gitflow)

| Branch | Lifecycle | Purpose | Publishes to |
|--------|-----------|---------|-------------|
| `main` | permanent | Current stable major | `latest` npm dist-tag |
| `develop` | permanent | Active development | `alpha` npm dist-tag |
| `release/X.Y.Z` | short-lived | Release preparation (from develop → main) | `next` npm dist-tag |
| `release/vN` | long-lived | Maintenance line for major version N | `vN` npm dist-tag (e.g. `v1`) |
| `feature/*` | short-lived | Feature branches (from develop) | — |
| `hotfix/*` | short-lived | Hotfix branches (from main → main + develop) | — |

### Standard Workflow

1. Create a `feature/*` branch from `develop`
2. Make changes, commit (signed off - see [Commit Requirements](#commit-requirements)), push, open PR targeting `develop`
3. After review and merge, CI publishes alpha versions
4. When ready for release, create `release/X.Y.Z` from `develop`
5. Finalize version bumps, merge `release/X.Y.Z` into `main`
6. CI publishes stable versions, merge back to `develop`

### Resolving Conflicts with `develop`

**For any branch with a PR targeting `develop` (`feature/*`, `fix/*`, or otherwise), always rebase onto `develop`; never merge `develop` into your branch.** If your branch falls behind canonical `develop` and needs conflicts resolved, rebase onto it:

```bash
git fetch origin develop
git rebase origin/develop
# for each conflicted commit: resolve conflicts, then stage every resolved path
git add -- path/to/resolved-file
# substitute every actual resolved path before continuing
git rebase --continue
# repeat resolve/add/continue until the rebase completes
git push --force-with-lease
```

To abandon the rebase and return to the previous branch state instead, run `git rebase --abort`. In a fork-based setup, replace `origin` with the remote that tracks `constructorfabric/gears-frontx`.

A merge from `develop` into a work branch makes the merge commit and any conflict-resolution combined diff durable in branch history, which is hard to review.

### Previous-Major Maintenance

When a new major is released, the previous major gets a long-lived `release/vN` branch:

1. When cutting major v2, create `release/v1` from the last v1 commit on `main`
2. To fix a bug in v1: branch `hotfix/*` from `release/v1`
3. PR targets `release/v1` → merge → CI publishes with `--tag v1`
4. If the fix also applies to v2, cherry-pick to `develop` or `main`

Users install old majors explicitly: `npm install @gears-frontx/react@v1`

## Commit Requirements

**Sign off every commit (DCO).** Each commit must carry a `Signed-off-by` line certifying the [Developer Certificate of Origin](https://developercertificate.org/). Pass `-s` when committing:

```bash
git commit -s -m "feat: describe the change"
```

To add a missing sign-off to the latest commit, run `git commit --amend -s --no-edit`. To sign off a range of commits, run `git rebase --signoff <base>` (e.g. `git rebase --signoff HEAD~3` to cover the last three), then push with `--force-with-lease`. Note that `git rebase --signoff` appends the trailer even when a `Signed-off-by` already exists earlier in the message (it only skips when an identical sign-off is last), so rebasing over already-signed commits that end in `Co-Authored-By` adds a duplicate line - pick a `<base>` that spans only the commits missing the trailer.

This is enforced locally by a `commit-msg` hook (`require-signoff` in [`.pre-commit-config.yaml`](.pre-commit-config.yaml)); commits without the trailer are rejected before they're made. The hook is installed automatically by `npm install` (via the `prepare` script) — if commits aren't being checked, run `npx prek install`.

## Versioning

The project is **pre-1.0** — backward compatibility is not guaranteed.

| Version format | Channel | Branch | Meaning |
|---------------|---------|--------|---------|
| `0.y.z-alpha.N` | `alpha` | `develop` | Development snapshot |
| `0.y.z-rc.N` | `next` | `release/X.Y.Z` | Release candidate |
| `0.y.z` | `latest` | `main` | Stable release |
| `N.y.z` | `vN` | `release/vN` | Previous major maintenance |

- **Minor bump** (`0.1.x` → `0.2.x`) — may contain breaking changes
- **Patch bump** (`0.1.0` → `0.1.1`) — non-breaking fixes/features
- **Alpha increment** (`alpha.0` → `alpha.1`) — each merge to develop

A PR that changes non-documentation source under `src/`, or the dependency fields of `package.json`, for a governed package (non-private `@gears-frontx`-scoped packages: `packages/*`, `template-shell`, and `template-shell/packages/*`) must bump that package's own `version` in the same PR — and update every exact pin on it (see `policy:template-pin-drift`). CI (`policy:version-bump-on-change`, pull requests only) compares the version at the PR's merge base against the version at its head, so a bump that is later reverted within the same PR does not count. Packages the PR itself adds or removes are exempt, as are private packages (e.g. the `template-mfe` fixture apps), which are pinned consumers rather than published sources.

### Dependency Pinning

Third-party dependencies are pinned to exact versions so installs are deterministic.

- **Exact pins everywhere** — every non-`@gears-frontx` dependency in `packages/*`, `template-shell`, and `template-shell/packages/*` declares an exact version, never a range.
- **21-day eligibility** — a version may only be pinned once it has been published for at least 21 days, so a just-released version is never pulled in before it has been vetted.
- **One exception** — the `@gears-frontx/mfes` → `@gears-frontx/gts-plugin` edge stays a semver range, per the ecosystem-distribution rule, to avoid forcing two copies of the MFE runtime into one tree.

## Publishing

Publishing is automated via CI/CD. On push to a publishing branch, CI detects version changes and publishes affected packages.

### Branch-to-Channel Mapping

| Branch | Dist-tag | Trigger |
|--------|----------|---------|
| `develop` | `alpha` | Every merge |
| `release/X.Y.Z` | `next` | RC prep merges |
| `main` | `latest` | Release merges |
| `release/vN` | `vN` | Maintenance patches |

### Publish Order

Packages are published in dependency order:
1. L1 SDK: `@gears-frontx/state`, `@gears-frontx/mfes`, `@gears-frontx/api`, `@gears-frontx/i18n`, `@gears-frontx/gts-plugin`
2. L2 Framework: `@gears-frontx/framework`
3. L3 React: `@gears-frontx/react`
4. Standalone: `@gears-frontx/studio`, `@gears-frontx/cli`

Each package is versioned independently within a single major version.

## Package Scope

- npm scope: `@gears-frontx/*`
- CLI binary: `frontx`
- Config file: `frontx.config.json`

## Development Setup

```bash
git clone https://github.com/constructorfabric/gears-frontx.git
cd gears-frontx
npm ci
npm run build:packages
npm run dev
```

## Building

```bash
# Build all packages in layer order
npm run build:packages

# Build specific layer
npm run build:packages:sdk
npm run build:packages:framework
npm run build:packages:react
npm run build:packages:studio
npm run build:packages:cli
```

## Template Development Loop

[`template-shell/`](template-shell) is not a root workspace: it is a standalone npm project that pins `@gears-frontx/api`, `@gears-frontx/mfes` and `@gears-frontx/gts-plugin` to exact registry versions, so that a seeded project installs outside the monorepo. Those pins mean a plain `npm install` inside the template resolves the **published** alpha, not the sources you are editing.

After changing anything under `packages/api`, `packages/mfes` or `packages/gts-plugin`, relink before running the template:

```bash
npm run build:packages       # publish-shaped dist/ for the ecosystem packages
npm run dev:template:link    # point the template's node_modules at the packages/* builds
cd template-shell && npm run dev
```

`dev:template:link` ([`scripts/link-template-ecosystem.mjs`](scripts/link-template-ecosystem.mjs)) only repoints the directories inside the template's `node_modules` that the template pins to the registry - it reads the template's own manifests to find out which those are, so a newly pinned package is linked without anyone editing the script. It never writes `package.json` or `package-lock.json`, so nothing from the dev loop can leak into a seeded project. What each linked directory then resolves through is its `dist/`, which is why the script refuses to link an unbuilt package instead of leaving the failure to surface later as a missing module.

> **Forgetting to relink is silent.** The template builds, type-checks and tests green against the published pins on its own, so a missing relink produces no error anywhere - it just means the `packages/*` edits you are testing are not the code being run. Nothing warns you. Relink after every ecosystem change, and when a template-side result contradicts a change you just made in `packages/*`, suspect the link first.

The silence is local only: the [Template Drift workflow](.github/workflows/template-drift.yml) runs this same relink-and-check sequence in CI for the in-repo inputs it watches, so a working tree that has drifted from `template-shell` goes red there even when every local check passes ([#518](https://github.com/constructorfabric/gears-frontx/issues/518)).

A feature branch's pins routinely name a version that has not been published yet: `policy:version-bump-on-change` requires the bump the moment a package's `src/` changes substantively, while [publish-packages.yml](.github/workflows/publish-packages.yml) only publishes from `main`/`develop`/`release/*`. A plain `npm ci` inside `template-shell` on such a branch therefore fails with `ETARGET` - a lockfile cannot resolve a tarball that does not exist yet - and the relink step above, which repoints those pins at the working tree, must run before any template command that touches `node_modules`.

To go back to the pinned registry versions, run `npm ci` inside `template-shell`. There is no `--unlink`: the links replace published tarball *content*, which only npm can restore.

Two ways to lose the links without meaning to:

- **any `npm install` inside `template-shell`** — say, while adding a dependency — reifies the tree from the lockfile and silently puts the registry tarballs back. Relink afterwards.
- **`npm run clean:artifacts`** at the repo root removes `packages/*/dist`, so the links survive but point at nothing. `npm run build:packages` restores them; the link script refuses to run at all if the build is missing.

The dev loop uses symlinks on macOS and Linux and directory junctions on Windows, so no elevated shell or Developer Mode is required on any platform. If a link cannot be created anyway, the run moves each installed directory aside rather than deleting it, so it rolls the tree back to the pinned versions and names what it could not restore. Read that last part: a failed link usually costs only a re-run, but if the rollback itself could not put a directory back, the message says so and names it - and that case does need `npm ci` inside `template-shell`, exactly as the message instructs.

### Why template drift CI installs without a lockfile

The [Template Drift workflow](.github/workflows/template-drift.yml) points the template's `@gears-frontx` pins at the working tree's `packages/*` builds, then installs with `npm install --no-package-lock` instead of `npm ci`. Both departures from the ordinary install exist for reasons that are easy to re-break without this record.

**Why not `npm ci` against the rewritten manifests.** Rewriting the pins ahead of install desyncs `template-shell/package-lock.json` from `template-shell/package.json` by construction, and `npm ci` refuses to run against a desynced lockfile. `npm install` reconciles it instead - which is exactly the operation that trips `--no-package-lock`'s reason below.

**Why `--no-package-lock` is load-bearing.** `template-shell` pins its own root package to itself via a `file:.` override, materialized as an npm-managed symlink that `packages/framework`'s re-exports resolve through. Reconciling a desynced lockfile is exactly the operation npm `<= 11.13.0` gets wrong for a self-referential `file:.` entry (npm/cli#524, already referenced by `scripts/template-lockfile-selflink-check.mjs`): it drops the link from the *installed tree*, not just from the lockfile, so `packages/framework`'s import of its own template root resolves to nothing and the build fails. GitHub's `ubuntu-latest` runner's Node 25.x ships npm 11.12.1, squarely in the broken range; the upstream fix lands in 11.14.0. Skipping lockfile reconciliation with `--no-package-lock` sidesteps the bug entirely regardless of which npm version the runner carries, so the flag stays correct even after the runner's npm moves past 11.14.0 - there is nothing to remember to remove later.

**The tradeoff this accepts.** Without the lockfile guiding resolution, transitive dependencies float to their latest in-range version instead of the exact one the lockfile pinned - verified on a test run at 41 of 546 packages resolving differently, all patch-level bumps within their declared ranges. That is acceptable for this job specifically, since its purpose is detecting drift between `packages/*` and `template-shell`, not verifying that the exact pinned dependency tree installs cleanly; the latter is Template Validate's job ([main.yml](.github/workflows/main.yml)), which runs an unmodified `npm ci` and is unaffected by this workflow's substitutions.

## Validation

```bash
# Repo-wide type checking (host app + workspace packages + nested MFEs)
npm run type-check:all

# Host app only (`tsconfig.json`; nested MFEs and package test tsconfigs run separately)
npm run type-check

# Linting
npm run lint

# Architecture checks
npm run arch:check
npm run arch:deps
```

### Unit tests

Run the full suite from the repo root with the monorepo fan-out runner ([`scripts/run-monorepo-unit-tests.mjs`](scripts/run-monorepo-unit-tests.mjs)):

```bash
npm run test:unit
npm run test:unit:watch
```

Every workspace that defines `test:unit`, plus the repo-root `scripts/` toolchain as the `repo-scripts` project, is exercised by that command. To narrow a run, pass the project name or a path to the runner: `npm run test:unit -- --project=cli`, or `npm run test:unit -- packages/cli/src/__tests__/resolver.test.ts` for a single file.

`scripts/` is not an npm workspace, so the runner cannot discover it from `package.json#workspaces` the way it finds everything else; it is registered explicitly in [`scripts/test-runner/discovery.mjs`](scripts/test-runner/discovery.mjs) and tested through [`vitest.scripts.config.mjs`](vitest.scripts.config.mjs). A new test file under `scripts/` needs no wiring, but a new *root-level* directory of tests does.

**Internal scripts (do not call directly):** Root [`package.json`](package.json) defines `_test:unit:host` and `_test:unit:host:watch` for the `repo-scripts` project; they exist so the monorepo runner can invoke Vitest where there is no workspace package. Agents and CI should use `npm run test:unit` / `test:unit:watch` instead.

## License

Apache-2.0
