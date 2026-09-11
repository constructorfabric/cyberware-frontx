import {
  Component,
  lazy,
  StrictMode,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type CSSProperties,
  type ErrorInfo,
  type LazyExoticComponent,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';

import '@gears-frontx/ui-kit/theme.css';
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  Skeleton,
  Toaster,
  useSidebar,
} from '@gears-frontx/ui-kit';
// Direct imports, not the barrel — the kit's icon policy (see any
// examples/*.tsx file): consumers pick their own icon per use, the kit
// itself ships none. One per nav row (ICON_MAP below) plus the brand mark.
import {
  AppWindowIcon,
  ArrowLeftRightIcon,
  BadgeIcon,
  BellRingIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ChartColumnIcon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CircleDotIcon,
  CircleUserRoundIcon,
  ClipboardListIcon,
  CommandIcon,
  CompassIcon,
  ComponentIcon,
  DatabaseIcon,
  FoldVerticalIcon,
  FormInputIcon,
  GalleryHorizontalIcon,
  GalleryThumbnailsIcon,
  GalleryVerticalIcon,
  IdCardIcon,
  KeyboardIcon,
  KeyRoundIcon,
  LayersIcon,
  LayoutPanelTopIcon,
  ListChecksIcon,
  ListChevronsDownUpIcon,
  ListFilterIcon,
  ListIcon,
  LoaderCircleIcon,
  LoaderIcon,
  MapPinIcon,
  MenuIcon,
  MessageCircleIcon,
  MessageCircleQuestionIcon,
  MessageSquareDashedIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  MilestoneIcon,
  MinusIcon,
  MousePointer2Icon,
  MousePointerClickIcon,
  MoveHorizontalIcon,
  OctagonAlertIcon,
  PackageOpenIcon,
  PaletteIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PaperclipIcon,
  ProportionsIcon,
  RectangleEllipsisIcon,
  Rows3Icon,
  ScrollTextIcon,
  SlidersHorizontalIcon,
  SquareCheckIcon,
  SquareStackIcon,
  TableIcon,
  TagIcon,
  TextCursorInputIcon,
  TextIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  TriangleAlertIcon,
  TypeIcon,
  type LucideIcon,
} from 'lucide-react';

import { LayoutElevationPage } from './pages/layout-elevation-page';
import { SemanticColorsPage } from './pages/semantic-colors-page';
import { TypographyPage } from './pages/typography-page';
import { Row } from './shared';

/**
 * The former single Tokens page, split into one page per foundations board
 * in the Figma mockup (background/surface/... swatches, type specimens,
 * layout+elevation). No Primitive Palette page: theme.css defines no
 * primitive color ramps (semantic tokens only), so there is nothing to
 * port for that board — see the demo README.
 * No separate Light/Dark pages either: the header's theme toggle already
 * covers both for every page below.
 */
const PAGES: { slug: string; label: string; Component: ComponentType }[] = [
  { slug: 'semantic-colors', label: 'Semantic Colors', Component: SemanticColorsPage },
  { slug: 'typography', label: 'Typography', Component: TypographyPage },
  { slug: 'layout-elevation', label: 'Layout & Elevation', Component: LayoutElevationPage },
];

/**
 * One example module per component, discovered by filename rather than
 * hand-listed here: dropping in `examples/<slug>.tsx` puts the component
 * in the menu on the next save with no shell edit.
 *
 * Deliberately NOT `eager: true`. Eager glob imports evaluate every example
 * module up front, so a single file importing a component missing from the
 * barrel throws before React renders anything and takes the whole app down
 * to a white screen, menu included. A lazy loader per slug defers that
 * import to the moment its screen is opened, and ExampleErrorBoundary below
 * catches it there — a broken or not-yet-exported component stays contained
 * to its own screen.
 */
type ExampleModule = { default: ComponentType };
const exampleLoaders = import.meta.glob<ExampleModule>('./examples/*.tsx');

