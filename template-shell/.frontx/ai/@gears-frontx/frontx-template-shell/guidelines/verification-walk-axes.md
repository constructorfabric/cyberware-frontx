# Guideline: The Verification Axes This Shell Declares

The kit's verification walk is shaped by two caller-declared axes and assumes
neither: a **checkpoint axis** naming the points the walk visits and how each one
is reached, and a **variant axis** naming one UI dimension the coverage is
repeated across. The kit's driver knows nothing about what either stands for.
**In a project built on this shell, the points are the registered screen
extensions and the variant axis is the theme registry**, and this file is what a
run reads to fill the driver's flags in. It is a code-verified snapshot: if the
files named below change, this file must be updated to match.

Authoritative files:

- `src-app/mfe_packages/*/mfe.json` - each screen extension's `presentation`,
  where its `route` and `label` are declared
- `src-app/app/layout/Menu.tsx` - `menuItemTestId`, the handle each menu item carries
- `src-app/app/main.tsx` - where the themes are registered and the default applied
- `src-app/app/themes/` - one module per theme, each exporting its id and `name`
- `packages/studio/src/testIds.ts` - the overlay's verification handles
- `packages/studio/src/sections/ThemeSelector.tsx` - the switcher the walk drives

## The checkpoint axis: this shell's screens

This shell mounts one screen extension at a time into the screen domain it
declares, each addressable at its own path, and its menu is the chrome that moves
between them. That is what makes the kit's checkpoint axis expressible here at
all - it is a property of this shell, not of FrontX. **A host that mounts several
extensions into one domain concurrently has no one active point to walk to**, and
`src-app/mfe_packages/widgets-fixture-a/mfe.json` in template-mfe is exactly such
a case: its two widget extensions share `frontx.widgets.area.main.v1` and are
mounted together. A run against a surface like that declares no checkpoint axis
and lets the walk cover whatever `--host` opens.

**The set comes from the manifests, not from the menu.** Read each realized
screen extension's `presentation.route` out of the `mfe.json` that declares it.
That `route` is **this template's own field**, shaped by template-mfe's manifest
conventions and consumed by this shell's screen domain - it is not an
ecosystem-guaranteed key, and `@gears-frontx/mfes` declares no extension-domain
values at all. The menu enumerates what the menu chose to offer, which is a
different question, and a set taken from it is a set nothing confirmed.

demo-mfe's shipped extensions declare, for example:

| Checkpoint name | `presentation.route` | Extension id (the `{handle}` value) |
|---|---|---|
| `helloworld` | `/hello-world` | `gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.helloworld.v1` |
| `profile` | `/profile` | `...~frontx.demo.screens.profile.v1` |
| `uikit` | `/uikit-elements` | `...~frontx.demo.screens.uikit.v1` |

**The reaching control is keyed by the whole extension id.** `menuItemTestId`
builds each item's handle as `menu-item-<extension id>`, and a short name cannot
spell one, so this shell's invocation uses `{handle}` rather than
`{checkpoint}`:

| Driver flag | Value | Declared as |
|---|---|---|
| `--checkpoint-selector` | `menu-item-{handle}` | `menuItemTestId(extensionId)` |

Left as the fourth `--checkpoints` field, the extension id costs no page read.
Omitted, the driver reads the page's ids back and keeps the menu item whose id
carries the checkpoint's short name as a whole segment - which is unambiguous
here as long as no two realized screens share a name segment.

Declaring `--checkpoint-selector` is what makes the walk click its way between
the screens. **Leave it out to have each screen loaded at its route instead** -
useful when the run wants every point reached by a full load rather than through
the menu.

## The overlay: this shell's Studio panel

The Studio overlay is host chrome drawn over the screens under verification, and
it also holds the theme switcher, so the walk opens it to reach the switcher and
closes it before capturing. `packages/studio/src/testIds.ts` is a verification API
rather than a styling hook, and its values are what the driver is given:

| Driver flag | Value | Declared as |
|---|---|---|
| `--overlay-open` | `studio-expand` | `STUDIO_EXPAND_TESTID` |
| `--overlay-close` | `studio-collapse` | `STUDIO_COLLAPSE_TESTID` |

The two ids are deliberately different rather than one id on whichever control is
mounted, which is what lets the driver confirm the close: `studio-expand` is in
the document only while the panel is collapsed.

**A project that removed the Studio overlay declares neither flag**, and the
walk then operates no such control. The kit's checklist reports its host-chrome
category as not applicable in that case, naming this declaration as the reason.

