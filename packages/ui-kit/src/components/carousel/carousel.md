# Carousel

An embla-carousel-react wrapper — a scroll-snapping track of slides with
optional Previous/Next controls and keyboard navigation. No Base UI
primitive exists for this (confirmed against Base UI v1.7.0), so
`Carousel` owns the embla instance directly and
shares it with its parts through context.

## When to use

- A horizontally (or vertically) scrolling set of cards, images, or panels
  where only one (or a few) is visible at a time and the user steps through
  them — a product gallery, a testimonial strip, an onboarding sequence.

## When not to use

- A tabbed panel switcher with no scroll-snap feel — use `Tabs`.
- A plain overflowing row a user can free-scroll (no snapping, no
  Previous/Next affordance needed) — a native `overflow-x: auto` container
  is simpler and needs no dependency.

## Parts

| Part | Renders | Notes |
|------|---------|-------|
| `Carousel` | `<div role="region">` | Owns the embla instance; provides context to every part below |
| `CarouselContent` | Two nested `<div>`s | Outer is embla's scroll viewport (`overflow: hidden`); inner is the flex track embla translates |
| `CarouselItem` | `<div role="group">` | One slide; `aria-roledescription="slide"` |
| `CarouselPrevious` | `Button` | Icon-only, `variant="outline"` `size="sm"` by default |
| `CarouselNext` | `Button` | Same as `CarouselPrevious`, mirrored |

## Props (kit level)

`Carousel`:

| Prop | Type | Default |
|------|------|---------|
| `orientation` | `horizontal` \| `vertical` | `horizontal` |
| `opts` | embla `EmblaOptionsType` | — |
| `plugins` | embla `EmblaPluginType[]` | — |
| `setApi` | `(api: CarouselApi) => void` | — |
| `className` | `string` | — |

Every other part forwards its underlying element's native props, plus
`CarouselPrevious`/`CarouselNext` forward every `Button` prop except `icon`
(fixed to the chevron glyph — see below) — `variant`, `size`, `aria-label`,
`onClick`, `disabled`, etc. all pass through and override the computed
defaults.

`orientation` reaches every part through context, not a prop each part
takes individually — set it once on `Carousel` and `CarouselContent`,
`CarouselItem`, `CarouselPrevious`, and `CarouselNext` all read it off
`data-orientation`.

### Spacing contract

`CarouselContent`'s viewport clips overflow (`overflow: hidden`), and
`CarouselItem` only pads its *leading* edge — the inter-item gap upstream's
`pl-4`/`-ml-4` (horizontal) or `pt-4`/`-mt-4` (vertical) pair produces. It
does not pad a slide's trailing or cross-axis edges. A bordered element
(a `Card`, an image, anything with a visible edge) placed directly inside
`CarouselItem` therefore fills the item flush to those un-padded sides,
which can coincide with the viewport's clipped bounds and cut the border
off there. Wrap such content in a padding div — `--space-1` matches
upstream's own `p-1` — the same way every example below does:

```tsx
<CarouselItem>
  <div style={{ padding: 'var(--space-1)' }}>
    <Card>...</Card>
  </div>
</CarouselItem>
```

Content with no visible edge (plain text, an unbordered image) doesn't
need the wrapper.

`useCarousel()` is also exported: the same context hook every part above
uses internally, for building custom controls (a slide counter, dot
indicators) that need `canScrollPrev`/`canScrollNext`/`scrollPrev`/
`scrollNext`/the raw embla `api`. It throws outside a `<Carousel>`.

## Examples

```tsx
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@gears-frontx/ui-kit';

// Horizontal (default), with nav buttons
<Carousel>
  <CarouselContent>
    <CarouselItem>Slide 1</CarouselItem>
    <CarouselItem>Slide 2</CarouselItem>
    <CarouselItem>Slide 3</CarouselItem>
  </CarouselContent>
  <CarouselPrevious />
  <CarouselNext />
</Carousel>

// Vertical
<Carousel orientation="vertical" opts={{ align: 'start' }}>
  <CarouselContent>
    <CarouselItem>Slide 1</CarouselItem>
    <CarouselItem>Slide 2</CarouselItem>
  </CarouselContent>
  <CarouselPrevious />
  <CarouselNext />
</Carousel>

// Reading embla's own API for a custom slide counter
function CountedCarousel() {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!api) return;
    api.on('select', () => setCurrent(api.selectedScrollSnap()));
  }, [api]);

  return (
    <Carousel setApi={setApi}>
      <CarouselContent>{/* items */}</CarouselContent>
      <p>Slide {current + 1}</p>
    </Carousel>
  );
}
```

## Anti-patterns

- Do not render `CarouselItem`, `CarouselContent`, `CarouselPrevious`, or
  `CarouselNext` outside a `Carousel` — they call `useCarousel()`
  internally and throw immediately (`useCarousel must be used within a
  <Carousel />`) rather than silently rendering broken.
- Do not pass `icon` to `CarouselPrevious`/`CarouselNext` expecting to swap
  the glyph — that prop is intentionally omitted from their type (the kit
  inlines the chevron SVGs directly, same precedent as `Spinner`/
  `Pagination`); style via `className` instead, or compose your own button
  from `useCarousel()`'s `scrollPrev`/`scrollNext`/`canScrollPrev`/
  `canScrollNext` if a different control entirely is needed.
- Keyboard navigation only wires `ArrowLeft`/`ArrowRight`, even in the
  `vertical` orientation — this replicates upstream's own behavior exactly
  (see carousel.tsx), it is not a kit-side bug to work around.
- Do not place a bordered element directly inside `CarouselItem` without
  the padding wrapper from "Spacing contract" above — its trailing and
  cross-axis edges have no padding of their own, so the border sits flush
  against the viewport's clipped bounds and gets cut off there.
