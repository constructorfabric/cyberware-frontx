# Quick Start — FrontX Standard Template

> **TARGET AUDIENCE:** Project Developers building an app scaffolded from this template
> **PURPOSE:** How to run the project and develop in it

This is the hands-on guide for working *inside* a project seeded from the FrontX
standard template. For an overview of what the template contains, see
[README.md](README.md).

## Run it

```bash
npm install
npm run build:packages   # solution packages; the lib builds first via prebuild:packages
npm run dev:all          # host + all MFE dev servers
```

Open **http://localhost:5173**. The host shell boots, fetches the MFE manifest,
and the left menu fills in with screens contributed by whatever MFE packages
are present under `src-app/mfe_packages/`. Until you add one the menu stays
empty and `generate:mfe-manifests` writes an empty manifest set - both expected.

The packages `frontx-template-mfe` contributes - `demo-mfe` `:3001`,
`_blank-mfe` `:3099`, widget fixtures `:3201` / `:3202` - do
not change that: they are that template's own examples and stay out of your app,
per `src-app/mfe_packages/README.md`.

> First paint may briefly show an empty menu — the MFE system registers screens
> asynchronously after the manifest loads, then the menu populates.

## Project structure

```text
src-app/
├── app/                     # Host application
│   ├── App.tsx / main.tsx   # Boot: providers, registries, MFE bootstrap
│   ├── components/ui/        # App-owned UI primitives (shadcn)
│   ├── layout/               # CoreLayout: Menu, header, footer, screen container
│   ├── mfe/                  # bootstrap.ts + generated-mfe-manifests.json
│   ├── themes/               # Theme tokens and registries
│   └── globals.css           # Tailwind entry + theme CSS variables
└── mfe_packages/             # Microfrontends (from `frontx-template-mfe`; empty in a shell-only seed)
    ├── demo-mfe/             # Hello World, Profile, Theme, UIKit, Widgets Host
    ├── _blank-mfe/           # Minimal MFE — copy this to start a new one
    └── widgets-fixture-a|b/  # Widgets that mount into demo-mfe's widgets domain
packages/                     # Solution packages: react, framework, state, i18n, studio, auth
src/                          # Shared solution lib (api, build, gts)
```

The `@` import alias resolves to `src-app/` (e.g. `@/app/components/ui/...`).

## How the app composes

The host shell is intentionally empty. Screens come from **microfrontends**:

1. Each MFE declares screen **extensions** in its `mfe.json` (with a
   `presentation` block: label, icon, route, order).
2. The build produces a manifest; `src-app/app/mfe/bootstrap.ts` fetches
   `/generated-mfe-manifests.json` and registers everything at runtime.
3. `src-app/app/layout/Menu.tsx` reads the registered screen extensions and
   renders the menu — mounting the corresponding MFE remote on click.

You extend the app by adding screens/MFEs, not by editing a central registry.

## Create a screen

