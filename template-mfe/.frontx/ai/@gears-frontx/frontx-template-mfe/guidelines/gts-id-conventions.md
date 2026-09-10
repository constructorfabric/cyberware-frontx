# Guideline: GTS ID Conventions (template-mfe)

template-mfe's MFE packages (`src-app/mfe_packages/*/mfe.json`) identify every
manifest, entry, extension, domain, action, and shared property with a GTS
(`@gears-frontx/gts-plugin`) type-system ID. The ecosystem's GTS type substrate is
namespace-agnostic (base-kit fluency); this guideline documents the concrete
namespace and naming pattern **template-mfe** actually uses across its own MFE
packages (`demo-mfe`, `_blank-mfe`, `widgets-fixture-a`, `widgets-fixture-b`), so
new MFEs added to a project built from template-mfe stay consistent with the
existing ones.

## General shape

```text
gts.frontx.<subsystem>.<kind>.v1~<namespace-path>.v1[~]
```

- `gts.frontx.<subsystem>.<kind>.v1` - the fixed type-definition segment (owned by
  `@gears-frontx/gts-plugin` / `@gears-frontx/mfes`; never invented per-MFE).
- `~<namespace-path>.v1` - the solution-specific instance segment template-mfe's
  MFE packages append; this is the part a new MFE package must author.
- A trailing `~` on action/shared-property IDs marks an open (parameterizable)
  instance reference, matching the existing entries verbatim - keep it when
  following the pattern for a new action.

### Every instance segment spends exactly five dot-separated tokens

The instance segment is the same shape for every ID kind below - manifest,
entry, extension, domain and action alike:

```text
vendor.package.namespace.type.vN
```

`frontx.demo.screens.profile.v1` is `frontx` (vendor), `demo` (package),
`screens` (namespace), `profile` (type), `v1`. The namespace token is the
family's, not a fixed word: `mfe` for demo-mfe's and _blank-mfe's manifests and
entries, the fixture's own name for the widget fixtures
(`frontx.widgets.fixture_a.manifest.v1`), `screens` for a screen extension,
`area` for a widget domain, and `action` or `test` for the two shipped custom
actions.

**What a short instance segment actually costs.** Not resolution: the runtime
registers an extension under its ID verbatim, looks it up by domain and entry,
and the only ID-shape gate anywhere is a prefix match on the type segment, which
a segment of any length passes. What breaks is package attribution.
`extractGtsPackage` (`@gears-frontx/mfes`) takes the first two dot-tokens of the
instance segment as the package ID, so a segment that opens with something other
than vendor + package is filed under a wrong key in `DefaultMfeRegistry.packages`
- collapse the pair into one token and `demo.screens.home.v1` files under
`demo.screens` instead of `frontx.demo`. A segment ending in `~`, or one holding
fewer than two dot-tokens, makes that function throw, and the registry catches
the throw and skips package tracking for that extension altogether. Every pattern
below therefore spells the vendor and the package as two separate placeholders,
and every one of them expands to exactly the five tokens of the real example
beside it.

### The instance segment is the last non-empty `~`-separated segment

Non-empty matters: an ID that ends in `~` - a custom action, a fixed shared
property, a fixed lifecycle action - has an empty last element, and
`extractGtsPackage` implements the rule literally and throws on exactly that
shape rather than stepping back a segment. The instance segment of
`...comm.action.v1~frontx.demo.action.refresh_profile.v1~` is
`frontx.demo.action.refresh_profile.v1`, and the trailing `~` is the open-reference
marker, not a segment.

Its position varies by family: a manifest, a custom action, a widget domain and
a widget-area extension carry one fixed segment before it, while an MF entry
and a screen extension carry two - so a screen extension's instance segment,
the one the five-token rule governs, is its **third**. The middle segment there
is the host's domain id rather than the ecosystem's, which is why it is fixed for
this template and not fixed for the ecosystem:

```text
gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.blank.screens.home.v1
```

- `gts.frontx.mfes.ext.extension.v1` - fixed type-definition segment, owned by
  `@gears-frontx/mfes`.
- `frontx.screensets.layout.screen.v1` - the screen domain, copied verbatim. **It
  is the host template's, not the ecosystem's**: `@gears-frontx/mfes` defines no
  specific extension-domain values (MFES-2, MFES-3) and registers no such domain,
  and this id is declared by template-shell, in
  `packages/framework/src/plugins/microfrontends/gts/frontx.screensets/instances/domains/screen.v1.json`.
  An MFE built for a host that declares a different screen domain copies that
  host's id here instead. Either way the five tokens are the host's to author and
  never this MFE's.
