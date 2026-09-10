# Direction

A thin re-export of Base UI's `DirectionProvider` and `useDirection` — no
styling surface, no variants, no kit-authored logic. Renders no DOM element
of its own (a bare `React.Context.Provider`); it exists so RTL-aware Base UI
primitives (`Slider`, `Menu`, `Select`, `NavigationMenu`, ...) read a shared
reading direction instead of needing it passed to each one individually.

## When to use

- Mount once near the root of an app (or a subtree) that renders in a
  right-to-left language, wrapping every Base UI-backed control that should
  follow it.
- Skip entirely for an LTR-only app — every kit component already defaults
  to `ltr` behavior with no `DirectionProvider` mounted at all.

## Props

| Prop | Type | Default |
|------|------|---------|
| `direction` | `'ltr'` \| `'rtl'` | `'ltr'` |
| `children` | `ReactNode` | — |

`useDirection()` reads the nearest ancestor `DirectionProvider`'s
`direction`, falling back to `'ltr'` with none mounted.

## Examples

```tsx
import { DirectionProvider, useDirection } from '@gears-frontx/ui-kit';

<DirectionProvider direction="rtl">
  <App />
</DirectionProvider>;

// Inside a descendant, anywhere:
function App() {
  const direction = useDirection();
  return <div dir={direction}>...</div>;
}
```

## Anti-patterns

- Do not mount more than one `DirectionProvider` per direction change you
  need — a single provider at the boundary where the direction actually
  changes is enough; every Base UI primitive below it inherits the value.
- Do not expect this component to set the DOM `dir` attribute anywhere —
  it only shares a value through context. Set `dir` on your own root
  element (see the `useDirection` example above) if you need the browser's
  own bidi algorithm applied too.
