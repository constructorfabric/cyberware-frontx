# Kbd

A visual representation of a keyboard key or shortcut. No Base UI
primitive: `Kbd` is a plain `<kbd>` with no interactive or ARIA behavior of
its own — it is decoration, not a live control.

## Parts

- **`Kbd`** — a single key or short label (`Esc`, `⌘`, `Enter`).
- **`KbdGroup`** — groups several `Kbd`s into one shortcut (`⌘` + `K`).
  Renders as a `<kbd>` itself, matching upstream — see `kbd.tsx` for why.

## When to use

- Labeling a keyboard shortcut in help text, a menu item, or a tooltip
  (`Cmd`+`K` to open the command palette).

## When not to use

- An actual interactive button that happens to look like a key — use
  `button`, not `Kbd`; this component carries no click handling, focus
  management, or ARIA role.

## Props (kit level)

`Kbd` and `KbdGroup` take no kit-specific props — every prop is the
underlying native `<kbd>` element's props (`className`, `id`, `aria-*`,
...), forwarded as-is.

## Examples

```tsx
import { Kbd, KbdGroup } from '@gears-frontx/ui-kit';

// A single key
<p>Press <Kbd>Esc</Kbd> to close.</p>

// A chorded shortcut
<KbdGroup>
  <Kbd>Ctrl</Kbd>
  <Kbd>B</Kbd>
</KbdGroup>
```

## Anti-patterns

- Do not wrap `Kbd` in a `Button` to make it clickable and call it a
  shortcut trigger — wire the actual keyboard listener yourself and use
  `Kbd` purely to describe the shortcut in text.
- Do not nest `Kbd` inside `Tooltip`'s content expecting an automatic
  color adjustment — upstream's Tooltip-context recolor keys off a
  `data-slot` attribute this kit doesn't emit (see `kbd.tsx`); it renders
  with its plain `--muted`/`--muted-foreground` pair there instead.
