'use client';

import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * SSR-safe mobile-viewport detector, private to Sidebar (see sidebar.md's
 * "not reproducible" section — the port brief calls for this to live
 * inside the sidebar directory rather than a shared hooks tree).
 *
 * Starts `false` (assume desktop) rather than upstream's tri-state
 * `undefined`: Sidebar only ever asks "is this collapsed to the mobile
 * Sheet or not", a plain boolean either way, so there is no third state for
 * a caller to react to — collapsing it removes a render-time null check
 * every consumer of the hook would otherwise have to carry. The trade-off
 * is the one flash upstream's own `md:block hidden` CSS already exists to
 * paper over: a viewport narrower than `MOBILE_BREAKPOINT` briefly renders
 * the desktop layout for one frame until the effect below measures the
 * real width and flips it — see sidebar.module.css's `.root` media query,
 * which hides that frame the same way upstream's Tailwind classes do.
 */
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < breakpoint);
    mediaQuery.addEventListener('change', onChange);
    onChange();
    return () => mediaQuery.removeEventListener('change', onChange);
  }, [breakpoint]);

  return isMobile;
}
