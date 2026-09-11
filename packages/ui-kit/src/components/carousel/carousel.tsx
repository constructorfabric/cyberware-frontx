// Load-bearing: Carousel/useCarousel call useState/useCallback/useEffect/
// useContext directly in their own render bodies (not just inside the
// wrapped embla-carousel-react primitive), so this can't be dropped.
// Coupled to CLIENT_COMPONENTS in scripts/verify-consumer.sh — keep both in
// sync if this ever changes.
'use client';

import { cx } from 'class-variance-authority';
import useEmblaCarousel, { type UseEmblaCarouselType } from 'embla-carousel-react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from 'react';

import { Button, type ButtonProps } from '../button/public.js';
import styles from './carousel.module.css';

/*
 * Translated from shadcn/ui base (registry/bases/base/ui/carousel.tsx) —
 * an embla-carousel-react wrapper with no Base UI primitive underneath (no
 * Base UI Carousel exists). The context/keyboard
 * plumbing below is copied structurally as upstream wrote it; only the
 * button composition and icons differ (see CarouselPrevious/Next).
 */

export type CarouselApi = UseEmblaCarouselType[1];
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>;
export type CarouselOptions = UseCarouselParameters[0];
export type CarouselPlugin = UseCarouselParameters[1];

export interface CarouselProps extends Omit<ComponentProps<'div'>, 'className'> {
  className?: string;
  opts?: CarouselOptions;
  plugins?: CarouselPlugin;
  /** @default 'horizontal' */
  orientation?: 'horizontal' | 'vertical';
  /** Escape hatch to the underlying embla `CarouselApi` — for imperative
   * control (jump to a slide, read the current index) beyond what
   * `useCarousel` exposes through context. */
  setApi?: (api: CarouselApi) => void;
}

interface CarouselContextValue {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0];
  api: CarouselApi;
  orientation: 'horizontal' | 'vertical';
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
}

const CarouselContext = createContext<CarouselContextValue | null>(null);

export function useCarousel() {
  const context = useContext(CarouselContext);
  if (!context) {
    throw new Error('useCarousel must be used within a <Carousel />');
  }
  return context;
}

export function Carousel({
  orientation = 'horizontal',
  opts,
  setApi,
  plugins,
  className,
  children,
  ...props
}: CarouselProps) {
  const [carouselRef, api] = useEmblaCarousel(
    { ...opts, axis: orientation === 'horizontal' ? 'x' : 'y' },
    plugins,
  );
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const onSelect = useCallback((selectedApi: CarouselApi) => {
    if (!selectedApi) {
      return;
    }
    setCanScrollPrev(selectedApi.canScrollPrev());
    setCanScrollNext(selectedApi.canScrollNext());
  }, []);

  const scrollPrev = useCallback(() => {
    api?.scrollPrev();
  }, [api]);

  const scrollNext = useCallback(() => {
    api?.scrollNext();
  }, [api]);

  // Faithful to upstream: only ArrowLeft/ArrowRight are wired, even in the
  // 'vertical' orientation (where Up/Down would be the intuitive keys).
  // Not fixed here — replicating upstream's own behavior, not improving on
  // it, per the porting brief.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        scrollPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        scrollNext();
      }
    },
    [scrollPrev, scrollNext],
  );

  useEffect(() => {
    if (!api || !setApi) {
      return;
    }
    setApi(api);
  }, [api, setApi]);

  useEffect(() => {
    if (!api) {
      return;
    }
    // Seeding the initial canScrollPrev/canScrollNext snapshot by calling
    // the SAME callback the subscription below hands to embla is exactly
    // the "subscribe to an external system, calling setState in a
    // callback" pattern the React docs sanction for effects (embla's own
    // scroll-position state lives outside React and has no render-time
    // equivalent to read) — the lint rule's static heuristic can't tell
    // this apart from a wasteful derived-state re-render, but there is no
    // React-state alternative to read `api.canScrollPrev()`/
    // `canScrollNext()` from at render time.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    onSelect(api);
    api.on('reInit', onSelect);
    api.on('select', onSelect);

    return () => {
      api.off('reInit', onSelect);
      api.off('select', onSelect);
    };
  }, [api, onSelect]);

  return (
    <CarouselContext.Provider
      value={{
        carouselRef,
        api,
        // Upstream's own fallback (`orientation || (opts?.axis === 'y' ? ...)`)
        // is unreachable given `orientation` already defaults to
        // 'horizontal' above — kept for fidelity, not because it does
        // anything here.
        orientation: orientation || (opts?.axis === 'y' ? 'vertical' : 'horizontal'),
        scrollPrev,
        scrollNext,
        canScrollPrev,
        canScrollNext,
      }}
    >
      <div
        onKeyDownCapture={handleKeyDown}
        role="region"
        aria-roledescription="carousel"
        data-orientation={orientation}
        className={cx(styles.carousel, className)}
        {...props}
      >
        {children}
      </div>
    </CarouselContext.Provider>
  );
}

export interface CarouselContentProps extends Omit<ComponentProps<'div'>, 'className'> {
  className?: string;
}

export function CarouselContent({ className, ...props }: CarouselContentProps) {
  const { carouselRef, orientation } = useCarousel();

  return (
    <div ref={carouselRef} className={styles.viewport}>
      <div data-orientation={orientation} className={cx(styles.content, className)} {...props} />
    </div>
  );
}

export interface CarouselItemProps extends Omit<ComponentProps<'div'>, 'className'> {
  className?: string;
}

export function CarouselItem({ className, ...props }: CarouselItemProps) {
  const { orientation } = useCarousel();

  return (
    <div
      role="group"
      aria-roledescription="slide"
      data-orientation={orientation}
      className={cx(styles.item, className)}
      {...props}
    />
  );
}

export type CarouselPreviousProps = Omit<ButtonProps, 'icon'>;

/* Upstream's base-registry source names this icon directly
 * (`IconPlaceholder lucide="ChevronLeftIcon"`). */
export function CarouselPrevious({
  className,
  variant = 'outline',
  size = 'sm',
  'aria-label': ariaLabel = 'Previous slide',
  disabled,
  onClick,
  ...props
}: CarouselPreviousProps) {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel();

  return (
    <Button
      {...props}
      variant={variant}
      size={size}
      icon={<ChevronLeftIcon />}
      aria-label={ariaLabel}
      data-orientation={orientation}
      className={cx(styles.previous, className)}
      // Navigation is what this button IS, so it stays behind a consumer's
      // own props rather than in front of them: `{...props}` first, the
      // two navigation-owned props composed on top. A consumer `onClick`
      // still runs (before the scroll), and a consumer `disabled` can only
      // ADD a reason to be disabled, never take away the one that says
      // there is nothing to scroll back to.
      disabled={!canScrollPrev || disabled}
      onClick={(event) => {
        onClick?.(event);
        scrollPrev();
      }}
    />
  );
}

export type CarouselNextProps = Omit<ButtonProps, 'icon'>;

export function CarouselNext({
  className,
  variant = 'outline',
  size = 'sm',
  'aria-label': ariaLabel = 'Next slide',
  disabled,
  onClick,
  ...props
}: CarouselNextProps) {
  const { orientation, scrollNext, canScrollNext } = useCarousel();

  return (
    <Button
      {...props}
      variant={variant}
      size={size}
      icon={<ChevronRightIcon />}
      aria-label={ariaLabel}
      data-orientation={orientation}
      className={cx(styles.next, className)}
      // See CarouselPrevious for why the spread leads here.
      disabled={!canScrollNext || disabled}
      onClick={(event) => {
        onClick?.(event);
        scrollNext();
      }}
    />
  );
}
