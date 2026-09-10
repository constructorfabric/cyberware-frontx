# Blank MFE Template

This is a template for creating new FrontX Microfrontend packages. It provides a complete, working MFE structure with:

- Shadow DOM isolation
- Bridge communication with the host
- Theme and language property subscriptions
- MFE-local i18n with 36 language files
- Components from `@gears-frontx/ui-kit`, styled from its design tokens
- TypeScript strict mode
- Module Federation setup

## How to Use This Template

### 1. Copy the Template

Copy the entire `_blank-mfe` directory to a new name:

```bash
cp -r src/mfe_packages/_blank-mfe src/mfe_packages/your-mfe-name
```

### 2. Update Package Metadata

Edit `package.json`:
- Change `"name"` from `"@gears-frontx/blank-mfe"` to `"@gears-frontx/your-mfe-name"`
- Change the port in the `"dev"` and `"preview"` scripts (e.g., from `3099` to your chosen port)

Edit `vite.config.ts`:
- Change `name` in the federation config from `"blankMfe"` to `"yourMfeName"` (camelCase)
- Update the port in the dev server config if needed

### 3. Update GTS IDs in mfe.json

Replace all placeholder IDs with your actual GTS IDs. The placeholders are marked with `[YOUR_ORG]`, `[YOUR_APP]`, `[YOUR_MFE_NAME]`, and `[YOUR_SCREEN_NAME]`.

**Manifest ID Pattern:**
```
gts.frontx.mfes.mfe.mf_manifest.v1~[YOUR_ORG].[YOUR_APP].mfe.[YOUR_MFE_NAME].manifest.v1
```

Example:
```
gts.frontx.mfes.mfe.mf_manifest.v1~acme.crm.mfe.customer.manifest.v1
```

**Entry ID Pattern:**
```
gts.frontx.mfes.mfe.entry.v1~frontx.mfes.mfe.entry_mf.v1~[YOUR_ORG].[YOUR_APP].mfe.[YOUR_MFE_NAME].[YOUR_SCREEN_NAME].v1
```

Example:
```
gts.frontx.mfes.mfe.entry.v1~frontx.mfes.mfe.entry_mf.v1~acme.crm.mfe.customer.details.v1
```

**Extension ID Pattern:**
```
gts.frontx.mfes.ext.extension.v1~[YOUR_ORG].[YOUR_APP].ext.[YOUR_SCREEN_NAME]_screen.v1
```

Example:
```
gts.frontx.mfes.ext.extension.v1~acme.crm.ext.customer_details_screen.v1
```

**Update the `remoteEntry` URL:**
```json
"remoteEntry": "http://localhost:[YOUR_PORT]/assets/remoteEntry.js"
```

**Update the `remoteName`:**
```json
"remoteName": "yourMfeName"
```

**Update the presentation metadata:**
```json
"presentation": {
  "label": "Your Screen Label",
  "icon": "lucide:your-icon",
  "route": "/your-route",
  "order": 100
}
```

### 4. Customize the Screen Component

