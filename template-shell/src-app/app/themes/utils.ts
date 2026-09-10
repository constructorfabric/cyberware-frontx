// @cpt-algo:cpt-frontx-algo-ui-libraries-choice-theme-propagation:p1
/**
 * Normalize a color value for use as a CSS variable value.
 * Theme tokens are full CSS colors (e.g. `hsl(0 0% 9%)`), the same format
 * @gears-frontx/ui-kit uses, so one token vocabulary drives both the shell's
 * Tailwind utilities (`var(--primary)`) and the kit's component CSS.
 */
// Intentionally identity: kept as a semantic marker distinguishing color
// tokens from other literals since the full-color-token migration.
export function cssColor(color: string): string {
  return color;
}
