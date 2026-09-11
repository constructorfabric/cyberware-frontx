/*
 * Thin re-export, matching the upstream base registry item exactly (see
 * direction.md's "Upstream source" note): Base UI's DirectionProvider is a
 * React Context provider with no DOM output of its own and no
 * className/style surface (DirectionProviderProps carries only `children`
 * and `direction` — see @base-ui/react/direction-provider's
 * DirectionProvider.d.ts) — there is nothing for a CSS Modules layer to
 * style, so this component ships no .module.css rules beyond the
 * convention-required stub file (see direction.module.css).
 *
 * It exists so RTL-aware Base UI primitives read a shared `direction`
 * instead of needing the prop passed to each one individually — every kit
 * component that wraps a directional Base UI primitive (Slider, Menu,
 * Select, ...) already defers to this context on its own; this file is the
 * kit's only public surface for setting it.
 */
export {
  DirectionProvider,
  useDirection,
  type DirectionProviderProps,
  type TextDirection,
} from '@base-ui/react/direction-provider';
