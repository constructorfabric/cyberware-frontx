# Microfrontends — `frontx-template-mfe` territory

> **TARGET AUDIENCE:** Project developers adding or maintaining an MFE package
> **PURPOSE:** What lives under this directory and how to add a new package to it

Everything under `src-app/mfe_packages/` belongs to the `frontx-template-mfe`
template — the shell scans this directory but never names a package inside it
(see the shell's `mfe-package-contract` AI guideline for the exact contract a
package here must satisfy).

## Precondition: requires an applied `template-shell`

This directory is **add-only**. It ships with `frontx-template-mfe`, which has
no root `package.json`, no build/test/lint tooling, and no host application —
those are owned by `frontx-template-shell`. A package here declares exact
published versions of its FrontX dependencies (`@gears-frontx/react`,
`@gears-frontx/framework`, `@gears-frontx/frontx-template-shell` itself, …)
alongside its ordinary third-party ones, and installs them all from the
registry — there are no `file:` paths to dangle.
What an applied shell actually supplies is the **runtime host**: the
`src-app/app/` shell that mounts these MFEs, and — at build/dev time — the
`frontxMfGts` plugin loaded from `@gears-frontx/frontx-template-shell/build/mf-gts`.
Without an applied shell there is no host to mount into and no plugin to load,
even though `npm install` alone would succeed.

`seed` bootstraps a project from the CLI's built-in official defaults, which
only resolve inside this monorepo checkout. Anywhere else, `register` a
remote origin for each template and `apply` it — the path that works in a
fresh external folder too:

```bash
mkdir my-app && cd my-app
frontx register <shell-origin>
frontx apply --input '{"templates":{"@gears-frontx/frontx-template-shell":["."]}}'
frontx register <mfe-origin>
frontx apply --input '{"templates":{"@gears-frontx/frontx-template-mfe":["src-app/mfe_packages"]}}'
npm install   # required after applying a new template — the workspace glob
              # picks up the new packages, so the lock must be regenerated
```

**Upgrading a multi-template repository is supported.** `frontx upgrade`
operates on one registered template name across every target it has been
applied to, so `@gears-frontx/frontx-template-shell` and `@gears-frontx/frontx-template-mfe` upgrade
independently by name once both are applied to the same repo — there is no
restriction on upgrading after a second template has been added.

## Add your own MFE

Copy the blank scaffold and adjust it — there is no registry file to edit;
`generate:mfe-manifests` / `dev:all` (shell scripts) discover packages by
scanning this directory. Drop the scaffold's example flag in the same step,
since a copy that keeps the flag is invisible to the shell and nothing fails to
tell you so:

```bash
NEW=src-app/mfe_packages/my-mfe
cp -r src-app/mfe_packages/_blank-mfe "$NEW"
node -e 'const f=process.argv[1],fs=require("fs"),m=JSON.parse(fs.readFileSync(f,"utf8"));delete m.templateExample;fs.writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$NEW/mfe.json"
```

Then, inside `my-mfe/`:

1. **`package.json`** — rename it (`name`, and the `dev`/`preview` scripts'
   `vite preview --port <N>` to a port no other package here already uses).
2. **`mfe.json`** — declare your entries and extensions (screen, sidebar, popup,
   or overlay) with GTS IDs following this template's ID conventions guideline.
3. **`vite.config.ts`** — keep the `frontxMfGts` build plugin wired, and add
   your lifecycle modules to the Module Federation `exposes` map so the shell
   can load them at runtime.

Existing packages here for reference: `demo-mfe` (`:3001`, a full worked
example — Hello World, Profile, Theme, UIKit, Widgets Host), `_blank-mfe`
(`:3099`, the copy-from scaffold), and `widgets-fixture-a` / `widgets-fixture-b`
(`:3201` / `:3202`, widgets mounting into `demo-mfe`'s widgets domain).

## Reference packages do not run in your application

**This section is the package-level reference for this rule** - it ships next to
the packages it governs, and the human-facing surfaces (both template READMEs and
QUICK_START) point here rather than restating it.

Three agent-facing surfaces carry their own copy, because each is read on its own
with nothing else loaded, so a pointer in one of them would be a dead end:
[the `add-mfe-package` skill](../../.frontx/ai/@gears-frontx/frontx-template-mfe/skills/add-mfe-package/SKILL.md),
[its workflow](../../.frontx/ai/@gears-frontx/frontx-template-mfe/workflows/add-mfe-package-workflow.md),
and the shell's own
`.frontx/ai/@gears-frontx/frontx-template-shell/guidelines/mfe-package-contract.md`
(under `template-shell/` in the template monorepo), which is the snapshot of what
the scanners check. A change to the behaviour has to reach all of them.

Every package listed above declares `"templateExample": true` in its `mfe.json`.
They ship to be read and copied, so the shell's three package scanners leave
them out: `generate:mfe-manifests` keeps them out of the aggregate the host
registers from, `dev:all` neither builds nor serves them, and `type-check:mfe`
skips them too. Your application's menu holds the screens you added and
nothing else.

To run them anyway - to watch a worked example rather than read it - set
`FRONTX_INCLUDE_TEMPLATE_EXAMPLES` to `1` for the command:

```bash
FRONTX_INCLUDE_TEMPLATE_EXAMPLES=1 npm run dev:all
```

That flag is why the copy command above strips it, and a copy that keeps
it still installs and still runs its own tests, because it is the thing new
packages are copied from and has to stay usable. Type-checking is the
exception: `type-check:mfe` skips a flagged package by default, the same as
the other two scanners, so it type-checks only when the run sets
`FRONTX_INCLUDE_TEMPLATE_EXAMPLES=1`. What reports the skip is a single line in
the `generate:mfe-manifests` / `dev:all` / `type-check:mfe` output naming the
packages left out. Inside the running application there is no sign of it at
all - the screen is simply not in the menu.
