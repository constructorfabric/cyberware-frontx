# Marker

An inline conversation marker — a faithful port of [shadcn/ui's base
Marker](https://ui.shadcn.com/docs/components/base/marker). Marker has no
Base UI primitive, but still gets `render`-prop polymorphism (via Base
UI's `useRender`/`mergeProps` utilities) for the one case that needs it:
rendering as a link or button — the same pattern [`Badge`](badge.md) uses.

Use Marker for status updates, system notes, bordered rows, and labeled
separators inside a conversation thread. Compose it with
[`Message`](message.md) — Marker is a standalone row, not a message
surface.

## Shimmer dependency

Marker pairs with the `shimmer` utility class shipped in this package's
global stylesheet: `import '@gears-frontx/ui-kit/utilities.css';` once at
the app entry, alongside `theme.css`. Marker does **not**
apply it automatically: add the `shimmer` class to `MarkerContent`
directly for an animated streaming-text effect —

```tsx
<Marker role="status">
  <MarkerContent className="shimmer">Thinking…</MarkerContent>
</Marker>
```

This mirrors [`Attachment`](attachment.md)'s use of the same utility,
except Attachment applies it automatically off its own `state` prop —
Marker has no equivalent lifecycle axis, so the consumer opts in per
marker.

## When to use

- An inline status or progress note ("Thinking...", "Checking the
  logs...").
- A system note or bordered row inside a conversation (`variant="border"`).
- A labeled separator between conversation sections, such as a date
  (`variant="separator"`).

## When not to use

- A full message row with an avatar, header, or footer — use
  [`Message`](message.md).
- A framed chat bubble — use [`Bubble`](bubble.md).

## Composition

```text
Marker
├── MarkerIcon
└── MarkerContent
```

## Variants

| Variant     | Description                                          |
| ----------- | ----------------------------------------------------- |
| `default`   | An inline marker for status, notes, and actions.     |
| `border`    | A default marker with a bottom border under the row. |
| `separator` | A centered label with divider lines on each side.    |

## Props

### Marker

| Prop        | Type                                    | Default     | Description                                      |
| ----------- | ---------------------------------------- | ----------- | ------------------------------------------------- |
| `variant`   | `'default' \| 'border' \| 'separator'`  | `'default'` | The marker layout.                                |
| `render`    | `ReactElement` — replaces the root `div` | —           | Render as a different element, such as a link.    |
| `className` | `string`                                 | —           | Merged after the variant class.                   |

All other props are native `<div>` props (or the target element's props
when using `render`) and are forwarded as-is, including `role` — see
Accessibility below.

`markerVariants` (the underlying `cva` recipe) is also exported, for a
consumer composing the marker styles into a custom component.

### MarkerIcon

A decorative icon slot, hidden from assistive tech with `aria-hidden`.
Accepts only `className` plus native `<span>` props.

### MarkerContent

The marker's text content. Accepts only `className` plus native `<span>`
props.

## Examples

```tsx
import { Marker, MarkerContent, MarkerIcon } from '@gears-frontx/ui-kit';

<Marker>
  <MarkerIcon>
    <CheckIcon />
  </MarkerIcon>
  <MarkerContent>Explored 4 files</MarkerContent>
</Marker>;
```

### Separator

```tsx
<Marker variant="separator">
  <MarkerContent>Today</MarkerContent>
</Marker>
```

### Border

```tsx
<Marker variant="border">
  <MarkerIcon>
    <FileTextIcon />
  </MarkerIcon>
  <MarkerContent>Opened implementation notes</MarkerContent>
</Marker>
```

### Link or button

```tsx
<Marker render={<a href="/pull/42" />}>
  <MarkerContent>View the pull request</MarkerContent>
</Marker>
```

## Accessibility

Marker is presentational by default. Choose the role based on intent
rather than relying on a single default:

- **Status and progress.** For streaming or in-progress markers ("Checking
  the logs...", a running tool), set `role="status"` so assistive tech
  announces the update as it appears — `Marker` forwards `role` to the
  underlying element.

  ```tsx
  <Marker role="status">
    <MarkerIcon>
      <Spinner />
    </MarkerIcon>
    <MarkerContent>Compacting conversation</MarkerContent>
  </Marker>
  ```

- **Labeled separators need no role.** A `separator`-variant marker's
  divider lines are decorative CSS pseudo-elements; its text is announced
  as ordinary content. Do **not** add `role="separator"` to a labeled
  divider — a native separator takes its accessible name from
  `aria-label`, not from its text content, so the visible label would go
  unannounced. Reserve `role="separator"` for a divider with no meaningful
  text of its own.

- **Bordered markers keep the default semantics** — the bottom border is
  purely decorative, so choose `role="status"`, `render`, or no role based
  on the marker's actual purpose, same as the default variant.

- **Decorative icons.** `MarkerIcon` is hidden from assistive tech; the
  adjacent `MarkerContent` carries the meaning. For an icon-only marker,
  give `Marker` itself an `aria-label` or visible text — an icon alone
  announces as empty.

- **Interactive markers.** When a marker links or triggers an action,
  render it as a real `<button>` or `<a>` via `render` so it is focusable
  and exposes the correct role. The accessible name comes from the marker
  text.

## Anti-patterns

- Do not add `role="separator"` to a `separator`-variant marker that
  carries visible text — see Accessibility above.
- Do not rely on `MarkerIcon` alone to convey meaning — pair it with
  `MarkerContent` text or an `aria-label` on `Marker`.
- Do not nest a `Bubble` inside a `Marker` — Marker is a lightweight row,
  not a message surface; use `Message` + `Bubble` for that.
