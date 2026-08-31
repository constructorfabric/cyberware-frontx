# Sidebar

A composable application-shell sidebar: an expand/collapse state machine
(`SidebarProvider` + `useSidebar`) plus ~20 layout parts composed under it.
Persists its desktop open state in a cookie, toggles on Cmd/Ctrl+B, and
switches to a slide-in `Sheet` on mobile automatically. Built entirely from
other kit parts — `Sheet`, `Button`, `Input`, `Separator`, `Skeleton`,
`Tooltip` — plus an internal `useIsMobile` hook (not exported; if a
consumer needs the same breakpoint elsewhere, write their own).

## When to use

- A persistent app-shell navigation panel: sections, nav links, a search
  field, a user menu in the footer — the layout shadcn's own dashboard
  blocks are built around.

## When not to use

- A transient, dismiss-on-action panel (filters, a form, item details) —
  use `Sheet` or `Drawer` directly; Sidebar's whole design is a
  persistent, cookie-remembered part of the shell, not a one-off overlay.
- A dropdown-style nav menu — use `NavigationMenu` or `DropdownMenu`.

## Setup

Wrap the whole shell in `SidebarProvider`, with `Sidebar` and
`SidebarInset` as siblings inside it — NOT `Sidebar` wrapping
`SidebarInset`:

```tsx
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@gears-frontx/ui-kit';

function AppShell() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>Acme Inc</SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <HomeIcon />
                    <span>Home</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>v1.0</SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <SidebarTrigger />
        {/* page content */}
      </SidebarInset>
    </SidebarProvider>
  );
}
```

`SidebarMenuButton`/`SidebarMenuSubButton` expect children shaped as
`<Icon /><span>Label</span>` — the trailing `<span>` is what truncates
with an ellipsis. An icon-only button (no label span) works too; a bare
text node does not truncate.

Collapsed to the icon rail the row becomes a 32px square with room for
exactly one 16px icon, so **every child after the first is hidden**. That
covers the richer shape upstream uses for header/footer rows — leading
mark, a text block, a trailing chevron — not just `<Icon /><span>`. Two
consequences worth knowing:

- Put the icon **first**. A row whose first child is the label keeps the
  label in the rail and drops the icon.
- Do not set `display` in an **inline style** on a direct child of
  `SidebarMenuButton`. Inline styles outrank the rule that hides it, so
  the child stays in the 32px square and pushes the icon out of the box.
  Style a nested wrapper instead, or use a class.

### Layout: the panel is `position: fixed`

The desktop panel is fixed (upstream's own choice) so it stays pinned
while `SidebarInset` scrolls the page. That resolves against the
**viewport**, so a Sidebar placed inside a bounded box — a preview frame,
a split pane, a dashboard card — escapes that box unless an ancestor
establishes a containing block for fixed descendants:

```tsx
<div style={{ contain: 'layout paint', height: '30rem' }}>
  <SidebarProvider style={{ minHeight: '100%' }}>…</SidebarProvider>
</div>
```

`transform` or `filter` on the ancestor work equally well. Nothing is
needed for the normal case, where the shell IS the page.

## Props

### SidebarProvider

| Prop | Type | Default |
|------|------|---------|
| `defaultOpen` | `boolean` — starting state AND an opt-out of the cookie | persisted cookie, else `true` |
| `open` | `boolean` — controlled desktop open state | — |
| `onOpenChange` | `(open: boolean) => void` | — |

Omit `defaultOpen` and the provider restores whatever was last persisted
(`sidebar_state`, 7 days). Pass it and it wins outright, cookie ignored.
That opt-out matters because the cookie is a single key for the whole
document: two providers on one page would otherwise read the same key and
move together, and `defaultOpen={false}` would silently do nothing as soon
as anything had ever been toggled.

`SidebarProvider` also wraps its subtree in a `TooltipProvider` with
`delay={0}` (upstream does the same). Collapsed to the icon rail the
tooltip IS the row's only label, so a hover delay would leave the nav
unreadable for its duration. Nesting inside your own `TooltipProvider` is
fine — Base UI scopes them.

### Sidebar

| Prop | Type | Default |
|------|------|---------|
| `side` | `left` \| `right` | `left` |
| `variant` | `sidebar` \| `floating` \| `inset` | `sidebar` |
| `collapsible` | `offcanvas` \| `icon` \| `none` | `offcanvas` |

`variant="inset"` also affects `SidebarInset`'s own rendering (it grows a
margin/radius/shadow to read as a floating card) — see `useSidebar`'s
`state` for driving conditional UI elsewhere in the shell.