Add a screen to one of your own MFEs (e.g. `src-app/mfe_packages/my-mfe`, from
[Add a microfrontend](#add-a-microfrontend) below). Adding it to a package the
template ships instead - `demo-mfe`, `_blank-mfe`, either widgets fixture - works
but the screen will not reach the menu: those declare `"templateExample": true`
and are left out of discovery until that line is deleted, which is why the
scaffold step deletes it.

1. **Write the screen component**
   ```tsx
   // src/screens/my-screen/MyScreen.tsx
   import React from 'react';
   import type { ChildMfeBridge } from '@gears-frontx/react';

   export const MyScreen: React.FC<{ bridge: ChildMfeBridge }> = () => (
     <div className="p-6">
       <h1 className="text-2xl font-bold text-primary">My Screen</h1>
       <p className="text-muted-foreground">Content goes here</p>
     </div>
   );
   ```

2. **Wrap it in a Module Federation lifecycle**
   ```tsx
   // src/lifecycle-my-screen.tsx
   import { ThemeAwareReactLifecycle } from '@gears-frontx/react';
   import { mfeApp } from './init';
   import { MyScreen } from './screens/my-screen/MyScreen';

   class MyScreenLifecycle extends ThemeAwareReactLifecycle {
     constructor() { super(mfeApp); }
     protected renderContent(bridge) { return <MyScreen bridge={bridge} />; }
   }
   export default new MyScreenLifecycle();
   ```

3. **Declare it in `mfe.json`** — an entry plus a screen extension whose
   `presentation` block drives the menu item:
   ```jsonc
   {
     "id": "gts…screen.v1~frontx.my_mfe.screens.my_screen.v1",
     "domain": "gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1",
     "entry": "gts…entry_mf.v1~frontx.my_mfe.mfe.my_screen.v1",
     "presentation": { "label": "My Screen", "icon": "lucide:star", "route": "/my-screen", "order": 30 }
   }
   ```

4. **Expose the module** — add `./lifecycle-my-screen` to the MFE's
   `vite.config.ts` exposes, then re-run `npm run dev:all`. The screen appears
   in the menu automatically.

## Add a microfrontend

MFEs are the unit of composition. `_blank-mfe` (the copy-from scaffold) ships
with `frontx-template-mfe`, not the shell — register and apply it first if
`src-app/mfe_packages/_blank-mfe` isn't there yet:

```bash
frontx register <mfe-origin>
frontx apply --input '{"templates":{"@gears-frontx/frontx-template-mfe":["src-app/mfe_packages"]}}'
```

then `npm install` (the workspace glob picks up the new packages, so the lock
must be regenerated). Start from the blank MFE:

```bash
NEW=src-app/mfe_packages/my-mfe
cp -r src-app/mfe_packages/_blank-mfe "$NEW"
node -e 'const f=process.argv[1],fs=require("fs"),m=JSON.parse(fs.readFileSync(f,"utf8"));delete m.templateExample;fs.writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$NEW/mfe.json"
```

The second command strips the scaffold's `"templateExample": true` line, which is
what would otherwise keep your copy out of the menu (see
`src-app/mfe_packages/README.md` for why). It belongs to the copy rather than to a
later step, because a copy that keeps the flag registers nothing and nothing
fails to say so.

Then update its `package.json` name and preview `--port`, declare your entries
and screen extensions in `mfe.json`, and expose your lifecycle modules in its
`vite.config.ts`.
`dev:all` discovers MFEs automatically by scanning `src-app/mfe_packages/` —
there is no registry file to edit. See the shell's `mfe-package-contract` AI
guideline for the exact shape a new package must have.

## Layout & navigation

The template ships a complete `CoreLayout` (menu, header, footer, sidebar, and
the screen container). You compose *into* it:

- **Menu** is populated from screen extensions (`presentation.label`/`icon`/`order`).
- **Screen container** mounts one screen at a time (exclusive mount strategy).
- **Sidebar / popup / overlay** are optional domains an MFE can target the same way.

`src-app/app/layout/Menu.tsx` is the canonical reference — it subscribes to the
MFE registry and dispatches mount actions on click.

## State

```tsx
import { useAppSelector, eventBus } from '@gears-frontx/react';

const MenuToggle = () => {
  const collapsed = useAppSelector((s) => s['layout/menu'].collapsed);
  return (
    <button onClick={() => eventBus.emit('layout/menu/collapsed', { collapsed: !collapsed })}>
      Menu collapsed: {String(collapsed)}
    </button>
  );
};
```

The app is **event-driven**: prefer emitting events over dispatching directly.
Hooks such as `useMountedExtensions`, `useTheme`, `useTranslation`, and
`useApiQuery` subscribe to store changes without polling.

## Styling

Tailwind CSS with CSS-variable theme tokens (defined in
`src-app/app/globals.css`):

```tsx
<div className="bg-background text-foreground">
  <h1 className="text-2xl font-bold text-primary">Title</h1>
  <p className="text-muted-foreground">Description</p>
</div>
```

Common tokens: `background`, `foreground`, `primary`, `secondary`, `accent`,
`muted`, `border`. Themes switch live via the **FrontX Studio** panel (bottom-
right in dev), which also toggles mock APIs and language.

## UI components

App-owned primitives live in `src-app/app/components/ui`:

```tsx
// src-app/app/components/ui/badge.tsx
import React from 'react';
import { cn } from '@/app/lib/utils';

export const Badge: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <span className={cn('px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground', className)}>
    {children}
  </span>
);
```

Import via the `@` alias: `import { Badge } from '@/app/components/ui/badge';`

## Common commands

```bash
# Development
npm run dev:all           # build MFEs + start host and all MFE preview servers
npm run dev               # host only (rebuilds packages + MFEs, then vite)
npm run build             # full production build
npm run build:packages    # build solution workspace packages
npm run build:mfes        # build all MFE packages
npm run generate:mfe-manifests   # regenerate the host MFE manifest index
npm run preview           # preview a production build

# Validation
npm run lint              # ESLint
npm run type-check        # type-check host app, packages, and MFEs
npm run arch:deps         # dependency-boundary rules
npm run test:unit         # unit tests (package + app + workspace MFEs)
```

## Development best practices

1. **Keep MFEs isolated** — no cross-MFE imports; communicate via the bridge and
   shared properties.
2. **Extend by adding screens/MFEs** — let the menu populate from extensions;
   don't hand-wire navigation.
3. **Type everything** — no `any`, explicit return types, proper generics.
4. **Prefer events** — emit events for state changes; use selectors for reads.
5. **Use theme tokens** — avoid hard-coded colors; style with Tailwind utilities.

## Getting help

- `src-app/mfe_packages/demo-mfe/` — a worked reference for screens, the bridge,
  theming, and the widgets host.
- `src-app/app/mfe/bootstrap.ts` and `layout/Menu.tsx` — how MFEs register and
  the menu is built.
- Refer to `@gears-frontx/react` types for the hook and provider APIs.
