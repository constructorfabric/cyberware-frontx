import {
  Separator,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@gears-frontx/ui-kit';

import {
  BellIcon,
  CalendarIcon,
  ChartPieIcon,
  ChevronsUpDownIcon,
  EllipsisIcon,
  FolderIcon,
  GalleryVerticalEndIcon,
  HouseIcon,
  InboxIcon,
  LifeBuoyIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
} from 'lucide-react';

import type { CSSProperties, ReactNode } from 'react';

import { Section } from '../shared';

/*
 * Sidebar's desktop panel is `position: fixed` — upstream's own choice, and
 * the correct one for a page-level app shell, where the panel must stay
 * pinned while the page scrolls. On a component gallery page that means the
 * panel resolves against the VIEWPORT and escapes whatever box we put it in,
 * so every example below would pile up in the top-left corner of the page.
 *
 * `contain: layout paint` is the fix: layout containment makes this element
 * a containing block for fixed-positioned descendants, and paint containment
 * clips them to it. shadcn's own docs solve the same problem by rendering
 * each sidebar demo in an iframe. Tooltips and the mobile Sheet portal to
 * `document.body`, so they are outside the clip and still paint normally.
 */
function ShellFrame({ height, children }: { height: string; children: ReactNode }) {
  return (
    <div
      style={{
        contain: 'layout paint',
        height,
        border: 'var(--border-width) solid var(--border)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      {children}
    </div>
  );
}

/*
 * The inset's own top bar — trigger, a vertical rule, and where a breadcrumb
 * would sit. Upstream pairs every shell with one (`h-16 shrink-0 border-b`,
 * sidebar-01); it is also the only place the trigger has anywhere sensible
 * to live.
 *
 * That h-16 is not arbitrary and this port keeps it: 64px is exactly the
 * block SidebarHeader makes when it holds a size="lg" workspace row —
 * --space-2 padding, the 48px row, --space-2 padding — so the panel's own
 * divider under that row and this border land on ONE y instead of the 24px
 * step the previous --control-height-lg header left. Nothing compensates for
 * anything here: both sides are 64px of content with a 1px line drawn under
 * it, which is also why the height stays on the ambient content box (the
 * border sits BELOW the 64px block, it is not carved out of it).
 */
function InsetHeader({ title }: { title: string }) {
  return (
    <header
      style={{
        display: 'flex',
        height: 'calc(var(--control-height-lg) + var(--space-2) + var(--space-2) + var(--space-2))',
        flexShrink: 0,
        alignItems: 'center',
        gap: 'var(--space-2)',
        borderBottom: 'var(--border-width) solid var(--border)',
        paddingInline: 'var(--space-3)',
      }}
    >
      <SidebarTrigger />
      {/*
       * Separator's own CSS gives `[data-orientation='vertical']` an
       * `align-self: stretch` (separator.module.css) — shadcn's upstream
       * default for a divider that fills whatever cross-size its container
       * gives it. This header wants a short, centered rule instead (`h-4`
       * in upstream's own inset-header markup), so it constrains height
       * inline. But per the flexbox spec (CSS Flexible Box §9.4/§8.3),
       * `stretch` only *stretches* an item with an auto cross size; once
       * that size is definite - as it is here, with an explicit inline
       * height - the browser falls back to flex-start alignment instead of
       * honoring the header's own `alignItems: 'center'`. That flex-start
       * fallback is what pinned the rule flush to the header's top edge.
       * `alignSelf: 'center'` overrides the class's `stretch` (inline
       * style always outranks an external stylesheet, regardless of
       * selector specificity) and restores centering without touching
       * Separator itself - the stretch default is correct for every other
       * consumer, this is a one-off composition choice.
       */}
      <Separator orientation="vertical" style={{ height: 'var(--space-4)', alignSelf: 'center' }} />
      <span style={{ fontSize: 'var(--text-label-size)', color: 'var(--muted-foreground)' }}>{title}</span>
    </header>
  );
}

/*
 * Note what is NOT here: `display`. Collapsed to the icon rail,
 * SidebarMenuButton hides every child after the first with a class rule,
 * and an inline `display` on a direct child would outrank it — leaving this
 * block in the 32px square, where it pushes the leading icon out of the box.
 * The two lines stack via `display: block` on the spans inside instead.
 */
const twoLineBlock: CSSProperties = {
  flex: '1 1 0%',
  // Without min-width:0 the block refuses to shrink below its content, so
  // the row would push the chevron out instead of truncating.
  minWidth: 0,
  lineHeight: 'var(--text-label-line-height)',
};

const truncate: CSSProperties = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/* A two-line lg row: leading mark, name over a secondary line, trailing
   chevron. Note the block is a <div>, not a <span> — SidebarMenuButton
   truncates its LAST span, and here the last child is the chevron, so the
   spans inside carry their own truncation instead. */
function TwoLineRow({
  icon,
  primary,
  secondary,
}: {
  icon: ReactNode;
  primary: string;
  secondary: string;
}) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" tooltip={primary}>
          {icon}
          <div style={twoLineBlock}>
            <span
              style={{ ...truncate, fontWeight: 'var(--text-label-weight)' as CSSProperties['fontWeight'] }}
            >
              {primary}
            </span>
            <span style={{ ...truncate, fontSize: 'var(--text-meta-size)', color: 'var(--muted-foreground)' }}>
              {secondary}
            </span>
          </div>
          <ChevronsUpDownIcon />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/* Every part that has a place in a real navigation, composed the way an
   application would compose them rather than listed part by part. */
function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <TwoLineRow icon={<GalleryVerticalEndIcon />} primary="Acme Inc" secondary="Enterprise" />
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          {/* Polymorphic via `render` — the group label IS the input's
              <label>, which is the whole reason the part takes a render
              prop. */}
          <SidebarGroupLabel render={<label htmlFor="sidebar-demo-search" />}>Search</SidebarGroupLabel>
          {/* Just the input. A decorative icon overlaid on top of it would
              be positioned by this group, not by the input, so it would
              survive into the icon rail after the input itself is hidden —
              use InputGroup if a real affixed icon is wanted. */}
          <SidebarGroupContent>
            <SidebarInput id="sidebar-demo-search" placeholder="Search the docs..." />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupAction title="Add project">
            <PlusIcon />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive tooltip="Home">
                  <HouseIcon />
                  <span>Home</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Inbox">
                  <InboxIcon />
                  <span>Inbox</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>24</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Projects">
                  <FolderIcon />
                  <span>Projects</span>
                </SidebarMenuButton>
                <SidebarMenuAction showOnHover title="More">
                  <EllipsisIcon />
                </SidebarMenuAction>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton isActive>Design Engineering</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton>Sales &amp; Marketing</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton size="sm">Travel</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Calendar">
                  <CalendarIcon />
                  <span>Calendar</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Insights</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Reports">
                  <ChartPieIcon />
                  <span>Reports</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>3</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Alerts">
                  <BellIcon />
                  <span>Alerts that outrun the panel and have to truncate</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {/* Rows still loading — same 32px height and 8px inset as the
                  real ones above, so nothing reflows when they resolve. */}
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {/* Both dividers are direct children of Sidebar, never nested inside
          SidebarHeader/Footer: SidebarSeparator's inset is 8px from its OWN
          parent's content box (upstream's `mx-2`), so a divider placed
          inside the 8px-padded footer would draw 16px in and read as a
          different, shorter rule than this one. At this level the panel's
          three regions are separated by two identical lines. */}
      <SidebarSeparator />
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" tooltip="Support">
              <LifeBuoyIcon />
              <span>Support</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" tooltip="Settings">
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <TwoLineRow icon={<UsersIcon />} primary="Sofia Rahman" secondary="sofia@acme.com" />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function ModeShell({
  collapsible,
  defaultOpen = true,
  title,
}: {
  collapsible: 'offcanvas' | 'icon' | 'none';
  defaultOpen?: boolean;
  title: string;
}) {
  return (
    <ShellFrame height="13rem">
      {/* defaultOpen is always explicit here — see VariantShell's note. */}
      <SidebarProvider defaultOpen={defaultOpen} style={{ minHeight: '100%' }}>
        <Sidebar collapsible={collapsible}>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Platform</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive tooltip="Home">
                      <HouseIcon />
                      <span>Home</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton tooltip="Inbox">
                      <InboxIcon />
                      <span>Inbox</span>
                    </SidebarMenuButton>
                    <SidebarMenuBadge>24</SidebarMenuBadge>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <InsetHeader title={title} />
        </SidebarInset>
      </SidebarProvider>
    </ShellFrame>
  );
}

function VariantShell({ variant }: { variant: 'sidebar' | 'floating' | 'inset' }) {
  return (
    <ShellFrame height="13rem">
      {/* Explicit defaultOpen so this frame keeps its own state instead of
          following whatever the hero shell last wrote to the cookie. */}
      <SidebarProvider defaultOpen style={{ minHeight: '100%' }}>
        <Sidebar variant={variant} collapsible="icon">
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Platform</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive tooltip="Home">
                      <HouseIcon />
                      <span>Home</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton tooltip="Inbox">
                      <InboxIcon />
                      <span>Inbox</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <InsetHeader title={`variant="${variant}"`} />
        </SidebarInset>
      </SidebarProvider>
    </ShellFrame>
  );
}

/* The row states, in a collapsible="none" panel — that mode is the one that
   lays out in normal flow, so the anatomy can be read side by side with
   everything else on the page instead of behind a toggle. */
function RowAnatomy() {
  return (
    <div
      style={{
        display: 'flex',
        width: 'fit-content',
        border: 'var(--border-width) solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      <SidebarProvider style={{ minHeight: 'auto' }}>
        <Sidebar collapsible="none">
          <SidebarGroup>
            <SidebarGroupLabel>Sizes</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton size="sm">
                    <HouseIcon />
                    <span>size=&quot;sm&quot; — 28px</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>7</SidebarMenuBadge>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <HouseIcon />
                    <span>size=&quot;default&quot; — 32px</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>7</SidebarMenuBadge>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton size="lg">
                    <HouseIcon />
                    <span>size=&quot;lg&quot; — 48px</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>7</SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Variants &amp; states</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <InboxIcon />
                    <span>default</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton variant="outline">
                    <InboxIcon />
                    <span>outline</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <InboxIcon />
                    <span>isActive</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <InboxIcon />
                    <span>disabled</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <FolderIcon />
                    <span>with action</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction title="More">
                    <EllipsisIcon />
                  </SidebarMenuAction>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive>sub, isActive</SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton size="sm">sub, size=&quot;sm&quot;</SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </Sidebar>
      </SidebarProvider>
    </div>
  );
}

export default function SidebarExample() {
  return (
    <>
      <Section title="Application shell">
        <ShellFrame height="34rem">
          <SidebarProvider style={{ minHeight: '100%' }}>
            <AppSidebar />
            <SidebarInset>
              <InsetHeader title="Platform / Home" />
              <div style={{ padding: 'var(--space-4)', color: 'var(--muted-foreground)' }}>
                Toggle the panel with the trigger, the rail on its right edge, or Cmd/Ctrl+B. Collapsed, every
                row becomes a 32px icon square and its label moves into a tooltip.
              </div>
            </SidebarInset>
          </SidebarProvider>
        </ShellFrame>
      </Section>

      <Section title="Collapsible modes">
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <ModeShell collapsible="offcanvas" title='collapsible="offcanvas" — slides fully out' />
          <ModeShell collapsible="icon" title='collapsible="icon" — shrinks to a 48px rail' />
          <ModeShell
            collapsible="icon"
            defaultOpen={false}
            title='collapsible="icon", starting collapsed'
          />
          <ModeShell collapsible="none" title='collapsible="none" — fixed width, no toggle' />
        </div>
      </Section>

      <Section title="Variants">
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <VariantShell variant="sidebar" />
          <VariantShell variant="floating" />
          <VariantShell variant="inset" />
        </div>
      </Section>

      <Section title="Menu row anatomy">
        <RowAnatomy />
      </Section>
    </>
  );
}