### SidebarTrigger

| Prop | Type | Default |
|------|------|---------|
| `label` | `string` — accessible name for the icon-only button | `'Toggle Sidebar'` |

All other props are `Button` props (this IS a `Button`, `variant="ghost"
size="sm"`, with a fixed icon slot).

### SidebarMenuButton

| Prop | Type | Default |
|------|------|---------|
| `variant` | `default` \| `outline` | `default` |
| `size` | `default` \| `sm` \| `lg` | `default` |
| `isActive` | `boolean` — accent fill, reflected as `data-active` | `false` |
| `tooltip` | `string \| TooltipContentProps` — see below | — |
| `render` | `ReactElement` — polymorphism, e.g. render as a link | — |

`tooltip` only ever shows while the sidebar is desktop-collapsed to its
icon rail (`useSidebar().state === 'collapsed'` and not mobile) — pass it
on every icon-only nav item so the label is still reachable when
collapsed; it is simply never mounted otherwise, expanded or on mobile,
where the label is already visible next to the icon.

### SidebarMenuSubButton

| Prop | Type | Default |
|------|------|---------|
| `size` | `sm` \| `md` | `md` |
| `isActive` | `boolean` | `false` |
| `render` | `ReactElement` | — |

### SidebarMenuAction

| Prop | Type | Default |
|------|------|---------|
| `showOnHover` | `boolean` — paint only on item hover/focus-within (or `aria-expanded`) instead of always-visible | `false` |

### SidebarMenuSkeleton

| Prop | Type | Default |
|------|------|---------|
| `showIcon` | `boolean` | `false` |

Every other exported part (`SidebarContent`, `SidebarGroup`,
`SidebarGroupContent`, `SidebarGroupAction`, `SidebarGroupLabel`,
`SidebarHeader`, `SidebarFooter`, `SidebarInput`, `SidebarInset`,
`SidebarMenu`, `SidebarMenuItem`, `SidebarMenuBadge`, `SidebarMenuSub`,
`SidebarMenuSubItem`, `SidebarRail`, `SidebarSeparator`) takes only its
native element's own props plus `className`; `SidebarGroupLabel` and
`SidebarGroupAction` additionally take `render` for polymorphism (same
`useRender`/`mergeProps` idiom as `Badge`).

## `useSidebar()`

```ts
const { state, open, setOpen, openMobile, setOpenMobile, isMobile, toggleSidebar } = useSidebar();
```

`state` is `'expanded' | 'collapsed'`, derived from `open`. Throws outside
a `SidebarProvider` — there is no sensible default a bare consumer of the
hook could fall back to.

## Custom width

Override `--sidebar-width` / `--sidebar-width-icon` via `style` on
`SidebarProvider` — every desktop/mobile size below reads from these two,
inherited down to `Sidebar`/`SidebarInset` the same way `Card` shares
`--card-spacing` with its own parts:

```tsx
<SidebarProvider style={{ '--sidebar-width': '20rem' }}>
```

## Not reproduced from upstream

Row geometry is upstream's, not invented: the metrics come from
`apps/v4/registry/new-york-v4/ui/sidebar.tsx`, which carries the real
Tailwind utility strings, re-expressed on the kit's token scales
(`p-2` → `--space-2`, `h-8` → `--control-height-sm`, `w-5` → `--space-5`,
`size-4` → `--icon-size-sm`). Rows are 28/32/48px for `sm`/`default`/`lg`,
sub-rows 28px at both sizes, badges and actions 20px squares centred on
their row. The type ramp is the kit's — since the Studio blue rebrand its
body role is 14/20, which happens to coincide with upstream's `text-sm`.