interface ComponentEntry {
  /** Filename stem — also the hash route token, e.g. "dropdown-menu". */
  slug: string;
  /** Title-cased for display, with any "-backup" suffix stripped (the
   *  Badge marker communicates that instead — see BACKUP_SUFFIX below). */
  label: string;
  backup: boolean;
  Component: LazyExoticComponent<ComponentType>;
}

const BACKUP_SUFFIX = '-backup';

/** Strips a "-backup" suffix so a backup screen's docs link points at its
 *  base component's upstream page (there is no separate shadcn page for
 *  the backup variant). */
function baseSlug(slug: string): string {
  return slug.endsWith(BACKUP_SUFFIX) ? slug.slice(0, -BACKUP_SUFFIX.length) : slug;
}

/** Every component slug in this demo maps 1:1 onto a shadcn/ui docs page
 *  under /docs/components/base/ — verified directly against the live site
 *  rather than assumed, including the two slugs that looked like they
 *  might not have one ("direction", "date-picker"/"data-table" all
 *  resolve to real pages, not shadcn's soft-404). */
function shadcnDocsUrl(slug: string): string {
  return `https://ui.shadcn.com/docs/components/base/${baseSlug(slug)}`;
}

function toTitleCase(slug: string): string {
  return slug
    .split('-')
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

const COMPONENTS: ComponentEntry[] = Object.entries(exampleLoaders)
  .map(([path, load]) => {
    const slug = path.replace(/^\.\/examples\//, '').replace(/\.tsx$/, '');
    const backup = slug.endsWith(BACKUP_SUFFIX);
    return { slug, label: toTitleCase(baseSlug(slug)), backup, Component: lazy(load) };
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));

/**
 * Contains a crash to the screen that caused it. `key`'d by slug at the
 * call site so navigating away and back remounts a fresh boundary instead
 * of replaying a stale error from a previous screen. The message renders
 * inside the same kit Card the working screens use (CardHeader stays
 * visible above it) — plain text on `--destructive`, not a one-off alert
 * box, since no alert/callout component is in the barrel yet either.
 */
class ExampleErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // The Card message is the user-facing half; the full stack still goes
    // to the console for whoever's debugging the broken example.
    console.error('[ui-kit demo] example screen crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <p style={{ margin: 0, color: 'var(--destructive)' }}>
          This example crashed: {this.state.error.message}
        </p>
      );
    }
    return this.props.children;
  }
}

type Route = { kind: 'page'; slug: string } | { kind: 'component'; slug: string };

function defaultRoute(): Route {
  // Land on the first component alphabetically, same as shadcn's docs
  // landing on its first entry — the token pages stay one click away in
  // the menu.
  return COMPONENTS.length > 0
    ? { kind: 'component', slug: COMPONENTS[0]!.slug }
    : { kind: 'page', slug: PAGES[0]!.slug };
}

function parseHash(hash: string): Route {
  const token = hash.replace(/^#\/?/, '');
  // Legacy deep link to the pre-split single Tokens page — route it to the
  // first of the four pages rather than 404ing an old bookmark.
  if (token === 'tokens') return { kind: 'page', slug: PAGES[0]!.slug };
  const page = PAGES.find((entry) => entry.slug === token);
  if (page) return { kind: 'page', slug: page.slug };
  const found = COMPONENTS.find((entry) => entry.slug === token);
  return found ? { kind: 'component', slug: found.slug } : defaultRoute();
}

function canonicalHash(route: Route): string {
  return `#/${route.slug}`;
}

/**
 * Follows location.hash, so back/forward and deep links work. Navigation
 * itself is the browser's: every nav row IS an `<a href="#/slug">` (see
 * NavGroup), so a click, a middle-click into a new tab and a pasted deep
 * link all take the same path through here.
 *
 * Normalization (an empty hash on first load, or an unrecognized one from
 * a hand-edited URL, or a stale link to a component with no example file)
 * uses history.replaceState, not a hash assignment: assigning to
 * `location.hash` always pushes a new history entry, even when the
 * "navigation" is really this hook correcting the URL to match state it
 * already decided on. On load that would push an entry nobody asked for,
 * leaving Back to need two presses to leave the page instead of one.
 */
function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const follow = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  useEffect(() => {
    if (window.location.hash !== canonicalHash(route)) {
      window.history.replaceState(null, '', canonicalHash(route));
    }
  }, [route]);
  return route;
}

