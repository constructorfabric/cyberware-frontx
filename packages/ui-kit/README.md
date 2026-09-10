# @gears-frontx/ui-kit

Standard React component base for FrontX templates. Templates build their
screens from it and receive fixes and design updates via a dependency bump;
templates may mix in other components, and other companies can plug their own
kits into their own templates.

- **Stack:** React 19 + Base UI + CSS Modules + CVA
- **Self-contained styles:** the package ships compiled CSS — consumers need no
  CSS framework, preprocessor, or build plugins
- **Customization:** basic branding via CSS-variable tokens; deep changes = fork

## Usage

```ts
// once, in the consumer entry module
import '@gears-frontx/ui-kit/theme.css'; // design tokens (CSS variables)

// two optional global stylesheets, each imported only if you need it:
import '@gears-frontx/ui-kit/utilities.css'; // shimmer, scroll-fade-x, no-scrollbar
import '@gears-frontx/ui-kit/typeset.css'; // prose styling for rendered markdown/HTML
```

`utilities.css` is not optional for every component: **Attachment** depends
on it — `AttachmentTitle` adds `shimmer` while uploading, and
`AttachmentGroup` scrolls its row with `scroll-fade-x` and `no-scrollbar` —
and **Marker** pairs with `shimmer` for its streaming-text effect. Those
classes are plain global CSS with no component chunk to pull them in, so
without this import they are inert and the components simply render without
the effect. Import it once alongside `theme.css` if you use either
component, or want the utilities for your own markup.

`typeset.css` styles blocks of rendered markdown or HTML the app does not
author itself — chat messages, docs, CMS content: wrap them in
`<div class="typeset">`. See [typeset.md](src/styles/typeset.md) for the
presets and rhythm variables.

```tsx
import { Button } from '@gears-frontx/ui-kit';

<Button variant="outline" size="sm">
  Save
</Button>;
```

Each component ships its own CSS chunk, pulled in automatically by importing
the component — there's no combined stylesheet to import separately. Import
from the package root (`@gears-frontx/ui-kit`) or from a component's own
subpath (`@gears-frontx/ui-kit/button`) — both tree-shake the *JS* of
components you don't import, on every bundler tested (Vite, webpack,
esbuild). For CSS, which one actually shakes is bundler-dependent: Vite and
webpack drop the CSS of unimported components either way; esbuild only does
that from a subpath import — bundling the root import through esbuild ships
every component's CSS regardless of what's used, because esbuild collects
CSS from the whole reachable module graph rather than pruning it alongside
unused JS bindings the way it prunes JS. If your build uses esbuild directly
(not through a framework that wraps it, like Vite does), prefer the subpath
import for CSS you actually want dropped.

In an RSC framework (Next.js App Router being the dominant case), most kit
components render straight from a Server Component with no kit-side client JS —
they only compose Base UI primitives as JSX, and Base UI's own dist already
carries `'use client'` on the modules that call hooks (an interactive primitive
like Select or Dialog still ships Base UI's own client bundle; only the kit
wrapper around it needs no directive of its own). The rest call a hook directly
in their own render body and ship a banner on their own chunk instead.

The kit components that carry a `'use client'` banner of their own: Attachment,
Badge, Breadcrumb, Bubble, ButtonGroup, Carousel, Chart, Combobox, ContextMenu,
DataTable, Drawer, DropdownMenu, Marker, Sidebar, Toast.

Everything else — including interactive primitives like Button, Checkbox,
Dialog, Select, Switch, RadioGroup, and Tabs — stays server-renderable; each
one's own client interactivity comes from a Base UI primitive it renders as a
child, which establishes its own client boundary as needed. That list is
checked against the source on every test run (`src/client-boundaries.test.ts`),
so it cannot quietly fall behind the code.

The theme file paints the page (background, text, and UA-owned surfaces like
the scrollbar) as well as defining the tokens, so dark mode works out of the
box with no attribute at all: it follows `prefers-color-scheme` by default.
For explicit control instead, set `data-theme="dark"` or `data-theme="light"`
on `<html>` — or on any inner subtree, which then paints its own surface
independently of the page around it.

Text renders in `--font-sans` (Inter first, then system fallbacks), with
`--font-mono` (JetBrains Mono) reserved for code-like text; theme.css sets
the page font itself. The package ships no font files — load Inter/JetBrains
Mono in your app for the exact Studio look (the fallbacks stay legible
without them). Type sizes come from the Studio ramp tokens
(`--text-<role>-size|line-height|weight|tracking`, roles
`display|heading-1|heading-2|body|label|meta|mono`) — use them for your own
page text too.

To re-brand, override the CSS variables from `theme.css` in your own styles.

## Development

```bash
npm run build --workspace=@gears-frontx/ui-kit   # vite: dist/index.js + dist/<component>.{js,d.ts} + theme.css, ESM only
npm run test:unit --workspace=@gears-frontx/ui-kit
./packages/ui-kit/scripts/verify-consumer.sh     # pack-install + tree-shaking acceptance check
npm run demo:ui-kit                              # browser sandbox: tokens + components pages (demo/)
```

See [design-notes.md](design-notes.md) for the design and its history. The package
publishes on the `alpha` channel through the standard version-gated workflow while
it matures: the 19-component set is live, the remaining MVP components land under
the same pre-release line. A stable (`latest`) release stays gated on the full MVP
component set and on #495 approving the package's architecture ownership,
traceability, and version policy — the required CDSL artifacts must also replace
the temporary `artifacts.toml` ignore before a stable version may be cut.