Edit `src/screens/home/HomeScreen.tsx`:
- Rename the component if needed
- Add your business logic
- Compose the UI from `@gears-frontx/ui-kit` components, and put screen-local
  layout in `HomeScreen.module.css` using the kit's tokens (see
  [Styling](#styling))

### 5. Update Translations

Edit the i18n files in `src/screens/home/i18n/`:
- Update the `title` and `description` keys for all 36 language files
- Add any additional translation keys your screen needs
- Ensure all keys used in `t()` calls exist in the translation files

### 6. Install Dependencies

```bash
npm install
```

No registration step is needed to make the package buildable or runnable: the
root `package.json` globs `src-app/mfe_packages/*` as workspaces, and the
shell's dev orchestrator discovers every package under that directory and
reads its port from the package's own `preview` script. A copied directory is
picked up by both as soon as it exists.

### 7. Register with Host

In the host app's MFE bootstrap file (e.g., `src/app/mfe/bootstrap.ts`):

```typescript
import yourMfeConfig from '@gears-frontx/your-mfe-name/mfe.json';

// Register manifest
runtime.registerManifest(yourMfeConfig.manifest);

// Register entries
yourMfeConfig.entries.forEach(entry => {
  runtime.registerEntry(entry);
});

// Register extensions
yourMfeConfig.extensions.forEach(extension => {
  runtime.registerExtension(extension);
});
```

## Project Structure

```
_blank-mfe/
├── package.json              # Package metadata and dependencies
├── tsconfig.json             # TypeScript configuration
├── vite.config.ts            # Vite and Module Federation config
├── vitest.config.ts          # Test config, on the shell's shared MFE base
├── mfe.json                  # MFE manifest, entries, and extensions
├── README.md                 # This file
└── src/
    ├── lifecycle.tsx         # MFE lifecycle: shadow-root styling + screen render
    ├── init.ts               # MFE app composition (services, slices, effects)
    ├── api/                  # MFE-local API service, endpoint types, mocks
    ├── actions/              # Action creators
    ├── events/               # Event definitions
    ├── effects/              # Effect handlers
    ├── slices/               # State slices
    ├── shared/
    │   ├── useScreenTranslations.ts    # i18n hook
    │   └── anchorKitThemeOnShadowHost.ts  # ui-kit token re-anchoring
    └── screens/
        └── home/
            ├── HomeScreen.tsx        # Screen component
            ├── HomeScreen.module.css # Screen-local styles on kit tokens
            └── i18n/                 # 36 language files
                ├── en.json
                ├── es.json
                └── ... (34 more)
```

Every source file has its test beside it (`*.test.ts`, `*.test.tsx`).

## Key Concepts

### Shadow DOM Isolation

All MFE content renders inside a Shadow DOM root, ensuring complete CSS
isolation from the host application. Three separate things put CSS in there,
and it helps to know which is which:

1. **This package's own CSS** — the component styles from `@gears-frontx/ui-kit`
   and `HomeScreen.module.css` — is emitted by the build into this MFE's own
   stylesheet, listed in its `mf-manifest.json`, and injected as a `<link>`
   into the shadow root by the host's MFE handler *before* `mount()` runs.
   Nothing in the package has to arrange this.
2. **The host document's stylesheets** are cloned into the shadow root by
   `ThemeAwareReactLifecycle.mount()`, once, at mount.
3. **The kit's design tokens** are injected by this package's
   `initializeStyles()` override — see [Styling](#styling) for why they need
   a step of their own.

### Bridge Communication

The `ChildMfeBridge` provides APIs for:
- Property subscriptions (theme, language)
- Actions chain execution (navigation, custom actions)
- Bidirectional communication with the host

### MFE-Local i18n

Each screen manages its own translations using `useScreenTranslations`:
- Translations are loaded dynamically based on the current language
- Language changes trigger automatic translation reload
- No host-side i18n dependencies

### Styling

Components come from `@gears-frontx/ui-kit`, pinned to an exact version. It is
a dependency, not a folder of copied files — do not vendor primitives into this
package.

```tsx
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@gears-frontx/ui-kit';
```

Each kit component carries its own CSS Module; importing the component pulls
its styles in with it, and the build ships only the components you imported.

**A kit component's spacing can depend on what its direct children are.**
`Card` is the case that bites: it spaces its slots with a
`gap: var(--card-spacing)` declared on the card root, so that gap only ever
falls between `Card`'s *direct* children. Wrap the slots and it applies to
nothing.

```tsx
// Correct — the slots stay direct children of Card, the form lives in a slot.
<Card>
  <CardHeader>
    <CardTitle>Sign in</CardTitle>
  </CardHeader>
  <CardContent>
    <form id="sign-in" onSubmit={handleSubmit}>…</form>
  </CardContent>
  <CardFooter>
    <Button type="submit" form="sign-in">Continue</Button>
  </CardFooter>
</Card>

// Wrong — Card has a single child now, and its gap applies to nothing.
<Card>
  <form onSubmit={handleSubmit}>
    <CardHeader>…</CardHeader>
    <CardContent>…</CardContent>
    <CardFooter>…</CardFooter>
  </form>
</Card>
```

The wrong shape does not look broken at a glance, which is why it keeps getting
shipped: the slots' horizontal padding comes from descendant rules
(`.card .cardContent`) and still lands, so only the vertical rhythm disappears
and the submit button ends up flush against the last field. The native `form`
attribute above is what keeps a submit button in `CardFooter` while its fields
live in `CardContent`; a form whose actions sit inside the form itself needs no
`CardFooter` at all, which is how `demo-mfe`'s `ProfileDetailsCard` composes
one. `Card` cannot render as a `<form>` element instead — the kit's card parts
are plain `div`s with no element-swapping `render` prop.

Screen-local layout goes in a `*.module.css` beside the screen and reads the
kit's semantic tokens — `var(--space-6)`, `var(--radius-md)`,
`var(--muted-foreground)`, `var(--text-heading-1-size)`. The full token list is
`node_modules/@gears-frontx/ui-kit/dist/theme.css`; per-component usage docs are
in `dist/docs/`.

**Do not use Tailwind utility classes here.** The host's compiled Tailwind does
reach this shadow root, but its colour utilities read the shell's tokens, and
the kit re-declares the same token names with a different value grammar
(`#f8fafc` where the shell has `0 0% 100%`). Inside this shadow root a colour
utility therefore resolves to `hsl(#f8fafc)`, which is invalid and drops out,
while layout utilities keep working — the worst kind of failure to inherit into
a copied screen.

That token re-declaration is what `initializeStyles()` in `lifecycle.tsx` sets
up: the kit declares its tokens on `:root`, which matches nothing inside a
shadow tree, so the lifecycle rewrites those selectors to `:host` before
injecting the stylesheet. The screen root then carries `data-theme="light"` or
`"dark"`, mapped from the host's current theme, which selects the kit's own
light or dark token set.

## Development

### Run Locally

```bash
npm run dev
```

The MFE will be served at `http://localhost:[YOUR_PORT]/assets/remoteEntry.js`.

### Build

```bash
npm run build
```

### Type Check and Test

```bash
npm run type-check
npm run test:unit
```

Both resolve through the `@gears-frontx/mfe-test-support` package: `vitest.config.ts`
imports `defineMfeProject` from `@gears-frontx/mfe-test-support/vitest.mfe.base`,
and test files import shared test doubles (e.g. `createMfeBridgeFixture`) from
`@gears-frontx/mfe-test-support/*` directly, by name, rather than reaching across
a relative path into whichever shell this template is applied onto. They still run
from an assembled project — a shell plus this template — since that package ships
as one of the shell's own workspace members, resolved once `npm install` runs.

## Troubleshooting

### Module Federation Errors

If you see "Shared module not available" errors:
- Ensure all shared dependencies in `mfe.json` match those in `vite.config.ts`
- Verify the host app is configured to consume your remote

### Type Errors

If TypeScript cannot resolve `@gears-frontx/*` imports:
- Ensure `@gears-frontx/react` is in `dependencies`
- Run `npm install` to symlink workspace packages

### Style Issues

If a kit component renders unstyled — no fill, no radius, no height — its
tokens did not reach the shadow root. Check the injected `<style>` in the
shadow root: it must declare the kit's tokens on `:host`, not on `:root`.

If a colour is wrong or missing while spacing and layout are right, something
is reading the shell's tokens rather than the kit's. A Tailwind colour utility
in this package is the usual cause — see [Styling](#styling).

If a `Card`'s parts are crammed together vertically — a footer button flush
against the last field — while its left and right padding looks right, an
element wraps the card's slots and swallows the card's gap. Make the slots
direct children of `Card` again — see [Styling](#styling).

If a component's own styles are missing, the CSS is not reaching the shadow
root at all. The loader injects every stylesheet an entry declares, both the
synchronous ones and the ones behind a lazy import, so a lazily imported
component is not the cause. Check instead that `dist/mf-manifest.json` lists a
CSS file under the exposed module's `assets.css` - an entry with none there has
nothing to inject - and that the tokens those styles read are anchored on
`:host`, since a component whose own rules arrived but whose `var()` references
resolve to nothing renders just as unstyled.