/**
 * One lucide icon per nav row, for the `collapsible="icon"` rail (icon-only
 * rows need an icon that stands on its own — a blank 48px square reads as
 * broken, not "collapsed"). Keyed by slug rather than assigned inline at
 * each call site so a "-backup" entry (see baseSlug) resolves the same icon
 * as the component it backs up, matching how its label is already derived.
 *
 * `?? ComponentIcon` covers the one case this table can't: COMPONENTS is
 * discovered from `examples/*.tsx` at build time (see the glob comment
 * above), so a new example file can ship before this map is updated. The
 * fallback keeps that row an icon instead of `undefined` reaching
 * `<Icon />` and crashing the rail.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  'semantic-colors': PaletteIcon,
  typography: TypeIcon,
  'layout-elevation': LayersIcon,
  accordion: FoldVerticalIcon,
  alert: TriangleAlertIcon,
  'alert-dialog': OctagonAlertIcon,
  'aspect-ratio': ProportionsIcon,
  attachment: PaperclipIcon,
  avatar: CircleUserRoundIcon,
  badge: BadgeIcon,
  breadcrumb: MilestoneIcon,
  bubble: MessageCircleIcon,
  button: MousePointerClickIcon,
  'button-group': SquareStackIcon,
  calendar: CalendarIcon,
  card: LayoutPanelTopIcon,
  carousel: GalleryHorizontalIcon,
  chart: ChartColumnIcon,
  checkbox: SquareCheckIcon,
  collapsible: ChevronsDownUpIcon,
  combobox: ListFilterIcon,
  command: CommandIcon,
  'context-menu': MousePointer2Icon,
  'data-table': DatabaseIcon,
  'date-picker': CalendarDaysIcon,
  dialog: AppWindowIcon,
  direction: ArrowLeftRightIcon,
  drawer: PanelBottomIcon,
  'dropdown-menu': ChevronDownIcon,
  empty: PackageOpenIcon,
  field: FormInputIcon,
  'hover-card': IdCardIcon,
  input: TextCursorInputIcon,
  'input-group': Rows3Icon,
  'input-otp': KeyRoundIcon,
  item: ListIcon,
  kbd: KeyboardIcon,
  label: TagIcon,
  marker: MapPinIcon,
  menubar: MenuIcon,
  message: MessageSquareTextIcon,
  'message-scroller': MessagesSquareIcon,
  'native-select': ListChevronsDownUpIcon,
  'navigation-menu': CompassIcon,
  pagination: GalleryThumbnailsIcon,
  popover: MessageSquareDashedIcon,
  progress: LoaderIcon,
  questionnaire: ClipboardListIcon,
  'radio-group': CircleDotIcon,
  resizable: MoveHorizontalIcon,
  'scroll-area': ScrollTextIcon,
  select: ChevronsUpDownIcon,
  separator: MinusIcon,
  sheet: PanelRightIcon,
  sidebar: PanelLeftIcon,
  skeleton: RectangleEllipsisIcon,
  slider: SlidersHorizontalIcon,
  spinner: LoaderCircleIcon,
  switch: ToggleLeftIcon,
  table: TableIcon,
  tabs: GalleryVerticalIcon,
  textarea: TextIcon,
  toast: BellRingIcon,
  toggle: ToggleRightIcon,
  'toggle-group': ListChecksIcon,
  tooltip: MessageCircleQuestionIcon,
};

interface NavEntry {
  route: Route;
  label: string;
  icon: LucideIcon;
  backup?: boolean;
}

const FOUNDATIONS_NAV: NavEntry[] = PAGES.map((entry) => ({
  route: { kind: 'page', slug: entry.slug },
  label: entry.label,
  icon: ICON_MAP[entry.slug] ?? ComponentIcon,
}));

const COMPONENTS_NAV: NavEntry[] = COMPONENTS.map((entry) => ({
  route: { kind: 'component', slug: entry.slug },
  label: entry.label,
  icon: ICON_MAP[baseSlug(entry.slug)] ?? ComponentIcon,
  backup: entry.backup,
}));

/**
 * One labelled section of the nav panel — used for both groups, since a
 * foundations page and a component screen differ only in which half of
 * `Route` they carry.
 *
 * Rows are plain kit parts: `SidebarMenuItem` + `SidebarMenuButton`
 * rendered as an anchor (`render`, the part's own documented polymorphism)
 * so the hash routing above stays the browser's job and open-in-new-tab
 * works on a docs browser the way readers expect. `isActive` is bound to
 * the current route and is what paints the accent fill; `aria-current`
 * carries the same fact to assistive tech, which `data-active` alone does
 * not. `tooltip` reuses the same label the row already shows — the kit's
 * own SidebarMenuButton only surfaces it once collapsed to the icon rail
 * (`sidebarState === 'collapsed'`, see sidebar.tsx), so this has no effect
 * expanded.
 *
 * `filter` is the search box's live query (App owns the input; this only
 * reads it), matched case-insensitively as a substring of the label — the
 * same comparison a reader scanning the list by eye would make. A group
 * with no surviving row renders nothing rather than an empty card: "Search
 * finds nothing in Foundations" is not information worth a box of its own
 * when the other group right below it might still have matches.
 */
