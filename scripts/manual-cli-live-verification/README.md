# Manual CLI Live Verification (fresh project)

Verifies the `frontx` CLI end to end against a **real project it creates itself**, on a real
filesystem, over a real network. The unit suites cover the logic; this covers what they cannot —
that the shipped binary, the resolver, the network adapter, and the on-disk result agree.

Every defect this procedure has caught was invisible to the unit suites. Three examples, all real:
a template's `node_modules` being read as payload (428 MB, `JSON.stringify` threw); origin pinning
never firing because GitHub's tarball root carries an abbreviated SHA while the unit fixture used a
synthetic 40-hex one; `install --json` writing nothing to stdout. None of these can fail in a test
that injects its own fetch.

## Two rules that decide whether the run is worth anything

**Drive the CLI, never the filesystem.** Do not `cp`/`rsync` a template into the project to "set it
up". Copying skips exactly the code under test and hides whole classes of defect — it once hid that
`seed`'s official defaults are project-relative `path:` origins usable only inside this monorepo,
and that pinning was not happening at all.

**Verify against the disk, not against the CLI's own report.** After every mutating command, look at
the files. A command that reports success while writing the wrong thing is the defect worth finding.

## Preconditions

```bash
npm run build --workspace=@gears-frontx/cli
```

`dist/cli.js` is what you invoke; a stale `dist` silently verifies the previous commit. Then work
outside the repo, so the monorepo's own `node_modules`, workspaces and template folders cannot stand
in for something the CLI was supposed to produce:

```bash
mkdir -p /tmp/frontx-live/fresh && cd /tmp/frontx-live/fresh
CLI=/absolute/path/to/gears-frontx/packages/cli/dist/cli.js
```

A note on `--json`: redirect it to a file before parsing. A plan or delete listing can run well past
one pipe buffer, and a file is easier to inspect byte-for-byte with `jq`/`cat` than a terminal — the
CLI itself waits for the full write to complete before exiting, so a full-reading pipe or redirect
always receives the complete payload regardless of size.

```bash
node "$CLI" delete . --dry-run --json > /tmp/plan.json
```

## 1. Register, and check the origin was pinned

```bash
node "$CLI" register "github:<owner>/<repo>//<subtree>@<branch>" --json
```

Then read `.frontx/project.json` and confirm the recorded `origin` is **not** the movable ref you
passed but the commit the fetch settled on. This step is the whole reason to use a branch name here
rather than a tag or SHA: passing an immutable ref cannot show whether pinning happens.

## 2. Apply, and check the boundary

```bash
node "$CLI" apply --input '{"templates":{"<registered-name>":["."]}}' --json
```

`--input` takes **inline** JSON, not a path. Then verify on disk:

- the payload file count is plausible for the template, not inflated by install output;
- every subtree the manifest excludes is absent;
- nothing landed outside the target.

## 3. Validate the project state

```bash
node "$CLI" validate --project --json
```

## 4. Prove the applied project actually runs

```bash
npm install && npm run build && npm run type-check && npm test
```

Skipping this reduces the run to "files were copied". A project that does not build was not applied
correctly, whatever the CLI reported.

## 5. Prepare a v2 the upgrade can be checked against

Snapshot the project into a folder inside itself, then make one change of each kind, so the plan has
something to be right or wrong about:

```bash
rsync -a --exclude node_modules --exclude dist --exclude .frontx --exclude template-v2 ./ ./template-v2/
```

In `template-v2/`: bump `version`; edit one file (**REPLACE**); add one file (**ADD**); delete one
file (**REMOVE**). Then, in the project itself, append a line to a file the template owns — that is
the **KEEP_LOCAL** case, and the one that matters most: an upgrade that silently discards a
developer's edit is the worst failure this tool can have.

Snapshotting *after* `npm install`/`npm run build` means generated files (`package-lock.json`, build
output) are captured in the v2 payload and will legitimately appear in the plan. That is template
hygiene, not a CLI defect — but know which it is before reporting it.

## 6. Upgrade: inspect the plan, then approve

```bash
node "$CLI" upgrade "<registered-name>" path:template-v2 --json > /tmp/plan.json
node "$CLI" upgrade "<registered-name>" path:template-v2 --json --yes
```

The first call must return `CONFIRMATION_REQUIRED` and write nothing. Check the plan carries exactly
the four operation kinds you staged, that `from` shows the **pinned** origin (this is where pinning
proves it reaches the upgrade baseline), and that the plan contains no file **contents** — only paths
and actions.

Then verify on disk: the REPLACE landed, the ADD appeared, the REMOVE is gone, **your edit survived**,
`previous` records the origin the name moved away from, and the project still builds.

## 7. Restore, twice

```bash
node "$CLI" upgrade "<registered-name>" --restore --json --yes
node "$CLI" upgrade "<registered-name>" --restore --json --yes
```

The second call must toggle back rather than refuse: reversal is one generation, and `previous`
rotates. A `path:` origin whose folder no longer exists cannot be restored from — worth knowing before
you delete anything.

## 8. Delete: refusal, plan, then execute

```bash
node "$CLI" delete . --json            # must refuse: CONFIRMATION_REQUIRED, nothing touched
node "$CLI" delete . --dry-run --json > /tmp/plan.json
node "$CLI" delete . --json --yes
```

Count entries before and after the refusing call to confirm it wrote nothing. In the plan, check
`toPreserve` holds the reserved environment entries and the excluded subtrees, and that nothing
outside the target's own ownership is listed for deletion. After executing, confirm the registration
survives with an empty `targets` array — deleting an application is not unregistering a name.

## 9. Composition, as a separate step

Apply a second template into ground the first one excludes, then `npm install && npm run build`
again. Composition failing at the npm-graph level while every CLI-level check passes is a **template**
defect, not a CLI one; separate them by deleting the second target and rebuilding — if the build
recovers, the second template is the cause.

## Expected redness

- `npm run validate:templates` fails on `template-mfe` with 9 `overrides` violations: its overrides
  are project-relative and meaningful only inside this monorepo. Known template defect.
- `apply` copies the template's own `frontx-template.json` into the target. Known defect.
- `delete` removes files but does not prune the directories they leave empty.

## Cleanup

```bash
rm -rf /tmp/frontx-live
```

The run mutates only that tree and the CLI's own inventory. It never touches the repository — if
`git status` in the monorepo is not clean afterwards, something wrote where it should not have, and
that is itself a finding.
