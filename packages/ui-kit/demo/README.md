# UI Kit Demo

A component browser for [`@gears-frontx/ui-kit`](..): one screen per component, plus a few
foundations screens for the theme tokens.

It consumes the package the way an external user would - the bare specifier `@gears-frontx/ui-kit`,
resolved through the package's `exports` to `dist/`, no reaching into `src/`, no path aliases. That
is what makes it an acceptance check rather than a showcase: if the sandbox compiles and renders,
the public API, the emitted types and the shipped CSS are usable together.

Nothing here is published. `files[]` in the package manifest is a whitelist (`dist`, `llms.txt`,
`README.md`, `LICENSE`, `NOTICE`), and the library build's entries all live under `src/`, so `demo/`
reaches neither the tarball nor the bundle.

## Run

From the repo root:

```sh
npm run demo:ui-kit
```

Or from the package directory:

```sh
npm run demo
```

Open the URL Vite prints (<http://localhost:5173> by default - nothing in the demo depends on the
port, so it is not pinned; pass `--port` to move it).

`predemo` builds the kit first, so a fresh clone works in one command. The sandbox consumes the
kit's `dist/`, not its source, so kit edits need `npm run build`, not just a save. A rebuild does
show up on a plain reload though: the workspace-linked package is exempt from Vite's dependency
pre-bundling, so there is no cached copy to go stale and no server restart needed.

## Layout

The shell is a kit-dogfooded `Sidebar` + `SidebarInset` - the demo is itself a consumer of the
components it displays. The panel lists two groups, both built in `main.tsx`:

| Group | Source | Contents |
| --- | --- | --- |
| Foundations | `FOUNDATIONS_NAV`, from the `PAGES` array | Three hand-written screens under `pages/` |
| Components | `COMPONENTS_NAV`, discovered from `examples/*.tsx` | One screen per example module |

A filter box above the groups narrows both by label.

### Foundations screens

One screen per foundations board, each a module in `pages/` sharing the token readers in
`pages/token-utils.ts`. Values are read from the live cascade and re-read on `data-theme` changes
and OS scheme flips, so the printed value always states what the current theme computes.

| Slug | Module | Shows |
| --- | --- | --- |
| `semantic-colors` | `pages/semantic-colors-page.tsx` | Every `theme.css` color token grouped by role - surfaces, text, brand, status, borders |
| `typography` | `pages/typography-page.tsx` | Each `--text-<role>-*` group (display, heading-1, heading-2, body, label, meta, mono) as live sample text, plus the family swatches |
| `layout-elevation` | `pages/layout-elevation-page.tsx` | The radius, spacing and controls scales (heights, icon sizes, border widths) and the elevation steps |

There is no Primitive Palette screen: `theme.css` defines semantic tokens only, no primitive color
ramps, so that board has nothing to render. There are no separate Light/Dark screens either - the
header's theme toggle covers both for every screen.

### Component screens

Each file in `examples/` is one component's screen; the filename stem is both the label and the
route token, so `examples/dropdown-menu.tsx` is `#/dropdown-menu`. The module's default export is
the screen.

Adding a component to the browser means adding its example file - `main.tsx` discovers them with
`import.meta.glob` and needs no edit. Two optional touches: an entry in `main.tsx`'s `ICON_MAP` gives
the row a specific icon for the collapsed rail instead of the generic fallback, and a `-backup`
filename suffix marks a screen as a superseded port, which the menu renders with a Badge.

Screens are lazy-loaded per route and each is wrapped in an error boundary, so an example that
throws (or imports something the barrel does not export yet) fails to its own screen instead of
taking the app down.

`shared.tsx` holds the small layout helpers examples compose with - `Section`, `Row`, and a couple of
placeholder icons.

## Navigation and theme

Routing is `location.hash` only, no router dependency - every nav row is a real `<a href="#/slug">`,
so clicks, middle-clicks and pasted deep links all behave. An unrecognized or empty hash normalizes
via `history.replaceState`, which keeps Back working in one press.

The header's theme control writes `auto` / `light` / `dark`, persisting to `localStorage` under
`ui-kit-demo-theme`; `auto` follows the OS scheme. An inline script in `index.html` applies the
stored choice before first paint to avoid a flash.

## Notes

- The foundations screens are the quick way to eyeball a palette change: rebuild the kit, reload,
  and the swatch plus its printed value both update.
- Derived radius steps print their declared `calc()` rather than resolved pixels - a custom property
  has no computed value until it is applied somewhere; the square next to each label draws the real
  result.
- The demo has its own `tsconfig.json`. `type-check:demo` runs it, and the root
  `type-check:packages:ui-kit` includes it, so a kit API change that breaks the sandbox fails the
  regular type gate in CI.
- `demo/index.html` loads real Inter/JetBrains Mono from Google Fonts so the Typography screen (and
  everything else) previews in the actual fonts the kit's `--font-sans`/`--font-mono` name. This is a
  dev-only network dependency of the sandbox itself, not of the shipped package - the kit ships no
  font files and never fetches any (see llms.txt); a consumer app loads its own fonts, or accepts the
  fallback stacks.
