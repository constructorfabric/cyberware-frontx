// Extends vitest's `expect` with DOM-specific matchers (`toBeInTheDocument`,
// `toHaveAttribute`, ...) — the `/vitest` entry point (not the plain
// `@testing-library/jest-dom` root import) calls `expect.extend` against
// vitest's own `expect`, matching this package's test runner; the root
// import assumes a global Jest `expect` that doesn't exist here.
// carousel.test.tsx already calls these matchers, un-guarded by a local
// import, so this must run before any test file does.
import '@testing-library/jest-dom/vitest';

/*
 * jsdom has no PointerEvent constructor; Base UI dispatches one onto the
 * hidden native input when a checkbox/radio/switch is clicked. A MouseEvent
 * subclass is enough for those code paths.
 */
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? '';
    }
  }
  Object.defineProperty(window, 'PointerEvent', {
    value: PointerEventPolyfill,
    writable: true,
    configurable: true,
  });
}

/*
 * jsdom implements no layout at all (every element measures 0x0) and ships
 * no ResizeObserver — see https://github.com/jsdom/jsdom/issues/3368, still
 * open as of jsdom 26. Several components call `new ResizeObserver(...)`
 * unconditionally during mount to track element size: embla-carousel
 * (Carousel), react-resizable-panels (Resizable), and cmdk's CommandList
 * (src/components/command, publishing `--cmdk-list-height`). With no
 * global constructor at all, each throws a ReferenceError before ever
 * rendering, failing every test that mounts them regardless of what they
 * assert. A no-op stub is enough to let them mount: none of the three
 * treats a silent, never-firing observer as an error, they just never
 * receive a resize entry — consistent with jsdom's own "no real layout"
 * ceiling, and the kit's CSS never reads `--cmdk-list-height` (see
 * command.module.css) so that callback firing isn't required for anything
 * this port needs to verify either. This does NOT make size-driven
 * behavior (embla's canScrollPrev/canScrollNext past the initial state,
 * actual panel-percent resizing) testable — see carousel.test.tsx/
 * resizable.test.tsx for what is and isn't asserted as a result.
 */
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', {
    value: ResizeObserverPolyfill,
    writable: true,
    configurable: true,
  });
}

/*
 * jsdom ships no IntersectionObserver either. embla-carousel's SlidesInView
 * module (used by every Carousel — see EmblaCarousel.ts's own `init`, not
 * an opt-in plugin) constructs one unconditionally during mount to track
 * which slides are visible, so the same ReferenceError-before-render
 * problem as the ResizeObserver gap above applies. A no-op stub is enough:
 * the kit's Carousel doesn't expose slides-in-view state to consumers, so
 * the observer never firing costs nothing this port needs to verify.
 */
if (typeof window !== 'undefined' && typeof window.IntersectionObserver === 'undefined') {
  class IntersectionObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    value: IntersectionObserverPolyfill,
    writable: true,
    configurable: true,
  });
}

/*
 * jsdom ships no `Element.prototype.scrollIntoView` at all (not even a
 * no-op — it's `undefined`, per the same "no real layout" ceiling as the
 * ResizeObserver gap above). cmdk calls it unconditionally on mount and on
 * every selection change to keep the active item in view, so without a
 * stub every test that mounts a Command/CommandList throws a TypeError
 * before rendering. A no-op is enough: cmdk doesn't inspect the result,
 * it just wants scrolling to have been attempted.
 */
if (
  typeof Element !== 'undefined' &&
  typeof Element.prototype.scrollIntoView === 'undefined'
) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

/*
 * jsdom ships no `window.matchMedia` at all — not even a stub, `typeof
 * window.matchMedia` is `undefined` (confirmed against jsdom 26, the
 * version this package pins). embla-carousel's `activate()` runs
 * `optionsList.map((o) => Object.keys(o.breakpoints ?? {})).flat().map(
 * ownerWindow.matchMedia)` unconditionally on every mount, even with zero
 * configured breakpoints: per spec, `Array.prototype.map` validates its
 * callback IS callable before it ever looks at the array's length, so
 * passing `undefined` throws synchronously regardless of whether there is
 * anything to iterate. Every Carousel mount hits this without a stub. A
 * `matches: false` MediaQueryList-shaped stub is enough — the kit's own
 * breakpoint plumbing is untested here either way (see
 * carousel.test.tsx), this just keeps embla's internal responsive-options
 * wiring from crashing before Carousel ever renders.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  window.matchMedia = function matchMedia(query: string): MediaQueryList {
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  };
}