- `frontx.blank.screens.home.v1` - the instance segment this MFE authors:
  `frontx` + `blank` + `screens` + `home` + `v1`.

## Observed ID families in template-mfe

| Family | Fixed prefix | template-mfe's instance pattern | Real example |
|---|---|---|---|
| MF manifest | `gts.frontx.mfes.mfe.mf_manifest.v1~` | `{vendor}.{package}.{namespace}.manifest.v1` | `frontx.demo.mfe.manifest.v1` |
| MF entry | `gts.frontx.mfes.mfe.entry.v1~frontx.mfes.mfe.entry_mf.v1~` | `{vendor}.{package}.{namespace}.{entry}.v1` | `frontx.demo.mfe.profile.v1` |
| Screen extension | `gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~` | `{vendor}.{package}.screens.{screen}.v1` | `frontx.demo.screens.profile.v1` |
| Widget-area extension (non-screen domain) | `gts.frontx.mfes.ext.extension.v1~` | `{vendor}.{package}.{fixture}.{widget}.v1` | `frontx.widgets.fixture_a.widget_alpha.v1` |
| Custom action | `gts.frontx.mfes.comm.action.v1~` | `{vendor}.{package}.{namespace}.{name}.v1~` | `frontx.demo.action.refresh_profile.v1~` |
| Widget domain | `gts.frontx.mfes.ext.domain.v1~` | `{vendor}.{package}.area.{area}.v1` | `frontx.widgets.area.main.v1` |

Read each pattern against the example beside it and the tokens line up one for
one: `frontx` is `{vendor}` and `demo` is `{package}` throughout, `mfe` is the
`{namespace}` the manifest and entry families use here (the widget fixtures use
their own name there - `frontx.widgets.fixture_a.manifest.v1`), and no pattern
carries a token the example does not. **There is no literal `mfe` token in the
widget fixtures' IDs**, so nothing in the manifest or entry families holds the
count at five on its own: only spelling the vendor and the package separately
does. `{namespace}` where a pattern carries it is that family's third token and
the shipped IDs disagree on it: `mfe` in demo-mfe and _blank-mfe, the fixture
name in the widget fixtures, `action` for demo-mfe's custom action and `test` for
the widget fixture's (`frontx.widgets.test.widget_ping.v1~`). Where a pattern
spells the token out - `screens` for a screen extension, `area` for a widget
domain - every listed example carries it verbatim, and a new ID follows suit;
demo-mfe's widgets-host screen (`frontx.widgets.host.screen.v1`) is the one
shipped screen extension that names its namespace after its own subject instead,
and it spends the same five tokens.

A Project Developer forking template-mfe for a real solution replaces both with
their solution's own (`{vendor}.{package}` becomes `acme.crm`, say), never
keeping `frontx` as the vendor, and never collapsing the pair into a single
token.

## Fixed (do-not-invent) IDs

These are referenced verbatim, never redefined, by every MFE package in
template-mfe. **They do not all come from the same owner**, and the difference
matters when this template is applied to a different host:

- `gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1` - the shared
  screen domain every screen-contributing MFE extension targets. **Declared by
  the host template (template-shell), not by `@gears-frontx/mfes`**, which owns
  no extension-domain values at all. An MFE built against another host copies
  that host's screen domain id instead of this one.
- `gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.load_ext.v1~`,
  `...mount_ext.v1~`, `...unmount_ext.v1~` - the ecosystem's built-in extension
  lifecycle actions.
- `gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.theme.v1~` and
  `...language.v1~` - the two shared properties every screen entry's
  `requiredProperties` declares.
- `gts.frontx.mfes.lifecycle.stage.v1~frontx.mfes.lifecycle.{init,activated,deactivated,destroyed}.v1`
  - the fixed lifecycle stage set a domain declaration enumerates.

## Rule for new MFE packages in template-mfe

1. Never redefine a fixed-family ID (subsystem/kind segment) - only append a new
   instance segment under the existing namespace root.
2. Count the instance segment's tokens before writing it: five, every kind, no
   exceptions - including the screen extension ID, whose instance segment is
   its third `~`-separated segment.
3. Keep the instance segment's leaf name (`{screen}`, `{name}`, `{widget}`)
   snake_case, matching every existing example above.
4. An entry's `manifest` field must reference that same package's own manifest ID
   - never another package's.
5. Every extension targets a **template-defined** domain ID, screen and non-screen
   alike - the ecosystem defines none. Against template-shell a screen-domain
   extension targets
   `gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1`, and a
   widget-area extension targets one this template declares itself; against
   another host, both come from that host.