function NavGroup({
  title,
  entries,
  current,
  filter,
}: {
  title: string;
  entries: NavEntry[];
  current: Route;
  filter: string;
}) {
  // Tapping a row on mobile has to dismiss the Sheet the panel becomes
  // there — otherwise the screen it just navigated to stays hidden behind
  // it. No-op on desktop, where the panel is not an overlay.
  const { isMobile, setOpenMobile } = useSidebar();
  // HTMLElement, not HTMLAnchorElement: SidebarMenuButton types its `ref`
  // off its default `button` tag even when `render` swaps the tag out, so
  // the widened element type is what lets the setter be passed straight
  // through as a ref callback without a cast.
  const [activeRow, setActiveRow] = useState<HTMLElement | null>(null);
  // The panel scrolls its own 60+ rows, so a deep link (or a reload) deep
  // in the alphabet would otherwise leave the current screen's row parked
  // out of sight. `block: 'nearest'` keeps this from becoming a jump on
  // every click: a row already in view is left exactly where it is, and
  // only an off-screen one is brought to the edge.
  useEffect(() => {
    activeRow?.scrollIntoView({ block: 'nearest' });
  }, [activeRow]);

  const query = filter.trim().toLowerCase();
  const visible = query === '' ? entries : entries.filter((entry) => entry.label.toLowerCase().includes(query));
  if (visible.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {visible.map((entry) => {
            const active = entry.route.kind === current.kind && entry.route.slug === current.slug;
            return (
              <SidebarMenuItem key={entry.route.slug}>
                <SidebarMenuButton
                  isActive={active}
                  aria-current={active ? 'page' : undefined}
                  tooltip={entry.label}
                  onClick={() => isMobile && setOpenMobile(false)}
                  ref={active ? setActiveRow : undefined}
                  render={<a href={canonicalHash(entry.route)} />}
                >
                  <entry.icon />
                  <span>{entry.label}</span>
                </SidebarMenuButton>
                {/* Marks a screen kept around as a backup port of a
                    component that has since been redone. Short by
                    necessity: the row reserves a fixed 32px for this
                    slot, and a longer word would slide under the label
                    it annotates. */}
                {entry.backup && <SidebarMenuBadge>bkp</SidebarMenuBadge>}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// 'auto' (system preference) is the implicit default and deliberately
// never written to storage — only an explicit light/dark choice persists,
// so a device whose OS scheme changes later still tracks it until the
// viewer opts out. The synchronous read in index.html's inline script
// applies the same stored value to <html data-theme> before this module
// even loads, so the first paint already matches; this constant just
// keeps the key in one place between the two reads.
const THEME_STORAGE_KEY = 'ui-kit-demo-theme';

function readStoredTheme(): string {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  } catch {
    // Storage can throw (private browsing, disabled cookies/storage) —
    // fall back to the session-only 'auto' default rather than crash.
    return 'auto';
  }
}

function App() {
  const [theme, setTheme] = useState(readStoredTheme);
  const [search, setSearch] = useState('');
  const route = useHashRoute();
  useEffect(() => {
    if (theme === 'auto') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    try {
      if (theme === 'auto') {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      }
    } catch {
      // Same storage caveat as readStoredTheme — the toggle still works
      // for the session, it just won't survive a reload.
    }
  }, [theme]);

  const active = route.kind === 'component' ? COMPONENTS.find((entry) => entry.slug === route.slug) : undefined;
  const activePage = route.kind === 'page' ? PAGES.find((entry) => entry.slug === route.slug) : undefined;

  return (
    /*
     * The shell is the kit's own Sidebar app shell: SidebarProvider around
     * everything, Sidebar and SidebarInset as siblings under it (never
     * nested — see sidebar.md's anti-patterns).
     *
     * collapsible="icon", not "offcanvas": every row below now carries its
     * own ICON_MAP icon (added alongside this), so a 48px rail collapse
     * shows a real icon per row — same shape demo/examples/sidebar.tsx's
     * AppSidebar demonstrates — rather than the identical blanks that made
     * "offcanvas" the right call before the icons existed. SidebarTrigger
     * in the content header still drives the collapse; SidebarMenuButton's
     * own `tooltip` prop (passed per-row in NavGroup) is what makes a
     * collapsed row's label reachable again, as a hover tooltip.
     */
    <SidebarProvider>
      <Sidebar collapsible="icon">
        {/* "FrontX UiKit" as the panel's own workspace row — the same
            SidebarHeader > SidebarMenu > SidebarMenuItem > SidebarMenuButton
            size="lg" shape demo/examples/sidebar.tsx's AppSidebar uses for
            its "Acme Inc" row, minus that pattern's secondary line and
            minus its trailing chevron: the chevron is upstream's cue for a
            dropdown/workspace-switcher, which this row is not
            — it is a plain static home link, same anchor-row idiom
            NavGroup's rows already use below it. `render` swaps the
            button's tag for an <a>, so this is a real link
            (open-in-new-tab, no-JS-required) rather than a click handler. */}
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip="FrontX UiKit"
                render={<a href={canonicalHash(defaultRoute())} />}
              >
                <ComponentIcon />
                <span style={{ fontWeight: 'var(--text-label-weight)' as CSSProperties['fontWeight'] }}>
                  FrontX UiKit
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {/* Same Search group shape as demo/examples/sidebar.tsx's
              AppSidebar: a labelled group whose content is just the input,
              first in SidebarContent so it reads as the panel's own search
              rather than belonging to either nav group below it. Collapsed
              to the icon rail it disappears on its own — the kit's
              `.root[data-collapsible='icon'] .input { display: none }`
              (sidebar.module.css) already hides SidebarInput there, same as
              upstream, with no extra logic needed here. */}
          <SidebarGroup>
            <SidebarGroupLabel render={<label htmlFor="ui-kit-demo-search" />}>Search</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarInput
                id="ui-kit-demo-search"
                type="search"
                placeholder="Search components..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </SidebarGroupContent>
          </SidebarGroup>
          <NavGroup title="Foundations" entries={FOUNDATIONS_NAV} current={route} filter={search} />
          <NavGroup title="Components" entries={COMPONENTS_NAV} current={route} filter={search} />
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        {/*
         * Sticky, not just visually pinned: SidebarInset (`.inset`) and its
         * `.wrapper` ancestor carry no `overflow` of their own (sidebar
         * .module.css), so the page's actual scroll context is the
         * document/viewport, not a nested scroll box — `position: sticky;
         * top: 0` here resolves against that same context with no
         * intervening `overflow: auto` ancestor to break it. The panel's
         * own nav is a SEPARATE already-`position: fixed` layer
         * (sidebar.module.css's `.container`), so this only has to answer
         * for the content column.
         *
         * The border-bottom line lives on the header itself now, not a
         * trailing `<Separator />` sibling: a sibling below a sticky header
         * scrolls out of view under it, so at any scroll position past its
         * own height the header would show a bare edge with the content
         * running flush underneath — exactly the "content bleeds through"
         * failure mode. Folding the border into the sticky element keeps
         * both pinned as one unit. `background-color` is opaque and reads
         * the same token `.inset` itself paints with, so content scrolling
         * underneath is fully covered, not just dimmed through a
         * transparent header.
         */}
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
            padding: 'var(--space-4) var(--space-6)',
            flexWrap: 'wrap',
            backgroundColor: 'var(--background)',
            borderBottom: 'var(--border-width) solid var(--border)',
          }}
        >
          <SidebarTrigger />
          <Row style={{ marginLeft: 'auto' }}>
            {['auto', 'light', 'dark'].map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={theme === mode ? 'default' : 'outline'}
                onClick={() => setTheme(mode)}
              >
                {mode}
              </Button>
            ))}
          </Row>
        </header>

        {/* The selected screen, framed in the kit's own Card — the same
            framing a consumer would reach for around any content block.
            `minWidth: 0` on the grid, so a screen wider than the inset
            (tables, the chart) scrolls inside its own Card instead of
            widening the shell and putting a scrollbar on the page. */}
        <div
          style={{
            display: 'grid',
            minWidth: 0,
            gap: 'var(--space-6)',
            padding: 'var(--space-6)',
            alignContent: 'start',
          }}
        >
          <Card>
            <CardHeader>
              <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {route.kind === 'page' ? (activePage?.label ?? route.slug) : (active?.label ?? route.slug)}
                {active?.backup && <Badge variant="outline">backup</Badge>}
              </CardTitle>
              {/* Components only, never the Foundations pages: an unobtrusive
                  pointer at the upstream shadcn/ui page this screen ports.
                  CardAction places it top-right next to the title (the same
                  slot shadcn's own docs use for header-level links); the
                  link itself is a plain <a>, not a kit Button, styled off
                  the same --link-foreground/--text-meta-size tokens the
                  kit's own Button variant="link" uses (button.module.css). */}
              {route.kind === 'component' && active && (
                <CardAction>
                  <a
                    href={shadcnDocsUrl(active.slug)}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: 'var(--link-foreground)',
                      fontSize: 'var(--text-meta-size)',
                      textDecoration: 'none',
                    }}
                  >
                    shadcn docs ↗
                  </a>
                </CardAction>
              )}
            </CardHeader>
            <CardContent style={{ display: 'grid', gap: 'var(--space-4)' }}>
              {route.kind === 'page' ? (
                activePage ? <activePage.Component /> : null
              ) : active ? (
                <ExampleErrorBoundary key={active.slug}>
                  <Suspense fallback={<Skeleton style={{ width: '100%', height: 120 }} />}>
                    <active.Component />
                  </Suspense>
                </ExampleErrorBoundary>
              ) : (
                // No examples/<slug>.tsx for this route — a stale or
                // hand-typed hash gets a placeholder, not a crash.
                <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>
                  No example found for “{route.slug}” yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </SidebarInset>

      <Toaster />
    </SidebarProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
