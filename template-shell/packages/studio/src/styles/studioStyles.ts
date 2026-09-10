/**
 * Studio self-contained CSS styles.
 *
 * The studio cannot rely on the host app having a Tailwind build pipeline.
 * Any utility classes unique to the studio (glassmorphic effects, arbitrary
 * z-index values, opacity modifiers, etc.) must be provided here.
 *
 * Standard Tailwind utilities (flex, items-center, text-sm, etc.) are
 * intentionally duplicated for resilience — the studio must render correctly
 * regardless of the host app's styling setup.
 */

const STUDIO_STYLE_ID = 'frontx-studio-styles';

export const STUDIO_CSS = /* css */ `
/* ============================================================
   Gears FrontX Studio — Self-contained utility styles
   ============================================================ */

/* --- Base normalization (Preflight may be absent in no-uikit hosts) ---
   :where() keeps specificity at 0-0-0 so utility classes always win. */
.studio-panel,
.studio-portal-container {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
}
:where(.studio-panel *, .studio-portal-container *) { box-sizing: border-box; }
:where(.studio-panel button, .studio-portal-container button) {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  border: 0 solid transparent;
  background: transparent;
  padding: 0;
  margin: 0;
  cursor: pointer;
}
:where(.studio-panel h2, .studio-panel h3, .studio-portal-container h2, .studio-portal-container h3) {
  font-size: inherit;
  font-weight: inherit;
  margin: 0;
}

/* --- Layout --- */
.fixed { position: fixed; }
.absolute { position: absolute; }
.relative { position: relative; }
.flex { display: flex; }
.inline-flex { display: inline-flex; }
.block { display: block; }
.peer { /* Radix peer marker — no CSS needed */ }
.flex-col { flex-direction: column; }
.flex-1 { flex: 1 1 0%; }
.shrink-0 { flex-shrink: 0; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.justify-center { justify-content: center; }
.gap-2 { gap: 0.5rem; }
.overflow-hidden { overflow: hidden; }
.overflow-y-auto { overflow-y: auto; }
.overflow-x-hidden { overflow-x: hidden; }

/* --- Sizing --- */
.h-full { height: 100%; }
.w-full { width: 100%; }
.h-4 { height: 1rem; }
.w-4 { width: 1rem; }
.h-5 { height: 1.25rem; }
.w-5 { width: 1.25rem; }
.w-9 { width: 2.25rem; }
.h-6 { height: 1.5rem; }
.w-6 { width: 1.5rem; }
.h-7 { height: 1.75rem; }
.w-7 { width: 1.75rem; }
.h-8 { height: 2rem; }
.h-9 { height: 2.25rem; }
.h-10 { height: 2.5rem; }
.h-12 { height: 3rem; }
.w-12 { width: 3rem; }
.min-w-\\[8rem\\] { min-width: 8rem; }
.min-w-40 { min-width: 10rem; }

/* --- Spacing --- */
.p-0 { padding: 0; }
.p-1 { padding: 0.25rem; }
.p-4 { padding: 1rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.px-8 { padding-left: 2rem; padding-right: 2rem; }
.py-1\\.5 { padding-top: 0.375rem; padding-bottom: 0.375rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
.pl-8 { padding-left: 2rem; }
.bottom-1 { bottom: 0.25rem; }
.right-1 { right: 0.25rem; }
.space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.75rem; }
.space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem; }

/* --- Typography --- */
.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.uppercase { text-transform: uppercase; }
.tracking-wider { letter-spacing: 0.05em; }
.whitespace-nowrap { white-space: nowrap; }

/* --- Colors (theme-aware via CSS variables) ---
   Some theme variables (--popover-foreground, --card-foreground) may have
   incorrect values in third-party themes. The Studio maps all component
   colors to --foreground / --background which are always correct (body uses them).
   :where() ensures host-app Tailwind utilities take precedence when available. */
.text-foreground { color: var(--foreground); }
.text-muted-foreground { color: var(--muted-foreground); }
.text-\\[color-mix\\(in_oklab\\,var\\(--muted-foreground\\)_70\\%\\,transparent\\)\\] { color: color-mix(in oklab, var(--muted-foreground) 70%, transparent); }
:where(.bg-popover) { background-color: var(--background); }
:where(.text-popover-foreground) { color: var(--foreground); }
:where(.bg-accent) { background-color: color-mix(in oklab, var(--foreground) 10%, transparent); }
:where(.text-accent-foreground) { color: var(--foreground); }
:where(.bg-background) { background-color: var(--background); }
:where(.bg-card) { background-color: var(--background); }
:where(.text-card-foreground) { color: var(--foreground); }
:where(.bg-primary) { background-color: var(--foreground); }
:where(.text-primary-foreground) { color: var(--background); }
:where(.bg-input) { background-color: color-mix(in oklab, var(--foreground) 15%, transparent); }
:where(.border-input) { border-color: color-mix(in oklab, var(--foreground) 20%, transparent); }
:where(.ring-ring) { --tw-ring-color: color-mix(in oklab, var(--foreground) 50%, transparent); }
.border-transparent { border-color: transparent; }

/* --- Borders --- */
.border { border-width: 1px; }
.border-2 { border-width: 2px; }
.border-b { border-bottom-width: 1px; }
:where(.border-\\[color-mix\\(in_oklab\\,var\\(--border\\)_50\\%\\,transparent\\)\\]) { border-color: color-mix(in oklab, var(--foreground) 15%, transparent); }
.rounded-full { border-radius: 9999px; }
.rounded-xl { border-radius: 0.75rem; }
.rounded-md { border-radius: calc(var(--radius, 0.5rem) - 2px); }
.rounded-sm { border-radius: calc(var(--radius, 0.5rem) - 4px); }

/* --- Interaction --- */
.select-none { -webkit-user-select: none; user-select: none; }
.cursor-pointer { cursor: pointer; }
.cursor-default { cursor: default; }
.cursor-nwse-resize { cursor: nwse-resize; }
.pointer-events-none { pointer-events: none; }
.pointer-events-auto { pointer-events: auto; }
.outline-none { outline: 2px solid transparent; outline-offset: 2px; }
.transition-colors {
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}
.transition-transform {
  transition-property: transform;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}

/* --- Z-index (arbitrary values) --- */
.z-\\[10000\\] { z-index: 10000; }
.z-\\[99999\\] { z-index: 99999; }

/* --- Glassmorphic: background with opacity --- */
.bg-white\\/20 { background-color: rgb(255 255 255 / 0.2); }
.bg-white\\/30 { background-color: rgb(255 255 255 / 0.3); }
.dark .dark\\:bg-black\\/50 { background-color: rgb(0 0 0 / 0.5); }
.dark .dark\\:bg-black\\/60 { background-color: rgb(0 0 0 / 0.6); }

/* --- Glassmorphic: border with opacity --- */
.border-white\\/30 { border-color: rgb(255 255 255 / 0.3); }
.dark .dark\\:border-white\\/20 { border-color: rgb(255 255 255 / 0.2); }

/* --- Glassmorphic: backdrop filters --- */
.backdrop-blur-md {
  --tw-backdrop-blur: blur(12px);
  -webkit-backdrop-filter: var(--tw-backdrop-blur) var(--tw-backdrop-brightness, ) var(--tw-backdrop-contrast, ) var(--tw-backdrop-grayscale, ) var(--tw-backdrop-hue-rotate, ) var(--tw-backdrop-invert, ) var(--tw-backdrop-opacity, ) var(--tw-backdrop-saturate, ) var(--tw-backdrop-sepia, );
  backdrop-filter: var(--tw-backdrop-blur) var(--tw-backdrop-brightness, ) var(--tw-backdrop-contrast, ) var(--tw-backdrop-grayscale, ) var(--tw-backdrop-hue-rotate, ) var(--tw-backdrop-invert, ) var(--tw-backdrop-opacity, ) var(--tw-backdrop-saturate, ) var(--tw-backdrop-sepia, );
}
.backdrop-saturate-\\[180\\%\\] {
  --tw-backdrop-saturate: saturate(1.8);
  -webkit-backdrop-filter: var(--tw-backdrop-blur, ) var(--tw-backdrop-brightness, ) var(--tw-backdrop-contrast, ) var(--tw-backdrop-grayscale, ) var(--tw-backdrop-hue-rotate, ) var(--tw-backdrop-invert, ) var(--tw-backdrop-opacity, ) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia, );
  backdrop-filter: var(--tw-backdrop-blur, ) var(--tw-backdrop-brightness, ) var(--tw-backdrop-contrast, ) var(--tw-backdrop-grayscale, ) var(--tw-backdrop-hue-rotate, ) var(--tw-backdrop-invert, ) var(--tw-backdrop-opacity, ) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia, );
}

/* --- Glassmorphic: box shadow (arbitrary) --- */
.shadow-\\[0_8px_32px_rgba\\(0\\,0\\,0\\,0\\.2\\)\\] {
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

/* --- Shadows --- */
.shadow { box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1); }
.shadow-sm { box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
.shadow-md { box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); }
.shadow-lg { box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); }
.ring-0 { box-shadow: var(--tw-ring-inset,) 0 0 0 calc(0px + var(--tw-ring-offset-width, 0px)) var(--tw-ring-color, transparent); }

/* --- Hover states --- */
.hover\\:bg-white\\/30:hover { background-color: rgb(255 255 255 / 0.3); }
.dark .dark\\:hover\\:bg-black\\/60:hover { background-color: rgb(0 0 0 / 0.6); }
.hover\\:text-muted-foreground:hover { color: var(--muted-foreground); }
:where(.hover\\:bg-accent:hover) { background-color: color-mix(in oklab, var(--foreground) 10%, transparent); }
:where(.hover\\:bg-\\[color-mix\\(in_oklab\\,var\\(--primary\\)_90\\%\\,transparent\\)\\]:hover) { background-color: color-mix(in oklab, var(--foreground) 85%, transparent); }
:where(.hover\\:bg-\\[color-mix\\(in_oklab\\,var\\(--secondary\\)_80\\%\\,transparent\\)\\]:hover) { background-color: color-mix(in oklab, var(--foreground) 8%, transparent); }
:where(.hover\\:bg-\\[color-mix\\(in_oklab\\,var\\(--destructive\\)_90\\%\\,transparent\\)\\]:hover) { background-color: hsl(0 60% 50% / 0.9); }

/* --- Focus states --- */
:where(.focus\\:bg-accent:focus) { background-color: color-mix(in oklab, var(--foreground) 10%, transparent); }
:where(.focus\\:text-foreground:focus) { color: var(--foreground); }
:where(.focus\\:text-accent-foreground:focus) { color: var(--foreground); }
.focus-visible\\:outline-none:focus-visible { outline: 2px solid transparent; outline-offset: 2px; }
:where(.focus-visible\\:ring-1:focus-visible) {
  box-shadow: var(--tw-ring-inset,) 0 0 0 calc(1px + var(--tw-ring-offset-width, 0px)) var(--tw-ring-color, color-mix(in oklab, var(--foreground) 50%, transparent));
}
:where(.focus-visible\\:ring-2:focus-visible) {
  box-shadow: var(--tw-ring-inset,) 0 0 0 calc(2px + var(--tw-ring-offset-width, 0px)) var(--tw-ring-color, color-mix(in oklab, var(--foreground) 50%, transparent));
}
:where(.focus-visible\\:ring-ring:focus-visible) { --tw-ring-color: color-mix(in oklab, var(--foreground) 50%, transparent); }
:where(.focus-visible\\:ring-offset-2:focus-visible) { --tw-ring-offset-width: 2px; }
:where(.focus-visible\\:ring-offset-background:focus-visible) { --tw-ring-offset-color: var(--background); }

/* --- Data-attribute & disabled states --- */
:where(.data-\\[state\\=open\\]\\:bg-accent[data-state=open]) { background-color: color-mix(in oklab, var(--foreground) 10%, transparent); }
:where(.data-\\[state\\=checked\\]\\:bg-primary[data-state=checked]) { background-color: var(--foreground); }
:where(.data-\\[state\\=unchecked\\]\\:bg-input[data-state=unchecked]) { background-color: color-mix(in oklab, var(--foreground) 15%, transparent); }
.data-\\[disabled\\]\\:pointer-events-none[data-disabled] { pointer-events: none; }
.data-\\[disabled\\]\\:opacity-50[data-disabled] { opacity: 0.5; }
.disabled\\:pointer-events-none:disabled { pointer-events: none; }
.disabled\\:opacity-50:disabled { opacity: 0.5; }
.disabled\\:cursor-not-allowed:disabled { cursor: not-allowed; }

/* --- SVG child selectors --- */
[class*="[&>svg]:size-4"] > svg,
[class*="[&_svg]:size-4"] svg { width: 1rem; height: 1rem; }
[class*="[&>svg]:shrink-0"] > svg,
[class*="[&_svg]:shrink-0"] svg { flex-shrink: 0; }
[class*="[&_svg]:pointer-events-none"] svg { pointer-events: none; }

/* --- RTL support --- */
.rtl\\:flex-row-reverse:where([dir=rtl], [dir=rtl] *) { flex-direction: row-reverse; }
.data-\\[state\\=checked\\]\\:ltr\\:translate-x-4[data-state=checked]:where([dir=ltr], [dir=ltr] *) { transform: translateX(1rem); }
.data-\\[state\\=checked\\]\\:rtl\\:-translate-x-4[data-state=checked]:where([dir=rtl], [dir=rtl] *) { transform: translateX(-1rem); }
.data-\\[state\\=unchecked\\]\\:translate-x-0[data-state=unchecked] { transform: translateX(0); }

/* --- Radix animation (minimal enter/exit for dropdown) --- */
@keyframes frontx-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes frontx-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes frontx-zoom-in { from { transform: scale(0.95); } to { transform: scale(1); } }
@keyframes frontx-zoom-out { from { transform: scale(1); } to { transform: scale(0.95); } }
.data-\\[state\\=open\\]\\:animate-in[data-state=open] { animation: frontx-fade-in 150ms ease-out, frontx-zoom-in 150ms ease-out; }
.data-\\[state\\=closed\\]\\:animate-out[data-state=closed] { animation: frontx-fade-out 100ms ease-in, frontx-zoom-out 100ms ease-in; animation-fill-mode: forwards; }

/* The same two rules again, scoped to the portal (specificity 0-3-0 against the
   0-2-0 of the bare utility). A host running tailwindcss-animate emits these
   exact class names with \`animation-name: exit\`, so the pair above wins only
   while the studio's <style> is last in the document - which it is at mount and
   need not stay: any stylesheet appended afterwards (a lazily mounted route or
   MFE chunk) takes the cascade back on equal specificity.
   Losing it is not cosmetic. Radix keeps the dropdown mounted after close and
   waits for \`animationend\` before unmounting; if the winning rule names
   keyframes the document does not define, no animation runs, that event never
   fires, and the closed menu stays visible and clickable over the app until the
   next navigation. Scoping pins the winner to keyframes defined right here. */
.studio-portal-container .data-\\[state\\=open\\]\\:animate-in[data-state=open] { animation: frontx-fade-in 150ms ease-out, frontx-zoom-in 150ms ease-out; }
.studio-portal-container .data-\\[state\\=closed\\]\\:animate-out[data-state=closed] { animation: frontx-fade-out 100ms ease-in, frontx-zoom-out 100ms ease-in; animation-fill-mode: forwards; }

/* --- Studio portal: scoped dropdown color overrides ---
   Dropdown content portaled here inherits host-app Tailwind utilities that
   may reference broken theme variables (e.g. --popover-foreground identical
   to --popover in some third-party themes). Scoped rules (specificity 0-2-0)
   beat host-app Tailwind (0-1-0) and map everything to --foreground / --background. */
.studio-portal-container .bg-popover { background-color: var(--background, hsl(0 0% 100%)); }
.studio-portal-container .text-popover-foreground { color: var(--foreground, hsl(0 0% 0%)); }
.studio-portal-container .focus\\:bg-accent:focus { background-color: color-mix(in oklab, var(--foreground) 10%, transparent); }
.studio-portal-container .focus\\:text-foreground:focus { color: var(--foreground); }

/* --- Z-index (dropdown content) --- */
.z-50 { z-index: 50; }
`;

/**
 * Inject studio styles into the document head (idempotent).
 * Returns a cleanup function that removes the style element.
 */
export function injectStudioStyles(): () => void {
  if (typeof document === 'undefined') return () => { };

  let styleEl = document.getElementById(STUDIO_STYLE_ID) as HTMLStyleElement | null;
  if (styleEl) return () => { };

  styleEl = document.createElement('style');
  styleEl.id = STUDIO_STYLE_ID;
  styleEl.textContent = STUDIO_CSS;
  document.head.appendChild(styleEl);

  return () => {
    styleEl?.remove();
  };
}