## The variant axis: this shell's theme registry

`main.tsx` registers the shell's themes one call at a time and then applies the
default:

```ts
app.themeRegistry.register(defaultTheme);
app.themeRegistry.register(lightTheme);
app.themeRegistry.register(darkTheme);
app.themeRegistry.register(draculaTheme);
app.themeRegistry.register(draculaLargeTheme);
app.themeRegistry.apply(DEFAULT_THEME_ID);
```

Those five calls are the set: ids `default`, `light`, `dark`, `dracula` and
`dracula-large`, each declared beside its `name` in its own module under
`src-app/app/themes/`. Read the set from there. The switcher's dropdown
enumerates what the switcher chose to offer, which is a different question, and a
set taken from it is a set nothing confirmed.

A project that added or removed a theme changed this list, and the count of
registered ids is the count the walk covers.

| Driver flag | Value | Declared as |
|---|---|---|
| `--variant-switcher` | `studio-theme-trigger` | `STUDIO_THEME_TRIGGER_TESTID` |
| `--variant-option` | `studio-theme-option-{variant}` | `studioThemeOptionTestId(themeId)` |

The option id is keyed on the theme's **registry id**, not its display name, so
`{variant}` substitutes the same strings the registration above lists and no
label map is needed to reach an option.

The trigger's own text is the active theme's `name` with each hyphen-separated
word capitalised - `dracula-large` reads back as `Dracula Large`. `ThemeSelector`
resolves that text through the registry list on purpose, so the trigger reads
back the same label the option carried and the driver's whole-word confirmation
has something to agree with.

## `dracula` and `dracula-large` are walked in two invocations

The driver confirms a value from the switcher label by requiring the value's name
to occupy a whole run of the label's words. `Dracula Large` satisfies that test
for `dracula` as well as for `dracula-large`, so a label reading `Dracula Large`
cannot say which of the two is applied. The driver refuses the pair on the
arguments, before a browser is reached:

```
variants "dracula" and "dracula-large" cannot be told apart from a switcher
label: a label reading "dracula-large" names "dracula" as well
```

`--variant-labels` does not resolve it here, because the labels the trigger
actually prints stand in the same relation to each other. **Walk the two in
separate invocations instead**, each with a capture directory of its own and both
appending to the same coverage file:

```bash
DRIVER=<installed kit root>/skills/project-scaffolding/scripts/verify-walk.mjs

node "$DRIVER" \
  --host <dev server origin> \
  --browser-cmd 'npx --yes agent-browser@<the version this run pinned>' \
  --capdir "$CAPDIR/pass-1" \
  --checkpoints '<name>:<presentation.route>:<that screen's ready testid>:<its extension id>,...' \
  --checkpoint-selector 'menu-item-{handle}' \
  --variants default,light,dark,dracula \
  --variant-switcher studio-theme-trigger \
  --variant-option 'studio-theme-option-{variant}' \
  --overlay-open studio-expand \
  --overlay-close studio-collapse \
  --coverage <targetDir>/.frontx/verification-coverage.md

node "$DRIVER" \
  --host <dev server origin> \
  --browser-cmd 'npx --yes agent-browser@<the version this run pinned>' \
  --capdir "$CAPDIR/pass-2" \
  --checkpoints '<name>:<presentation.route>:<that screen's ready testid>:<its extension id>,...' \
  --checkpoint-selector 'menu-item-{handle}' \
  --variants dracula-large \
  --variant-switcher studio-theme-trigger \
  --variant-option 'studio-theme-option-{variant}' \
  --overlay-open studio-expand \
  --overlay-close studio-collapse \
  --coverage <targetDir>/.frontx/verification-coverage.md
```

Both invocations pin the browser CLI with the same `--browser-cmd`. Left out, the
driver falls back to `npx --yes agent-browser`, which resolves whatever version
is newest at the moment each run asks - so the two passes above, which exist to
be compared against each other, could be driven by two different browsers.

The two runs land their rows in one coverage file under one header - one row per
theme per screen. **The second run's rows read `first variant` in the
distinctness cell**, because `dracula-large` has no predecessor inside its own
invocation - which is true of that run and is not a claim that the theme was
never compared. Say so in the report, and compare that pair's captures across the
two capture directories by hand if the comparison is wanted: the two runs are
separate walks, and the driver compares only within one.

Splitting the walk this way is a property of these two theme names, not of the
shell. A project whose registered ids are all distinguishable by label walks them
in one invocation.