- **Cookie read happens after mount, not during render.** Upstream's own
  model reads the `sidebar_state` cookie in a Next.js Server Component and
  hands the result down as `defaultOpen`, so the very first HTML byte
  already reflects the persisted state. This kit owns no server-rendering
  step of its own, so `SidebarProvider` reads `document.cookie` itself —
  in an effect, not in the state initializer, so the first render is
  identical on both sides of hydration (a server render has no cookie to
  read and would always emit the expanded default). The cost is one frame
  of expanded sidebar before a persisted collapsed state applies; an app
  that owns a server render buys that frame back by reading the cookie
  there and passing `defaultOpen`, which is upstream's model exactly. The
  write path (toggling persists a 7-day cookie) is unchanged.
- **Skeleton row widths come from `useId`, not `Math.random()`.**
  Upstream rolls each `SidebarMenuSkeleton` row's width randomly in a lazy
  state initializer, which renders a different number on the server than
  on the client. The rows still vary — the width is hashed from the row's
  own `useId`, which React keeps stable across hydration and distinct
  between siblings.
- **`SidebarMenuButton`'s tooltip mounts conditionally instead of using a
  `hidden` attribute.** Upstream always mounts `TooltipContent` and flips
  a `hidden` attribute on it depending on collapse state — correct only if
  something declares `[hidden] { display: none }` for that popup, and this
  kit's own `tooltip.module.css` (an existing component directory this
  port must not edit) declares no such rule, so the popup's own
  `display: inline-flex` would out-cascade the UA's `[hidden]` default.
  This port instead only renders the `<Tooltip>` wrapper at all when the
  sidebar is desktop-collapsed — same visible result, no reliance on a
  rule that doesn't exist.
- **`SidebarInput` is hidden in the icon rail.** Upstream leaves it
  alone, and its own dashboard blocks sidestep the result by hiding the
  whole search group at the composition level — something a kit part
  cannot ask of every consumer. There is nothing useful a text field can
  do at 48px minus padding, so it goes when the labels go.
- **Every child after the first is hidden in the icon rail**, and the row
  centers what remains. Upstream sets no `justify-content` and relies on
  `overflow: hidden` clipping whatever does not fit, which is correct only
  when the leading child happens to fill the 32px square exactly — with a
  16px icon its `size="lg"` rows sit visibly left of centre, and with
  centring added the un-hidden siblings push the icon out of the box
  entirely. See the shape note under **Setup**.
- **The trailing 32px of a row with a badge or action is reserved.**
  Upstream reserves it for an action only
  (`group-has-data-[sidebar=menu-action]:pr-8`); a badge gets the same
  footprint here, since a long label sliding under a count reads exactly
  as badly as one sliding under a menu button.
- **No RTL icon flip on `SidebarTrigger`.** Upstream mirrors its trigger
  icon horizontally under a dir="rtl" ancestor. This kit has no bundled
  RTL-detection utility that a self-contained Sidebar could depend on
  without adding a new cross-component coupling (a separate `direction`
  component exists in the kit, but wiring it in is a decision for that
  component's own consumers, not implicit here) — left unflipped.
- **`useIsMobile` starts `false`, not upstream's tri-state
  `undefined`.** See `use-mobile.ts`'s own comment: collapsing the "not
  measured yet" state into "assume desktop" removes a null-check every
  caller of the hook would otherwise carry, at the cost of the same
  one-frame flash-of-desktop-layout upstream's own `hidden md:block` CSS
  already exists to paper over (kept here too, on `.root`).

## Anti-patterns

- Do not nest `SidebarInset` inside `Sidebar` — they are siblings under
  `SidebarProvider`; `SidebarInset` is the MAIN content area, not part of
  the sidebar panel.
- Do not read/write the `sidebar_state` cookie directly — go through
  `SidebarProvider`'s `open`/`onOpenChange` if external state needs to
  observe or drive it; the cookie write is an implementation detail of
  `setOpen`, not a public contract.
- Do not put a bare text node in `SidebarMenuButton` — wrap it in `<span>`
  so it gets truncation.
- Do not put the label before the icon, and do not set `display` inline on
  a direct child — both break the icon rail (see **Setup**).
- Do not place a Sidebar inside a bounded box without giving that box
  `contain: layout paint` (or a `transform`) — the fixed panel will escape
  it and pin itself to the viewport.
- Do not call `useSidebar()` outside a `SidebarProvider` — it throws by
  design; there is no sensible default state.
